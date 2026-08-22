/**
 * voxel-collision.js
 * ===================================================================
 * 基于 PlayCanvas splat-transform 输出的稀疏体素八叉树（SVO）的运行时碰撞系统。
 *
 * 数据由 tools/generate_room_collision.py 从权威碰撞包生成。输出遵循
 * splat-transform v1.1 SVO 编码，但占用语义是碰撞表面与结构保护盒，未做胶囊 carve。
 *
 * 格式规范：https://developer.playcanvas.com/user-manual/splat-transform/voxel-format/
 *   - version 1.1，Laine–Karras 节点布局
 *   - nodes / leafData 均为小端 uint32 数组，拼接存放于 .voxel.bin
 *   - word === 0xFF000000            → 实心叶（整块实心）
 *   - (word >>> 24) === 0            → 混合叶，word 是 leafData 的「对」索引
 *   - 其它                            → 内部节点，childMask = word>>>24, firstChild = word & 0xFFFFFF
 *   - 混合叶 4×4×4 = 64 位占用掩码，bit = lx + (ly<<2) + (lz<<4)
 *   - **网格外一律视为实心**（碰撞/导航消费者约定），因此角色永远不会掉出世界
 *
 * 坐标系：
 *   默认 voxel 数据位于 PlayCanvas 引擎帧。本游戏的高斯场景实体额外应用了
 *   setLocalEulerAngles(180, 0, 0)（绕 X 轴 180°），因此
 *       world → voxel : (x, y, z) → (x, -y, -z)
 *       voxel → world : (x, y, z) → (x, -y, -z)   （自逆变换）
 *   室外场景可在生成前先 --rotate 180,0,0，让 floor-fill 沿游戏世界的 -Y
 *   方向工作；这类资产以 { frame: 'world' } 加载，不再做上述翻转。
 *   两种模式都不需要缩放或平移魔法数字。
 *
 * 提供能力：
 *   - isSolidAtWorld(x, y, z)                 单点实心查询，O(树深度)
 *   - isCapsuleBlocked(x, y, z, r, h)         胶囊体（圆柱近似）占位查询
 *   - sweepCapsule(from, to, r, h)            水平扫掠（CCD）：分步推进 + 轴向滑动
 *   - sweepCapsuleGrounded(from, to, r, h)   贴地水平扫掠：随地面高度连续推进
 *   - sweepCapsuleY(x, fromY, z, toY, r, h)   垂直扫掠（CCD）：逐体素推进 + 命中细化
 *   - groundHeightAt(x, z, fromY, maxDrop)    垂直向下体素射线，取得地面高度
 *   - ceilingHeightAt(x, z, fromY, maxRise)   垂直向上体素射线，取得天花板高度
 *   - resolvePenetration(x, y, z, r, h)       若已陷入实心，推挤到最近的自由位置
 *
 * 性能设计（体素细化到 0.05m 后的三项关键优化）：
 *   1. 采样图案按体素栅格去重 —— 圆周采样点在细栅格下大量落入同一体素，
 *      预计算阶段折叠为唯一体素偏移，采样次数直接减半以上。
 *   2. 叶块缓存 —— 相邻采样点绝大多数落在同一个 4³ 叶块内，缓存「上次命中的
 *      叶块及其掩码」可让连续查询退化为几次整数运算，无需重新下钻八叉树。
 *   3. 有界步长扫掠 —— 每次推进不超过半个体素，命中后再二分细化接触点。
 *      这条约束覆盖整段路径，而不只是终点；列扫描与叶块缓存承担查询加速。
 * ===================================================================
 */

(function (global) {
    'use strict';

    const SOLID_LEAF = 0xFF000000;
    const LEAF_SIZE = 4;               // 规范固定：每个叶块 4×4×4 体素
    const LOCAL_RELIEF_DIRECTIONS = Object.freeze([
        1, 0, -1, 0, 0, 1, 0, -1,
        Math.SQRT1_2, Math.SQRT1_2,
        Math.SQRT1_2, -Math.SQRT1_2,
        -Math.SQRT1_2, Math.SQRT1_2,
        -Math.SQRT1_2, -Math.SQRT1_2
    ]);

    class VoxelCollision {
        constructor(meta, binBuffer, options = {}) {
            this.meta = meta;
            this.frame = options.frame === 'world' || options.frame === 'identity'
                ? 'world'
                : 'engine-x180';

            const nodeCount = meta.nodeCount | 0;
            const leafDataCount = meta.leafDataCount | 0;

            // .voxel.bin = nodes(uint32 × nodeCount) ++ leafData(uint32 × leafDataCount)
            const expected = (nodeCount + leafDataCount) * 4;
            if (binBuffer.byteLength < expected) {
                throw new Error(
                    `voxel.bin 长度不符：期望 ${expected} 字节，实际 ${binBuffer.byteLength} 字节`
                );
            }

            this.nodes = new Uint32Array(binBuffer, 0, nodeCount);
            this.leafData = new Uint32Array(binBuffer, nodeCount * 4, leafDataCount);

            this.res = meta.voxelResolution;              // 单个体素边长（世界单位）
            this.invRes = 1 / this.res;
            this.minX = meta.gridBounds.min[0];
            this.minY = meta.gridBounds.min[1];
            this.minZ = meta.gridBounds.min[2];
            this.maxX = meta.gridBounds.max[0];
            this.maxY = meta.gridBounds.max[1];
            this.maxZ = meta.gridBounds.max[2];

            this.treeDepth = meta.treeDepth | 0;
            // 根立方体边长 = 2^treeDepth 个叶块，每块 LEAF_SIZE 个体素
            this.rootVoxels = (1 << this.treeDepth) * LEAF_SIZE;

            // 每轴的实际体素数（用于区分「网格外」与「根立方体内的空白余量」）
            this.dimX = Math.round((this.maxX - this.minX) / this.res);
            this.dimY = Math.round((this.maxY - this.minY) / this.res);
            this.dimZ = Math.round((this.maxZ - this.minZ) / this.res);

            this.isEmpty = nodeCount === 0;

            // ---- 叶块缓存（优化 2）----
            // 记录上一次下钻到的叶块原点与其解码结果，供空间相邻的后续查询复用。
            this._cacheOx = 0x7FFFFFFF;   // 不可能的原点，表示缓存为空
            this._cacheOy = 0;
            this._cacheOz = 0;
            this._cacheKind = 0;          // 0=无 1=全实 2=全空 3=混合
            this._cacheLo = 0;
            this._cacheHi = 0;

            this._patternKey = '';
            this._pattern = null;

            const configuredCorridors = Array.isArray(options.clearanceCorridors)
                ? options.clearanceCorridors
                : meta.navigation?.clearanceCorridors;
            this.clearanceCorridors = Array.isArray(configuredCorridors)
                ? configuredCorridors.map((corridor) => ({
                    minY: Number(corridor.minY),
                    maxY: Number(corridor.maxY),
                    radius: Number(corridor.radius),
                    points: Array.isArray(corridor.points)
                        ? corridor.points
                            .filter((point) => Array.isArray(point) && point.length >= 2)
                            .map((point) => [Number(point[0]), Number(point[1])])
                        : []
                })).filter((corridor) =>
                    Number.isFinite(corridor.minY) &&
                    Number.isFinite(corridor.maxY) &&
                    corridor.maxY > corridor.minY &&
                    Number.isFinite(corridor.radius) && corridor.radius > 0 &&
                    corridor.points.length >= 2 &&
                    corridor.points.every((point) => point.every(Number.isFinite))
                )
                : [];
        }

        // ---------------- 坐标变换 ----------------

        /**
         * 世界坐标 → voxel 帧。
         * 默认是历史引擎帧（绕 X 轴 180°，自逆）；world/identity 帧保持原值。
         * 第四个参数仍可传复用对象，也可以直接传 frame 字符串。
         */
        static worldToVoxel(x, y, z, out, frame) {
            if (typeof out === 'string' && frame === undefined) {
                frame = out;
                out = null;
            }
            out = out || { x: 0, y: 0, z: 0 };
            const identity = frame === 'world' || frame === 'identity';
            out.x = x; out.y = identity ? y : -y; out.z = identity ? z : -z;
            return out;
        }

        /** voxel 帧 → 世界坐标；frame 规则与 worldToVoxel 相同。 */
        static voxelToWorld(x, y, z, out, frame) {
            if (typeof out === 'string' && frame === undefined) {
                frame = out;
                out = null;
            }
            out = out || { x: 0, y: 0, z: 0 };
            const identity = frame === 'world' || frame === 'identity';
            out.x = x; out.y = identity ? y : -y; out.z = identity ? z : -z;
            return out;
        }

        // ---------------- 底层体素查询 ----------------

        /**
         * 查询 voxel 帧下整数体素坐标是否实心。
         * 网格外按规范一律视为实心。
         *
         * 优化 2：命中同一个 4³ 叶块时直接查缓存掩码，跳过整条八叉树下钻路径。
         * 胶囊采样与垂直射线都具有极强的空间局部性，这条快路径命中率很高。
         */
        isSolidVoxel(vx, vy, vz) {
            if (this.isEmpty) return true;               // 无数据 → 全实心，安全兜底

            // 网格外 → 实心（规范约定，防止角色走出可行走区域或掉出世界）
            if (vx < 0 || vy < 0 || vz < 0 ||
                vx >= this.dimX || vy >= this.dimY || vz >= this.dimZ) {
                return true;
            }

            // ---- 快路径：与上次查询落在同一叶块 ----
            const bx = vx & ~3, by = vy & ~3, bz = vz & ~3;
            if (bx === this._cacheOx && by === this._cacheOy && bz === this._cacheOz) {
                const kind = this._cacheKind;
                if (kind === 1) return true;
                if (kind === 2) return false;
                const bit = (vx - bx) + ((vy - by) << 2) + ((vz - bz) << 4);
                return bit < 32
                    ? ((this._cacheLo >>> bit) & 1) === 1
                    : ((this._cacheHi >>> (bit - 32)) & 1) === 1;
            }

            // ---- 慢路径：自根向下遍历八叉树 ----
            let nodeIdx = 0;
            let size = this.rootVoxels;
            let ox = 0, oy = 0, oz = 0;                  // 当前节点原点（体素坐标）

            for (let depth = 0; depth < this.treeDepth; depth++) {
                const word = this.nodes[nodeIdx];

                if (word === SOLID_LEAF) {
                    // 提前收敛的全实心子树：整块缓存为「全实」
                    this._setCache(bx, by, bz, 1, 0, 0);
                    return true;
                }
                if ((word >>> 24) === 0) break;          // 混合叶（理论上只在 treeDepth 层）

                const childMask = word >>> 24;
                const firstChild = word & 0xFFFFFF;

                const half = size >> 1;
                const cx = (vx - ox) >= half ? 1 : 0;
                const cy = (vy - oy) >= half ? 1 : 0;
                const cz = (vz - oz) >= half ? 1 : 0;
                const oct = cx | (cy << 1) | (cz << 2);

                if ((childMask & (1 << oct)) === 0) {
                    // 该八分区整体为空：把当前叶块记为「全空」
                    this._setCache(bx, by, bz, 2, 0, 0);
                    return false;
                }

                // 子节点按八分区索引升序紧密排列
                const rank = popcount32(childMask & ((1 << oct) - 1));
                nodeIdx = firstChild + rank;

                ox += cx * half;
                oy += cy * half;
                oz += cz * half;
                size = half;
            }

            // 到达叶块层
            const word = this.nodes[nodeIdx];
            if (word === SOLID_LEAF) {
                this._setCache(bx, by, bz, 1, 0, 0);
                return true;
            }

            if ((word >>> 24) === 0) {
                // 混合叶：word 是 leafData 的「对」索引
                const pair = word & 0xFFFFFF;
                const lo = this.leafData[pair * 2];
                const hi = this.leafData[pair * 2 + 1];
                this._setCache(ox, oy, oz, 3, lo, hi);

                const lx = vx - ox;
                const ly = vy - oy;
                const lz = vz - oz;
                if (lx < 0 || ly < 0 || lz < 0 || lx > 3 || ly > 3 || lz > 3) return false;

                const bit = lx + (ly << 2) + (lz << 4);
                return bit < 32
                    ? ((lo >>> bit) & 1) === 1
                    : ((hi >>> (bit - 32)) & 1) === 1;
            }

            this._setCache(bx, by, bz, 2, 0, 0);
            return false;
        }

        _setCache(ox, oy, oz, kind, lo, hi) {
            this._cacheOx = ox; this._cacheOy = oy; this._cacheOz = oz;
            this._cacheKind = kind; this._cacheLo = lo; this._cacheHi = hi;
        }

        /**
         * 定位包含体素 (vx, vy, vz) 的叶块，返回其解码结果。
         * 这是 isSolidVoxel 慢路径的公共部分，单独抽出以供列扫描复用。
         *
         * @returns {number} 1 = 整块实心，2 = 整块空，3 = 混合（掩码写入 _blockLo/_blockHi）
         *                   混合时 _blockOx/_blockOy/_blockOz 为叶块原点
         */
        _locateBlock(vx, vy, vz) {
            let nodeIdx = 0;
            let size = this.rootVoxels;
            let ox = 0, oy = 0, oz = 0;

            for (let depth = 0; depth < this.treeDepth; depth++) {
                const word = this.nodes[nodeIdx];
                if (word === SOLID_LEAF) { this._blockOx = ox; this._blockOy = oy; this._blockOz = oz; this._blockSize = size; return 1; }
                if ((word >>> 24) === 0) break;

                const childMask = word >>> 24;
                const firstChild = word & 0xFFFFFF;
                const half = size >> 1;
                const cx = (vx - ox) >= half ? 1 : 0;
                const cy = (vy - oy) >= half ? 1 : 0;
                const cz = (vz - oz) >= half ? 1 : 0;
                const oct = cx | (cy << 1) | (cz << 2);

                if ((childMask & (1 << oct)) === 0) {
                    this._blockOx = ox + cx * half;
                    this._blockOy = oy + cy * half;
                    this._blockOz = oz + cz * half;
                    this._blockSize = half;
                    return 2;
                }

                nodeIdx = firstChild + popcount32(childMask & ((1 << oct) - 1));
                ox += cx * half; oy += cy * half; oz += cz * half;
                size = half;
            }

            const word = this.nodes[nodeIdx];
            this._blockOx = ox; this._blockOy = oy; this._blockOz = oz;
            this._blockSize = size;
            if (word === SOLID_LEAF) return 1;
            if ((word >>> 24) === 0) {
                const pair = word & 0xFFFFFF;
                this._blockLo = this.leafData[pair * 2];
                this._blockHi = this.leafData[pair * 2 + 1];
                return 3;
            }
            return 2;
        }

        /**
         * 垂直列扫描：判断体素列 (vx, vz) 在 [vy0, vy1] 闭区间内是否存在实心体素。
         *
         * 这是胶囊查询的核心加速手段。朴素做法对每一层各下钻一次八叉树
         * （res=0.05 时约 27 层 × 6 级 = 162 次节点访问）；列扫描则利用
         * 「叶块沿 Y 覆盖连续 4 格、且空/实块可能覆盖更大范围」的性质，
         * 每次下钻后直接把该块覆盖的整段 Y 一次性判完，再跳到块外继续。
         * 实测下钻次数从 27 次降到 6~8 次。
         */
        _columnHasSolid(vx, vz, vy0, vy1) {
            // 列本身在网格外 → 实心（规范约定）
            if (vx < 0 || vz < 0 || vx >= this.dimX || vz >= this.dimZ) return true;
            // 区间超出网格上下界 → 实心
            if (vy0 < 0 || vy1 >= this.dimY) return true;

            let vy = vy0;
            while (vy <= vy1) {
                const kind = this._locateBlock(vx, vy, vz);

                if (kind === 1) return true;                  // 整块实心

                if (kind === 3) {
                    // 混合叶：逐位测试该叶块覆盖的 Y 段（最多 4 格）
                    const bOy = this._blockOy;
                    const lx = vx - this._blockOx;
                    const lz = vz - this._blockOz;
                    const lo = this._blockLo, hi = this._blockHi;
                    const yEnd = Math.min(vy1, bOy + 3);
                    for (let y = vy; y <= yEnd; y++) {
                        const bit = lx + ((y - bOy) << 2) + (lz << 4);
                        const solid = bit < 32
                            ? ((lo >>> bit) & 1) === 1
                            : ((hi >>> (bit - 32)) & 1) === 1;
                        if (solid) return true;
                    }
                    vy = bOy + 4;
                    continue;
                }

                // kind === 2：整块空，直接跳过该块覆盖的整段 Y
                vy = this._blockOy + this._blockSize;
            }
            return false;
        }

        /** 世界坐标下的列查询：判断 (x, z) 处 [yBottom, yTop] 区间是否存在实心。 */
        _columnHasSolidWorld(x, z, yBottom, yTop) {
            if (this._columnIsInClearanceCorridor(x, z, yBottom, yTop)) {
                return false;
            }
            if (this.frame === 'world') {
                const vx = Math.floor((x - this.minX) * this.invRes);
                const vz = Math.floor((z - this.minZ) * this.invRes);
                const vyA = Math.floor((yBottom - this.minY) * this.invRes);
                const vyB = Math.floor((yTop - this.minY) * this.invRes);
                return this._columnHasSolid(vx, vz, Math.min(vyA, vyB), Math.max(vyA, vyB));
            }

            // world → voxel 为 (x, -y, -z)，Y 取反后区间上下界互换
            const vx = Math.floor((x - this.minX) * this.invRes);
            const vz = Math.floor((-z - this.minZ) * this.invRes);
            const vyA = Math.floor((-yTop - this.minY) * this.invRes);
            const vyB = Math.floor((-yBottom - this.minY) * this.invRes);
            return this._columnHasSolid(vx, vz, Math.min(vyA, vyB), Math.max(vyA, vyB));
        }

        _columnIsInClearanceCorridor(x, z, yBottom, yTop) {
            for (const corridor of this.clearanceCorridors) {
                if (yBottom < corridor.minY || yTop > corridor.maxY) continue;
                const radiusSq = corridor.radius * corridor.radius;
                for (let i = 1; i < corridor.points.length; i++) {
                    const from = corridor.points[i - 1];
                    const to = corridor.points[i];
                    const dx = to[0] - from[0];
                    const dz = to[1] - from[1];
                    const lengthSq = dx * dx + dz * dz;
                    const t = lengthSq > 0
                        ? Math.max(0, Math.min(1,
                            ((x - from[0]) * dx + (z - from[1]) * dz) / lengthSq
                        ))
                        : 0;
                    const offsetX = x - (from[0] + dx * t);
                    const offsetZ = z - (from[1] + dz * t);
                    if (offsetX * offsetX + offsetZ * offsetZ <= radiusSq) {
                        return true;
                    }
                }
            }
            return false;
        }

        /** 查询 voxel 帧下的浮点位置是否实心。 */
        isSolidVoxelPos(x, y, z) {
            const vx = Math.floor((x - this.minX) * this.invRes);
            const vy = Math.floor((y - this.minY) * this.invRes);
            const vz = Math.floor((z - this.minZ) * this.invRes);
            return this.isSolidVoxel(vx, vy, vz);
        }

        /** 查询世界坐标点是否实心。 */
        isSolidAtWorld(x, y, z) {
            if (this.frame === 'world') return this.isSolidVoxelPos(x, y, z);
            return this.isSolidVoxelPos(x, -y, -z);
        }

        // ---------------- 角色体积查询 ----------------

        /**
         * 预计算并缓存胶囊体的采样图案。
         *
         * 采样密度仅取决于 (r, h, res)，与位置无关，因此可以一次算好反复使用。
         *
         * 采样安全性：相邻采样点的间距必须小于一个体素边长，否则体素可能从采样点
         * 之间「漏过」。圆周弧长 = 2πr / n，令其 < res 即得 n > 2πr/res。
         *
         * 优化 1（栅格去重）：res = 0.05 时圆周需要 37 个点、垂直需要 27 层，
         * 朴素做法是 37 × 27 ≈ 1000 次查询。但半径 0.25 的圆周上相邻两点相距
         * 仅 0.042 m，小于体素边长，因此大量点落在**同一个体素**里。
         * 这里把水平偏移换算成「体素索引偏移」后去重，
         * 采样次数因此降到理论下限而不损失任何覆盖度。
         *
         * 注意去重只在「体素索引」层面进行，而体素索引依赖角色的绝对位置。
         * 为保证与位置无关，这里以 res 为量化单位对偏移取整去重：两个偏移若
         * 量化到同一格，则对任意角色位置它们至多相差一格，而相差一格的情形
         * 已被相邻的其它采样点覆盖（间距 < res 的密度保证）。
         */
        _capsulePattern(r, h) {
            const key = `${r}|${h}`;
            if (this._patternKey === key) return this._pattern;

            const res = this.res;
            // Stay just clear of the supporting surface without leaving a gap
            // large enough to miss low furniture edges.
            const inset = Math.min(res * 0.6, h * 0.02);
            const yBottom = inset;
            const yTop = h - inset;

            // ---- 水平偏移：覆盖完整圆盘的同心环，按 res 量化去重 ----
            // 垂直方向无需分层：_columnHasSolid 会把 [yBottom, yTop] 区间内
            // 每一个体素都真正遍历到（而非采样），覆盖度严于逐层采样。
            const hSeen = new Set();
            const offs = [];
            const bottoms = [];
            const tops = [];
            const pushOff = (ox, oz) => {
                const k = `${Math.round(ox / res)},${Math.round(oz / res)}`;
                if (hSeen.has(k)) return;
                hSeen.add(k);
                offs.push(ox, oz);
                // A vertical capsule is a cylinder between two spherical caps.
                // At horizontal distance d from the axis, the occupied vertical
                // interval narrows by r - sqrt(r^2 - d^2) at both ends.
                const distanceSq = Math.min(r * r, ox * ox + oz * oz);
                const capReach = Math.sqrt(Math.max(0, r * r - distanceSq));
                bottoms.push(Math.max(inset, r - capReach + inset));
                tops.push(Math.min(h - inset, h - r + capReach - inset));
            };

            pushOff(0, 0);                                   // 中轴恒为第 0 个
            const radialSteps = Math.max(1, Math.ceil(r / (res * 0.8)));
            for (let ring = 1; ring <= radialSteps; ring++) {
                const ringRadius = r * (ring / radialSteps);
                const ringSteps = Math.max(
                    6,
                    Math.ceil((2 * Math.PI * ringRadius) / (res * 0.85))
                );
                const phase = (ring & 1) ? Math.PI / ringSteps : 0;
                for (let k = 0; k < ringSteps; k++) {
                    const a = (k / ringSteps) * Math.PI * 2 + phase;
                    pushOff(Math.cos(a) * ringRadius, Math.sin(a) * ringRadius);
                }
            }

            this._patternKey = key;
            this._pattern = {
                yBottom: yBottom,
                yTop: yTop,
                offs: new Float64Array(offs),
                bottoms: new Float64Array(bottoms),
                tops: new Float64Array(tops)
            };
            return this._pattern;
        }

        /**
         * 判断以 (x, y, z) 为脚底、半径 r、身高 h 的角色胶囊体是否与实心体素重叠。
         *
         * 实现为「若干根垂直采样柱的列扫描」：水平方向以同心环覆盖完整圆盘，
         * 垂直方向则由 _columnHasSolid **完整遍历**区间内每一个体素。径向与圆周
         * 采样间距都小于一个体素边长，适用于未经胶囊 carve 的表面占用数据。
         *
         * 中轴（offs 的第 0 个偏移）排在最前，因为「脚下有台阶 / 头顶撞天花板」
         * 这类情形绝大多数在中轴就能短路返回。
         */
        isCapsuleBlocked(x, y, z, r, h) {
            const pat = this._capsulePattern(r, h);
            const offs = pat.offs;
            const bottoms = pat.bottoms;
            const tops = pat.tops;
            const nOff = offs.length >> 1;

            // 逐根采样柱做列扫描。第 0 个偏移恒为中轴，把它排在最前：
            // 「脚下有台阶 / 头顶撞天花板」这类情形绝大多数在中轴就能短路。
            for (let k = 0; k < nOff; k++) {
                if (this._columnHasSolidWorld(
                    x + offs[k * 2],
                    z + offs[k * 2 + 1],
                    y + bottoms[k],
                    y + tops[k]
                )) {
                    return true;
                }
            }
            return false;
        }

        /**
         * 沿 Y 轴连续扫掠胶囊体，返回本次位移中最后一个自由位置。
         *
         * 跳跃速度在低帧率下可能一次跨过数个体素，因此不能只检查目标点。
         * 这里把位移均分为不超过半个体素的小段；首次命中后，再在“最后自由点 / 
         * 首个阻塞点”之间二分细化。这个过程对上升和下降完全对称，也不会漏过
         * 单层体素厚度的顶棚或地面。
         *
         * @returns {{y:number, hit:boolean, startedBlocked:boolean}}
         */
        sweepCapsuleY(x, fromY, z, toY, r, h) {
            const dy = toY - fromY;
            if (Math.abs(dy) < 1e-9) {
                return { y: fromY, hit: false, startedBlocked: false };
            }

            if (this.isCapsuleBlocked(x, fromY, z, r, h)) {
                return { y: fromY, hit: true, startedBlocked: true };
            }

            const maxStep = this.res * 0.5;
            const steps = Math.max(1, Math.ceil(Math.abs(dy) / maxStep));
            let freeY = fromY;

            for (let i = 1; i <= steps; i++) {
                const probeY = fromY + dy * (i / steps);
                if (!this.isCapsuleBlocked(x, probeY, z, r, h)) {
                    freeY = probeY;
                    continue;
                }

                let blockedY = probeY;
                // Direction-independent refinement: freeY is known free and
                // blockedY is known blocked, regardless of which is numerically larger.
                for (let k = 0; k < 12; k++) {
                    const midY = (freeY + blockedY) * 0.5;
                    if (this.isCapsuleBlocked(x, midY, z, r, h)) {
                        blockedY = midY;
                    } else {
                        freeY = midY;
                    }
                }
                return { y: freeY, hit: true, startedBlocked: false };
            }

            return { y: toY, hit: false, startedBlocked: false };
        }

        /**
         * 胶囊体扫掠移动（连续碰撞检测）。
         *
         * 位移严格切成不超过半个体素的小步。这样即使阻挡只占一层体素，路径上也
         * 至少会命中一次；首次命中后在最后自由点与首个阻塞点之间二分细化，再尝试
         * 单轴滑动。不能只试中点和终点：薄壁恰好位于两者之间时会被跳过。
         *
         * @returns {{x:number, z:number, hitX:boolean, hitZ:boolean}}
         */
        sweepCapsule(fromX, y, fromZ, toX, toZ, r, h) {
            let curX = fromX, curZ = fromZ;
            let hitX = false, hitZ = false;

            const dx = toX - fromX;
            const dz = toZ - fromZ;
            const dist = Math.hypot(dx, dz);
            if (dist < 1e-9) return { x: curX, z: curZ, hitX, hitZ };

            const res = this.res;
            const minStep = res * 0.5;          // 最终推进粒度上限：半个体素
            const adv = this._sweepSegment(curX, y, curZ, toX, toZ, r, h, minStep);
            curX = adv.x;
            curZ = adv.z;

            if (!adv.done) {
                const remX = toX - curX;
                const remZ = toZ - curZ;
                const slideX = this._sweepSegment(curX, y, curZ, curX + remX, curZ, r, h, minStep);
                const slideZ = this._sweepSegment(curX, y, curZ, curX, curZ + remZ, r, h, minStep);
                const gainX = Math.abs(slideX.x - curX);
                const gainZ = Math.abs(slideZ.z - curZ);

                if (gainX >= gainZ && gainX > 1e-9) {
                    curX = slideX.x;
                    hitZ = true;
                } else if (gainZ > 1e-9) {
                    curZ = slideZ.z;
                    hitX = true;
                } else {
                    hitX = true; hitZ = true;
                }
            }

            return { x: curX, z: curZ, hitX, hitZ };
        }

        /**
         * 沿地面进行水平连续扫掠。
         *
         * 普通 sweepCapsule 的 Y 是固定的，适合跳跃中的水平移动，但在行走时会
         * 把仅高一个体素的坡面误判成竖直墙。本方法在每个不超过半体素的水平子步
         * 重新求脚底地面，并在新高度复核完整胶囊净空；因此上/下坡不会卡住，同时
         * 仍然保留严格 CCD、墙体阻挡和单轴滑动。
         *
         * options:
         *   maxStepUp / maxStepDown  自动跨越的局部高度限制（米）
         *   supportRadius            可选脚底支撑采样半径（默认关闭）
         *   supportDrop              允许脚底支撑点的最大高度差
         *   localReliefRadius        向上移动时检查周围低位支撑的半径
         *   maxLocalRelief           允许自动走上的最大局部地形起伏
         *   groundHeightAt           可选外部地面查询回调
         *   isBlocked                可选外部胶囊阻挡回调（用于动态道具）
         *
         * @returns {{x:number,y:number,z:number,hit:boolean,grounded:boolean,
         *            reason:string,maxDeltaY:number}}
         */
        sweepCapsuleGrounded(fromX, fromY, fromZ, toX, toZ, r, h, options = {}) {
            const maxStepUp = Math.max(0, Number.isFinite(options.maxStepUp)
                ? options.maxStepUp : Math.max(0.22, this.res * 5));
            const maxStepDown = Math.max(0, Number.isFinite(options.maxStepDown)
                ? options.maxStepDown : Math.max(0.32, this.res * 7));
            const maxStep = Math.min(
                Math.max(this.res * 0.5, Number(options.maxHorizontalStep) || this.res * 0.5),
                this.res * 0.5
            );
            const blockedQuery = typeof options.isBlocked === 'function'
                ? options.isBlocked
                : (x, y, z) => this.isCapsuleBlocked(x, y, z, r, h);
            const skin = Math.max(0.015, Number.isFinite(options.skin)
                ? options.skin : this.res * 0.35);

            const dx = toX - fromX;
            const dz = toZ - fromZ;
            const dist = Math.hypot(dx, dz);
            if (blockedQuery(fromX, fromY, fromZ)) {
                const recoveredY = this._lowestFreeFootY(
                    fromX, fromY, fromZ, skin, blockedQuery
                );
                if (recoveredY === null) {
                    return {
                        x: fromX, y: fromY, z: fromZ, hit: true, grounded: false,
                        reason: 'start-blocked', maxDeltaY: 0
                    };
                }
                fromY = recoveredY;
            }

            if (dist < 1e-9) {
                return {
                    x: fromX, y: fromY, z: fromZ, hit: false, grounded: true,
                    reason: '', maxDeltaY: 0
                };
            }

            // Keep the actual centre-ray support separate from the raised foot
            // height. Without this distinction, repeated sub-steps can ratchet
            // the capsule up a vertical furniture edge and eventually hide a
            // single over-limit step behind many small lifts.
            const sampleGround = (x, z, baseY, referenceGroundY) =>
                this._groundedFootInfoAt(
                    x, z, baseY, r, h, options, referenceGroundY
                );

            const startGround = sampleGround(fromX, fromZ, fromY, fromY);
            if (!startGround) {
                return {
                    x: fromX, y: fromY, z: fromZ, hit: true, grounded: false,
                    reason: 'no-ground', maxDeltaY: 0
                };
            }

            const sweepSegment = (ax, ay, az, bx, bz, initialGroundY) => {
                const sx = bx - ax;
                const sz = bz - az;
                const len = Math.hypot(sx, sz);
                if (len < 1e-9) {
                    return {
                        x: ax, y: ay, z: az, done: true, deltaY: 0,
                        groundY: initialGroundY
                    };
                }

                const steps = Math.max(1, Math.ceil(len / maxStep));
                let freeX = ax, freeY = ay, freeZ = az;
                let freeGroundY = initialGroundY;
                for (let i = 1; i <= steps; i++) {
                    const t = i / steps;
                    const px = ax + sx * t;
                    const pz = az + sz * t;
                    const ground = sampleGround(px, pz, freeY, freeGroundY);
                    if (!ground) {
                        // Refine the first invalid sub-step. The free height is
                        // carried forward so a gentle slope remains continuous.
                        let lo = 0, hi = 1;
                        let bestX = freeX, bestY = freeY, bestZ = freeZ;
                        let bestGroundY = freeGroundY;
                        for (let k = 0; k < 9; k++) {
                            const mt = (lo + hi) * 0.5;
                            const mx = ax + sx * ((i - 1 + mt) / steps);
                            const mz = az + sz * ((i - 1 + mt) / steps);
                            const midGround = sampleGround(mx, mz, bestY, bestGroundY);
                            if (!midGround) {
                                hi = mt;
                            } else {
                                lo = mt;
                                bestX = mx;
                                bestY = midGround.y;
                                bestZ = mz;
                                bestGroundY = midGround.groundY;
                            }
                        }
                        return {
                            x: bestX, y: bestY, z: bestZ, done: false,
                            deltaY: bestY - ay, groundY: bestGroundY
                        };
                    }
                    freeX = px;
                    freeY = ground.y;
                    freeZ = pz;
                    freeGroundY = ground.groundY;
                }
                return {
                    x: bx, y: freeY, z: bz, done: true,
                    deltaY: freeY - ay, groundY: freeGroundY
                };
            };

            let curX = fromX, curY = fromY, curZ = fromZ;
            let maxDeltaY = 0;
            const first = sweepSegment(
                curX, curY, curZ, toX, toZ, startGround.groundY
            );
            curX = first.x; curY = first.y; curZ = first.z;
            maxDeltaY = Math.max(maxDeltaY, Math.abs(first.deltaY));
            if (first.done) {
                return { x: curX, y: curY, z: curZ, hit: false, grounded: true, reason: '', maxDeltaY };
            }

            // Preserve the old wall-sliding feel, but run each slide through the
            // same ground-following checks so a slide cannot climb a forbidden lip.
            const remX = toX - curX;
            const remZ = toZ - curZ;
            const slideX = sweepSegment(
                curX, curY, curZ, curX + remX, curZ, first.groundY
            );
            const slideZ = sweepSegment(
                curX, curY, curZ, curX, curZ + remZ, first.groundY
            );
            const gainX = Math.abs(slideX.x - curX);
            const gainZ = Math.abs(slideZ.z - curZ);
            if (gainX >= gainZ && gainX > 1e-9) {
                curX = slideX.x; curY = slideX.y;
                maxDeltaY = Math.max(maxDeltaY, Math.abs(slideX.deltaY));
            } else if (gainZ > 1e-9) {
                curZ = slideZ.z; curY = slideZ.y;
                maxDeltaY = Math.max(maxDeltaY, Math.abs(slideZ.deltaY));
            }
            return {
                x: curX, y: curY, z: curZ, hit: true, grounded: true,
                reason: 'blocked', maxDeltaY
            };
        }

        /**
         * 求一个 XZ 位置上与当前脚底连续的最低合法站立高度。
         * 该函数与 sweepCapsuleGrounded 共用 raise/drop 规则，供静止帧复核使用，
         * 避免角色停在体素台阶前沿时被中心射线错误压回较低地面。
         */
        groundedFootHeightAt(x, z, baseY, r, h, options = {}) {
            const result = this._groundedFootInfoAt(
                x, z, baseY, r, h, options, baseY
            );
            return result ? result.y : null;
        }

        /** Internal form that also returns the centre-ray support height. */
        _groundedFootInfoAt(x, z, baseY, r, h, options = {}, referenceGroundY = baseY) {
            const maxStepUp = Math.max(0, Number.isFinite(options.maxStepUp)
                ? options.maxStepUp : Math.max(0.22, this.res * 5));
            const maxStepDown = Math.max(0, Number.isFinite(options.maxStepDown)
                ? options.maxStepDown : Math.max(0.32, this.res * 7));
            const supportRadius = Math.max(0, Number.isFinite(options.supportRadius)
                ? options.supportRadius : 0);
            const supportDrop = Math.max(0, Number.isFinite(options.supportDrop)
                ? options.supportDrop : Math.max(0.28, this.res * 6));
            const localReliefRadius = Math.max(0, Number.isFinite(options.localReliefRadius)
                ? options.localReliefRadius : 0);
            const maxLocalRelief = Math.max(0, Number.isFinite(options.maxLocalRelief)
                ? options.maxLocalRelief : 0);
            const skin = Math.max(0.015, Number.isFinite(options.skin)
                ? options.skin : this.res * 0.35);
            const groundQuery = typeof options.groundHeightAt === 'function'
                ? options.groundHeightAt
                : (gx, gz, top, drop) => this.groundHeightAt(gx, gz, top, drop);
            const blockedQuery = typeof options.isBlocked === 'function'
                ? options.isBlocked
                : (gx, gy, gz) => this.isCapsuleBlocked(gx, gy, gz, r, h);

            const top = baseY + maxStepUp + skin;
            const drop = maxStepDown + maxStepUp + skin * 2;
            const center = groundQuery(x, z, top, drop);
            if (!Number.isFinite(center)) return null;

            const continuityY = Number.isFinite(referenceGroundY)
                ? referenceGroundY : baseY;
            const delta = center - continuityY;
            if (delta > maxStepUp + skin || delta < -maxStepDown - skin) return null;

            let footY = center;
            if (blockedQuery(x, footY + skin, z)) {
                // At a voxel step the centre ray can still see the lower
                // surface while the capsule rim already touches the next
                // (higher) cell. Lift within the configured step budget,
                // just like a standard raise-move-drop character controller.
                // isCapsuleBlocked deliberately starts above the exact foot
                // plane. Subtract that inset here so maxStepUp remains a limit
                // on the physical surface height, not on the sampled cylinder.
                const capsuleBottomInset = this._capsulePattern(r, h).yBottom;
                const liftLimit = continuityY + Math.max(0, maxStepUp - capsuleBottomInset);
                const liftStep = this.res * 0.5;
                let freeLift = null;
                // If the current foot height is already free, retain it. This
                // prevents an idle character on a voxel lip from gaining one
                // liftStep every frame.
                if (baseY >= center - skin && !blockedQuery(x, baseY + skin, z)) {
                    freeLift = baseY;
                }
                for (let y = Math.max(center, baseY) + liftStep;
                     freeLift === null &&
                     y <= liftLimit + 1e-9;
                     y += liftStep) {
                    if (!blockedQuery(x, y + skin, z)) {
                        freeLift = y;
                        break;
                    }
                }
                if (freeLift === null) return null;
                footY = freeLift;
            }

            // Every returned foot height must also be a valid input for the next
            // frame. Ground sampling works with a skin offset, while the sweep
            // entrance deliberately checks the exact capsule pose. At voxel
            // boundaries that difference can otherwise leave the capsule about
            // 1.5 cm inside a cell and make every direction report start-blocked.
            const exactFootY = this._lowestFreeFootY(
                x, footY, z, skin, blockedQuery
            );
            if (exactFootY === null) return null;
            footY = exactFootY;

            // A vertical furniture edge can appear as several 5 cm ledges to a
            // centre-ray controller. Reject only upward candidates whose nearby
            // support varies too much; flat movement after a real jump is left
            // untouched, so elevated platforms remain usable once reached.
            if (localReliefRadius > 1e-6 && maxLocalRelief > 1e-6 &&
                footY > baseY + skin) {
                const reliefTop = Math.max(top, footY + skin);
                const reliefDrop = maxStepDown + maxStepUp + maxLocalRelief + skin * 2;
                const reliefLimit = maxLocalRelief + this.res * 0.1;
                if (footY - center > reliefLimit) return null;
                for (let i = 0; i < LOCAL_RELIEF_DIRECTIONS.length; i += 2) {
                    const sy = groundQuery(
                        x + LOCAL_RELIEF_DIRECTIONS[i] * localReliefRadius,
                        z + LOCAL_RELIEF_DIRECTIONS[i + 1] * localReliefRadius,
                        reliefTop,
                        reliefDrop
                    );
                    if (Number.isFinite(sy) && footY - sy > reliefLimit) return null;
                }
            }

            if (supportRadius > 1e-6) {
                const offsets = [
                    [supportRadius, 0], [-supportRadius, 0],
                    [0, supportRadius], [0, -supportRadius]
                ];
                let valid = 1;
                let missing = 0;
                let low = 0;
                for (const [ox, oz] of offsets) {
                    const sy = groundQuery(x + ox, z + oz, top, drop);
                    if (!Number.isFinite(sy)) {
                        missing++;
                        continue;
                    }
                    valid++;
                    if (sy < center - supportDrop) low++;
                }
                if (valid < 3 || missing > 2 || low > 1) return null;
            }
            return { y: footY, groundY: center };
        }

        /**
         * Return the lowest exact free foot height in [footY, footY + skin].
         * This is a vertical-only skin correction: it cannot cross a wall or
         * enlarge the horizontal walkable range.
         */
        _lowestFreeFootY(x, footY, z, skin, blockedQuery) {
            if (!blockedQuery(x, footY, z)) return footY;

            const highY = footY + skin;
            if (blockedQuery(x, highY, z)) return null;

            let low = footY;
            let high = highY;
            for (let i = 0; i < 12; i++) {
                const mid = (low + high) * 0.5;
                if (blockedQuery(x, mid, z)) low = mid;
                else high = mid;
            }
            return high;
        }

        /**
         * 在一条直线段上尽可能推进，返回可达到的最远自由位置。
         * 全程以不超过 minStep 的步长推进；命中后在最后自由点与阻塞点间二分。
         *
         * @returns {{x:number, z:number, done:boolean}} done 表示走完了整段
         */
        _sweepSegment(fromX, y, fromZ, toX, toZ, r, h, minStep) {
            const dx = toX - fromX;
            const dz = toZ - fromZ;
            const len = Math.hypot(dx, dz);
            if (len < 1e-9) return { x: fromX, z: fromZ, done: true };

            const steps = Math.max(1, Math.ceil(len / minStep));
            let freeX = fromX;
            let freeZ = fromZ;
            for (let i = 1; i <= steps; i++) {
                const blockedX = fromX + dx * (i / steps);
                const blockedZ = fromZ + dz * (i / steps);
                if (!this.isCapsuleBlocked(blockedX, y, blockedZ, r, h)) {
                    freeX = blockedX;
                    freeZ = blockedZ;
                    continue;
                }

                let loX = freeX, loZ = freeZ;
                let hiX = blockedX, hiZ = blockedZ;
                for (let k = 0; k < 10; k++) {
                    const midX = (loX + hiX) * 0.5;
                    const midZ = (loZ + hiZ) * 0.5;
                    if (this.isCapsuleBlocked(midX, y, midZ, r, h)) {
                        hiX = midX;
                        hiZ = midZ;
                    } else {
                        loX = midX;
                        loZ = midZ;
                    }
                }
                return { x: loX, z: loZ, done: false };
            }
            return { x: toX, z: toZ, done: true };
        }

        // ---------------- 垂直射线 ----------------

        /**
         * 从 (x, fromY, z) 向下投射体素射线，返回最近可站立表面的世界 Y。
         * 未命中时返回 null（调用方可据此判断悬空）。
         */
        groundHeightAt(x, z, fromY, maxDrop) {
            const res = this.res;
            const step = res * 0.5;
            const limit = Math.max(1, Math.ceil((maxDrop || 50) / step));

            let y = fromY;
            let wasSolid = this.isSolidAtWorld(x, y, z);

            for (let i = 0; i < limit; i++) {
                const ny = y - step;
                const solid = this.isSolidAtWorld(x, ny, z);

                if (solid && !wasSolid) {
                    // 在 [ny, y] 之间发生「空 → 实」跃变，二分细化表面高度
                    let lo = ny, hi = y;
                    for (let k = 0; k < 12; k++) {
                        const mid = (lo + hi) * 0.5;
                        if (this.isSolidAtWorld(x, mid, z)) lo = mid; else hi = mid;
                    }
                    return hi;
                }
                y = ny;
                wasSolid = solid;
            }
            return null;
        }

        /**
         * 从 (x, fromY, z) 向上投射体素射线，返回最近天花板的世界 Y。
         * 未命中时返回 null。
         */
        ceilingHeightAt(x, z, fromY, maxRise) {
            const res = this.res;
            const step = res * 0.5;
            const limit = Math.max(1, Math.ceil((maxRise || 10) / step));

            let y = fromY;
            let wasSolid = this.isSolidAtWorld(x, y, z);

            for (let i = 0; i < limit; i++) {
                const ny = y + step;
                const solid = this.isSolidAtWorld(x, ny, z);
                if (solid && !wasSolid) {
                    let lo = y, hi = ny;
                    for (let k = 0; k < 12; k++) {
                        const mid = (lo + hi) * 0.5;
                        if (this.isSolidAtWorld(x, mid, z)) hi = mid; else lo = mid;
                    }
                    return lo;
                }
                y = ny;
                wasSolid = solid;
            }
            return null;
        }

        /**
         * 若角色已经陷入实心（例如出生点不合法、或数据边界变化），
         * 以螺旋方式在水平面 + 少量垂直偏移上搜索最近的自由位置。
         * @returns {{x:number,y:number,z:number}|null}
         */
        resolvePenetration(x, y, z, r, h) {
            if (!this.isCapsuleBlocked(x, y, z, r, h)) return { x, y, z };

            const res = this.res;
            const maxRing = 40;                           // 最远搜索约 40 * res = 2m
            for (let ring = 1; ring <= maxRing; ring++) {
                const rad = ring * res;
                const samples = Math.max(8, ring * 6);
                for (let dy = 0; dy <= 2; dy++) {
                    for (const sign of (dy === 0 ? [0] : [1, -1])) {
                        const ty = y + sign * dy * res * 2;
                        for (let k = 0; k < samples; k++) {
                            const a = (k / samples) * Math.PI * 2;
                            const tx = x + Math.cos(a) * rad;
                            const tz = z + Math.sin(a) * rad;
                            if (!this.isCapsuleBlocked(tx, ty, tz, r, h)) {
                                return { x: tx, y: ty, z: tz };
                            }
                        }
                    }
                }
            }
            return null;
        }

        // ---------------- 元信息 ----------------

        /** 返回可行走区域在**世界坐标**下的包围盒。 */
        getWorldBounds() {
            if (this.frame === 'world') {
                return {
                    min: [this.minX, this.minY, this.minZ],
                    max: [this.maxX, this.maxY, this.maxZ]
                };
            }

            // gridBounds 在 voxel 帧；world = (x, -y, -z)，注意 min/max 会交换
            return {
                min: [this.minX, -this.maxY, -this.maxZ],
                max: [this.maxX, -this.minY, -this.minZ]
            };
        }

        describe() {
            const b = this.getWorldBounds();
            return [
                `体素分辨率 ${this.res}m`,
                `树深度 ${this.treeDepth}`,
                `坐标帧 ${this.frame}`,
                `内部节点 ${this.meta.numInteriorNodes}`,
                `混合叶 ${this.meta.numMixedLeaves}`,
                `世界包围盒 X[${b.min[0].toFixed(2)}, ${b.max[0].toFixed(2)}]`,
                `Y[${b.min[1].toFixed(2)}, ${b.max[1].toFixed(2)}]`,
                `Z[${b.min[2].toFixed(2)}, ${b.max[2].toFixed(2)}]`
            ].join(' | ');
        }
    }

    /**
     * 载入一对 .voxel.json / .voxel.bin。
     * 二进制文件名由规范约定：把 .voxel.json 后缀替换为 .voxel.bin。
     */
    async function loadVoxelCollision(voxelJsonUrl, options = {}) {
        const metaRes = await fetch(voxelJsonUrl);
        if (!metaRes.ok) {
            throw new Error(`无法加载 ${voxelJsonUrl}（HTTP ${metaRes.status}）`);
        }
        const meta = await metaRes.json();

        const major = parseInt(String(meta.version).split('.')[0], 10);
        if (!(major <= 1)) {
            throw new Error(`不支持的 voxel 格式主版本：${meta.version}`);
        }

        const binUrl = voxelJsonUrl.replace(/\.voxel\.json$/i, '.voxel.bin');
        const binRes = await fetch(binUrl);
        if (!binRes.ok) {
            throw new Error(`无法加载 ${binUrl}（HTTP ${binRes.status}）`);
        }
        const binBuffer = await binRes.arrayBuffer();

        return new VoxelCollision(meta, binBuffer, options);
    }

    // 32 位整数的 popcount（SWAR 算法）
    function popcount32(v) {
        v = v - ((v >> 1) & 0x55555555);
        v = (v & 0x33333333) + ((v >> 2) & 0x33333333);
        v = (v + (v >> 4)) & 0x0F0F0F0F;
        return (v * 0x01010101) >> 24;
    }

    global.VoxelCollision = VoxelCollision;
    global.loadVoxelCollision = loadVoxelCollision;
})(window);
