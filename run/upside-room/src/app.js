(function () {
    var canvas = document.getElementById("application");
    var toggleButton = document.getElementById("toggle-mode");
    var modePill = document.getElementById("mode-pill");
    var hint = document.getElementById("hint");
    var objective = document.getElementById("objective");
    var interactPrompt = document.getElementById("interact-prompt");
    var title = document.querySelector(".hud__panel h1");
    var copy = document.querySelector(".hud__copy");
    var eyebrow = document.querySelector(".hud__eyebrow");
    var storageHud = document.getElementById("storage-hud");
    var storagePoem = document.getElementById("storage-poem");
    var storageTimer = document.getElementById("storage-timer");
    var storageStatus = document.getElementById("storage-status");
    var dangerOverlay = document.getElementById("danger-overlay");
    var fadeOverlay = document.getElementById("fade-overlay");
    var transitionMessage = document.getElementById("transition-message");
    var failureOverlay = document.getElementById("failure-overlay");
    var isGameShellPaused = function () {
        try {
            return Boolean(
                window.EndlessDreamGameShell &&
                typeof window.EndlessDreamGameShell.isPaused === "function" &&
                window.EndlessDreamGameShell.isPaused()
            );
        } catch (pauseStateError) {
            console.warn("Unable to read the shared pause state.", pauseStateError);
            return false;
        }
    };
    var showStorageRoomIntro = function () {
        try {
            if (window.EndlessDreamGameShell &&
                typeof window.EndlessDreamGameShell.showRoomIntro === "function") {
                window.EndlessDreamGameShell.showRoomIntro("storage");
            }
        } catch (introError) {
            console.warn("Unable to show the storage-room guide.", introError);
        }
    };
    var isIgnorableBrowserError = function (error) {
        var text = "";
        if (error && error.message) {
            text = String(error.message);
        } else if (typeof error === "string") {
            text = error;
        }

        return text.indexOf("If you see this error we have a bug. Please report this bug to chromium.") !== -1 ||
            text.indexOf("WrongDocumentError") !== -1 ||
            text.toLowerCase().indexOf("pointer lock") !== -1;
    };

    var fatal = function (error) {
        if (isIgnorableBrowserError(error)) {
            console.warn("Ignoring transient browser pointer-lock error.", error);
            return;
        }
        console.error(error);
        hint.textContent = "启动失败： " + (error && error.message ? error.message : error);
        hint.style.background = "rgba(140, 40, 40, 0.9)";
        hint.style.color = "#fff";
    };

    window.addEventListener("error", function (event) {
        fatal(event.error || event.message);
    });

    window.addEventListener("unhandledrejection", function (event) {
        fatal(event.reason);
    });

    eyebrow.textContent = "第二重梦 · 记忆";
    title.textContent = "倒置房间";
    copy.textContent = "白昼会整理表象，阴影才承认哪里多出了一件东西。";
    toggleButton.textContent = "切换明暗";

    var app = new pc.Application(canvas, {
        mouse: new pc.Mouse(canvas),
        keyboard: new pc.Keyboard(window),
        touch: ("ontouchstart" in window) ? new pc.TouchDevice(canvas) : null
    });

    app.start();
    app.setCanvasFillMode(pc.FILLMODE_FILL_WINDOW);
    app.setCanvasResolution(pc.RESOLUTION_AUTO);
    app.mouse.disableContextMenu();

    if (!app.systems.rigidbody || typeof Ammo === "undefined") {
        throw new Error("Ammo physics was not ready when the application started.");
    }
    app.systems.rigidbody.gravity.set(0, -16.5, 0);
    app.systems.rigidbody.fixedTimeStep = 1 / 60;
    app.systems.rigidbody.maxSubSteps = 10;

    fatal = function (error) {
        if (isIgnorableBrowserError(error)) {
            console.warn("Ignoring transient browser pointer-lock error.", error);
            return;
        }
        console.error(error);
        hint.textContent = "启动失败：" + (error && error.message ? error.message : error);
        hint.style.background = "rgba(140, 40, 40, 0.9)";
        hint.style.color = "#fff";
    };
    eyebrow.textContent = "第二重梦 · 记忆";
    title.textContent = "倒置房间";
    copy.textContent = "白昼会整理表象，阴影才承认哪里多出了一件东西。";
    toggleButton.textContent = "切换明暗";

    if (pc.TONEMAP_ACES2 !== undefined) {
        app.scene.toneMapping = pc.TONEMAP_ACES2;
    }

    window.addEventListener("resize", function () {
        app.resizeCanvas(canvas.width, canvas.height);
    });

    var clamp = function (value, min, max) {
        return Math.max(min, Math.min(max, value));
    };

    var lerp = function (a, b, t) {
        return a + ((b - a) * t);
    };

    var lerpColor = function (out, a, b, t) {
        out.set(
            lerp(a.r, b.r, t),
            lerp(a.g, b.g, t),
            lerp(a.b, b.b, t)
        );
    };

    var rgb = function (r, g, b) {
        return new pc.Color(r / 255, g / 255, b / 255);
    };

    var vec3 = function (x, y, z) {
        return new pc.Vec3(x, y, z);
    };

    var reflectPoint = function (point, planePoint, planeNormal) {
        var offset = point.clone().sub(planePoint);
        var distance = offset.dot(planeNormal);
        return point.clone().sub(planeNormal.clone().mulScalar(distance * 2));
    };

    var reflectDirection = function (direction, planeNormal) {
        var distance = direction.dot(planeNormal);
        return direction.clone().sub(planeNormal.clone().mulScalar(distance * 2)).normalize();
    };

    var createGroup = function (name, parent) {
        var entity = new pc.Entity(name);
        (parent || app.root).addChild(entity);
        return entity;
    };

    var createCanvasTexture = function (width, height, painter) {
        var source = document.createElement("canvas");
        source.width = width;
        source.height = height;
        var ctx = source.getContext("2d");
        painter(ctx, width, height);

        var texture = new pc.Texture(app.graphicsDevice, {
            width: width,
            height: height,
            format: pc.PIXELFORMAT_R8_G8_B8_A8,
            mipmaps: true,
            minFilter: pc.FILTER_LINEAR_MIPMAP_LINEAR,
            magFilter: pc.FILTER_LINEAR,
            addressU: pc.ADDRESS_REPEAT,
            addressV: pc.ADDRESS_REPEAT
        });
        texture.setSource(source);
        return texture;
    };

    var createPbrMaterial = function (config) {
        var material = new pc.StandardMaterial();
        material.useMetalness = true;
        material.diffuse = config.diffuse || new pc.Color(1, 1, 1);
        material.emissive = config.emissive || new pc.Color(0, 0, 0);
        material.emissiveIntensity = config.emissiveIntensity || 0;
        material.metalness = config.metalness !== undefined ? config.metalness : 0;
        material.gloss = config.gloss !== undefined ? config.gloss : 0.35;
        material.opacity = config.opacity !== undefined ? config.opacity : 1;
        material.blendType = material.opacity < 0.999 ? pc.BLEND_NORMAL : pc.BLEND_NONE;
        material.cull = config.cull !== undefined ? config.cull : pc.CULLFACE_BACK;

        if (config.diffuseMap) {
            material.diffuseMap = config.diffuseMap;
        }
        if (config.emissiveMap) {
            material.emissiveMap = config.emissiveMap;
        }
        if (config.useLighting === false) {
            material.useLighting = false;
        }
        if (config.tiling) {
            material.diffuseMapTiling = config.tiling.clone();
        }
        if (config.bumpiness !== undefined) {
            material.bumpiness = config.bumpiness;
        }
        if (config.clearCoat !== undefined) {
            material.clearCoat = config.clearCoat;
        }
        if (config.clearCoatGloss !== undefined) {
            material.clearCoatGloss = config.clearCoatGloss;
        }
        if (config.reflectivity !== undefined) {
            material.reflectivity = config.reflectivity;
        }
        if (config.specular) {
            material.specular = config.specular;
        }
        if (config.useMetalnessSpecularColor !== undefined) {
            material.useMetalnessSpecularColor = config.useMetalnessSpecularColor;
        }

        material.update();
        return material;
    };

    var createPrimitive = function (config) {
        var entity = new pc.Entity(config.name || "primitive");
        var renderConfig = {
            type: config.type || "box",
            material: config.material,
            castShadows: config.castShadows !== false,
            receiveShadows: config.receiveShadows !== false
        };

        entity.addComponent("render", renderConfig);

        var position = config.position || [0, 0, 0];
        var scale = config.scale || [1, 1, 1];
        entity.setLocalPosition(position[0], position[1], position[2]);
        entity.setLocalScale(scale[0], scale[1], scale[2]);
        if (config.rotation) {
            entity.setLocalEulerAngles(config.rotation[0], config.rotation[1], config.rotation[2]);
        }
        (config.parent || app.root).addChild(entity);
        return entity;
    };

    var visitEntityTree = function (entity, visitor) {
        var stack = [entity];
        while (stack.length > 0) {
            var current = stack.pop();
            if (!current) {
                continue;
            }
            visitor(current);
            var children = current.children || [];
            for (var i = children.length - 1; i >= 0; i -= 1) {
                stack.push(children[i]);
            }
        }
    };

    var getNodeMeshInstances = function (node) {
        if (node.render && node.render.meshInstances && node.render.meshInstances.length) {
            return node.render.meshInstances;
        }

        if (node.model) {
            if (node.model.meshInstances && node.model.meshInstances.length) {
                return node.model.meshInstances;
            }

            if (node.model.model && node.model.model.meshInstances && node.model.model.meshInstances.length) {
                return node.model.model.meshInstances;
            }
        }

        return [];
    };

    var getEntityWorldBounds = function (entity) {
        var bounds = null;

        visitEntityTree(entity, function (node) {
            var meshInstances = getNodeMeshInstances(node);
            if (!meshInstances.length) {
                return;
            }

            for (var meshIndex = 0; meshIndex < meshInstances.length; meshIndex += 1) {
                var meshInstance = meshInstances[meshIndex];
                if (!meshInstance || !meshInstance.aabb) {
                    continue;
                }

                var aabb = meshInstance.aabb;
                var min = aabb.center.clone().sub(aabb.halfExtents);
                var max = aabb.center.clone().add(aabb.halfExtents);

                if (!bounds) {
                    bounds = {
                        minX: min.x,
                        maxX: max.x,
                        minY: min.y,
                        maxY: max.y,
                        minZ: min.z,
                        maxZ: max.z
                    };
                    continue;
                }

                bounds.minX = Math.min(bounds.minX, min.x);
                bounds.maxX = Math.max(bounds.maxX, max.x);
                bounds.minY = Math.min(bounds.minY, min.y);
                bounds.maxY = Math.max(bounds.maxY, max.y);
                bounds.minZ = Math.min(bounds.minZ, min.z);
                bounds.maxZ = Math.max(bounds.maxZ, max.z);
            }
        });

        return bounds;
    };

    var getUpsideLocalBoundsFromWorld = function (bounds) {
        return {
            minX: bounds.minX,
            maxX: bounds.maxX,
            minY: room.flipHeight - bounds.maxY,
            maxY: room.flipHeight - bounds.minY,
            minZ: -bounds.maxZ,
            maxZ: -bounds.minZ
        };
    };

    var buildPerimeterObstacles = function (bounds, thickness) {
        var wallThickness = thickness || 0.26;
        return [
            {
                minX: bounds.minX - wallThickness,
                maxX: bounds.maxX + wallThickness,
                minZ: bounds.minZ - wallThickness,
                maxZ: bounds.minZ + wallThickness
            },
            {
                minX: bounds.minX - wallThickness,
                maxX: bounds.maxX + wallThickness,
                minZ: bounds.maxZ - wallThickness,
                maxZ: bounds.maxZ + wallThickness
            },
            {
                minX: bounds.minX - wallThickness,
                maxX: bounds.minX + wallThickness,
                minZ: bounds.minZ,
                maxZ: bounds.maxZ
            },
            {
                minX: bounds.maxX - wallThickness,
                maxX: bounds.maxX + wallThickness,
                minZ: bounds.minZ,
                maxZ: bounds.maxZ
            }
        ];
    };

    var overlapColliderBoxes = function (a, b, margin) {
        var gap = margin || 0;
        return a.minX <= b.maxX + gap &&
            a.maxX >= b.minX - gap &&
            a.minZ <= b.maxZ + gap &&
            a.maxZ >= b.minZ - gap;
    };

    var mergeColliderBoxes = function (boxes, margin) {
        var merged = [];

        for (var boxIndex = 0; boxIndex < boxes.length; boxIndex += 1) {
            var candidate = {
                minX: boxes[boxIndex].minX,
                maxX: boxes[boxIndex].maxX,
                minZ: boxes[boxIndex].minZ,
                maxZ: boxes[boxIndex].maxZ
            };

            var didMerge = false;
            for (var mergedIndex = 0; mergedIndex < merged.length; mergedIndex += 1) {
                var target = merged[mergedIndex];
                if (!overlapColliderBoxes(candidate, target, margin)) {
                    continue;
                }

                target.minX = Math.min(target.minX, candidate.minX);
                target.maxX = Math.max(target.maxX, candidate.maxX);
                target.minZ = Math.min(target.minZ, candidate.minZ);
                target.maxZ = Math.max(target.maxZ, candidate.maxZ);
                didMerge = true;
                break;
            }

            if (!didMerge) {
                merged.push(candidate);
            }
        }

        return merged;
    };

    var buildMeshCollisionLayer = function (sceneEntity, options) {
        var settings = options || {};
        var floorY = settings.floorY !== undefined ? settings.floorY : room.floorY;
        var bodyMinY = floorY + (settings.bodyMinOffset !== undefined ? settings.bodyMinOffset : 0.12);
        var bodyMaxY = floorY + (settings.bodyHeight || 1.72);
        var padding = settings.padding !== undefined ? settings.padding : 0.06;
        var bounds = settings.bounds || null;
        var roomWidth = bounds ? Math.max(0.1, bounds.maxX - bounds.minX) : 0;
        var roomDepth = bounds ? Math.max(0.1, bounds.maxZ - bounds.minZ) : 0;
        var minFootprint = settings.minFootprint || 0.18;
        var minObjectHeight = settings.minObjectHeight || 0.24;
        var minLowObjectHeight = settings.minLowObjectHeight || 0.1;
        var minLowObjectFootprint = settings.minLowObjectFootprint || 0.55;
        var excludePoints = settings.excludePoints || [];
        var excludeClearance = settings.excludeClearance !== undefined ? settings.excludeClearance : player.radius + 0.08;
        var colliders = [];
        var stats = {
            nodes: 0,
            meshNodes: 0,
            meshInstances: 0,
            withAabb: 0,
            bodyOverlap: 0,
            accepted: 0,
            skippedSlab: 0,
            skippedShape: 0,
            skippedPoint: 0
        };

        visitEntityTree(sceneEntity, function (node) {
            stats.nodes += 1;
            var meshInstances = getNodeMeshInstances(node);
            if (!node.enabled || !meshInstances.length) {
                return;
            }

            stats.meshNodes += 1;
            stats.meshInstances += meshInstances.length;
            for (var meshIndex = 0; meshIndex < meshInstances.length; meshIndex += 1) {
                var meshInstance = meshInstances[meshIndex];
                if (!meshInstance || !meshInstance.aabb) {
                    continue;
                }

                stats.withAabb += 1;
                var aabb = meshInstance.aabb;
                var center = aabb.center;
                var half = aabb.halfExtents;
                var sizeX = half.x * 2;
                var sizeY = half.y * 2;
                var sizeZ = half.z * 2;
                var minY = center.y - half.y;
                var maxY = center.y + half.y;
                var overlapsPlayerBody = settings.ignoreVertical || (maxY >= bodyMinY && minY <= bodyMaxY);

                if (!overlapsPlayerBody) {
                    continue;
                }

                stats.bodyOverlap += 1;
                var wallLikeX = sizeX <= (settings.wallThickness || 0.42) && sizeZ >= (settings.wallLength || 0.72) && sizeY >= 1.0;
                var wallLikeZ = sizeZ <= (settings.wallThickness || 0.42) && sizeX >= (settings.wallLength || 0.72) && sizeY >= 1.0;
                var horizontalRoomSlab = bounds && sizeY <= 0.18 && sizeX > roomWidth * 0.62 && sizeZ > roomDepth * 0.62;
                var spansMostRoom = bounds && sizeX > roomWidth * 0.72 && sizeZ > roomDepth * 0.72;
                var objectLike = sizeY >= minObjectHeight && sizeX >= minFootprint && sizeZ >= minFootprint;
                var lowBroadObject = sizeY >= minLowObjectHeight &&
                    sizeX >= minLowObjectFootprint &&
                    sizeZ >= minLowObjectFootprint &&
                    maxY >= bodyMinY + 0.02;

                if (horizontalRoomSlab || (spansMostRoom && !wallLikeX && !wallLikeZ)) {
                    stats.skippedSlab += 1;
                    continue;
                }

                if (!wallLikeX && !wallLikeZ && !objectLike && !lowBroadObject) {
                    stats.skippedShape += 1;
                    continue;
                }

                var collider = {
                    minX: center.x - half.x - padding,
                    maxX: center.x + half.x + padding,
                    minZ: center.z - half.z - padding,
                    maxZ: center.z + half.z + padding
                };

                if (bounds && settings.clampToBounds !== false) {
                    collider.minX = clamp(collider.minX, bounds.minX - padding, bounds.maxX + padding);
                    collider.maxX = clamp(collider.maxX, bounds.minX - padding, bounds.maxX + padding);
                    collider.minZ = clamp(collider.minZ, bounds.minZ - padding, bounds.maxZ + padding);
                    collider.maxZ = clamp(collider.maxZ, bounds.minZ - padding, bounds.maxZ + padding);
                }

                if (collider.maxX - collider.minX < 0.08 || collider.maxZ - collider.minZ < 0.08) {
                    continue;
                }

                var overlapsExcludedPoint = false;
                for (var pointIndex = 0; pointIndex < excludePoints.length; pointIndex += 1) {
                    var point = excludePoints[pointIndex];
                    var px = point.x !== undefined ? point.x : point[0];
                    var pz = point.z !== undefined ? point.z : point[2];
                    if (px >= collider.minX - excludeClearance &&
                            px <= collider.maxX + excludeClearance &&
                            pz >= collider.minZ - excludeClearance &&
                            pz <= collider.maxZ + excludeClearance) {
                        overlapsExcludedPoint = true;
                        break;
                    }
                }

                if (overlapsExcludedPoint) {
                    stats.skippedPoint += 1;
                    continue;
                }

                stats.accepted += 1;
                colliders.push(collider);
            }
        });

        var mergedColliders = mergeColliderBoxes(colliders, settings.mergeMargin !== undefined ? settings.mergeMargin : 0.025);
        if (settings.debugPrefix && document.body) {
            document.body.setAttribute("data-" + settings.debugPrefix + "-collision-stats", JSON.stringify(stats));
            document.body.setAttribute("data-" + settings.debugPrefix + "-raw-colliders", String(colliders.length));
            document.body.setAttribute("data-" + settings.debugPrefix + "-merged-colliders", String(mergedColliders.length));
        }

        return mergedColliders;
    };

    var createUpsideRoomLayout = function (shellBounds) {
        var centerX = (shellBounds.minX + shellBounds.maxX) * 0.5;
        var centerZ = (shellBounds.minZ + shellBounds.maxZ) * 0.5;
        var insetX = Math.min(0.82, Math.max(0.48, (shellBounds.maxX - shellBounds.minX) * 0.14));
        var insetZ = Math.min(1.18, Math.max(0.7, (shellBounds.maxZ - shellBounds.minZ) * 0.16));
        var ceilingY = shellBounds.maxY - 0.28;

        return {
            spawn: {
                position: vec3(centerX - 0.12, room.floorY + 1.62, centerZ + 0.18),
                yaw: 0,
                pitch: -6
            },
            mirror: {
                position: vec3(shellBounds.maxX - 0.26, 1.62, centerZ - 0.42),
                rotation: [0, -90, 0]
            },
            photo: {
                position: vec3(shellBounds.minX + 0.28, 1.78, centerZ + 0.46),
                rotation: [0, 90, 0]
            },
            anomalies: {
                doll: vec3(shellBounds.minX + insetX, ceilingY, centerZ - 0.86),
                vase: vec3(centerX + 0.66, ceilingY - 0.06, shellBounds.minZ + insetZ + 0.16),
                chair: vec3(centerX - 0.24, ceilingY - 0.02, shellBounds.maxZ - (insetZ + 0.52))
            },
            lamp: vec3(centerX + 0.44, 2.14, centerZ - 0.18)
        };
    };

    var worldLayerId = pc.LAYERID_WORLD;
    var depthLayerId = pc.LAYERID_DEPTH;
    var skyboxLayerId = pc.LAYERID_SKYBOX;
    var immediateLayerId = pc.LAYERID_IMMEDIATE;
    var uiLayerId = pc.LAYERID_UI;

    var room = {
        loaded: false,
        root: null,
        container: null,
        layout: null,
        sceneMaterials: [],
        nodes: {},
        obstacles: [],
        bounds: { minX: -2.9, maxX: 2.9, minZ: -3.2, maxZ: 3.2 },
        floorY: 0.04,
        ceilingY: 3.16,
        flipHeight: 3.2,
        mirror: null,
        mirrorCamera: null,
        mirrorTarget: null,
        mirrorSurfaceMaterial: null,
        mirrorGlassMaterial: null,
        mirrorBackingMaterial: null,
        mirrorAura: null,
        windowGlow: null,
        photoPieces: [],
        darkEntities: []
    };

    var invertRoomPoint = function (point) {
        return vec3(point.x, room.flipHeight - point.y, -point.z);
    };

    var invertRoomBox = function (box) {
        return {
            minX: box.minX,
            maxX: box.maxX,
            minZ: -box.maxZ,
            maxZ: -box.minZ
        };
    };

    var trackRoomMaterial = function (material) {
        if (!material || material._roomTracked) {
            return material;
        }

        material._roomTracked = true;
        material._roomBaseDiffuse = material.diffuse.clone();
        room.sceneMaterials.push(material);
        return material;
    };

    var mode = {
        current: 0,
        target: 0,
        names: ["阳光模式", "阴暗模式"]
    };

    var player = {
        radius: 0.27,
        speed: 2.9,
        sprint: 1.5,
        yaw: 22,
        pitch: -6
    };

    var game = {
        anomalies: [],
        foundCount: 0,
        currentTarget: null,
        activeMessage: "",
        activeMessageTimer: 0
    };

    var stage = {
        current: "upside",
        transitionQueued: false,
        transitionDelay: 0,
        transitionPhase: "idle",
        transitionElapsed: 0,
        flipDuration: 5,
        whiteHoldDuration: 5,
        transitionCameraVector: null,
        fade: 0,
        fadeDirection: 0,
        switchedRoom: false,
        upsideRoomSnapshot: null
    };

    var storage = {
        root: null,
        asset: null,
        assetUrl: null,
        loading: false,
        loaded: false,
        loadError: null,
        callbacks: [],
        active: false,
        materials: [],
        nodes: [],
        clues: [],
        pollutionZones: [],
        finalKey: null,
        purifiedCount: 0,
        activeClueIndex: 0,
        keyCollected: false,
        failed: false,
        timer: 180,
        timerLimit: 180,
        targetBrightness: 0,
        brightness: 0,
        danger: 0,
        flashlightSway: 0,
        wallColliders: [],
        bounds: { minX: -2.7, maxX: 4.8, minZ: -4.9, maxZ: 7.9 },
        floorY: 0.02,
        spawn: vec3(0.56, 0.02, 0.72),
        obstacles: [
            { minX: -0.15, maxX: 1.45, minZ: -0.28, maxZ: 0.86 },
            { minX: 2.8, maxX: 4.58, minZ: 4.62, maxZ: 6.72 },
            { minX: -2.36, maxX: -1.1, minZ: 3.0, maxZ: 4.54 },
            { minX: 1.4, maxX: 2.72, minZ: -3.62, maxZ: -2.2 }
        ]
    };

    var storagePhysics = {
        collisionUrl: "./assets/replicacad/Baked_sc1_staging_01.collision.glb",
        navigationUrl: "./assets/replicacad/Baked_sc1_staging_01.navigation-mask.json",
        collisionSha256: "9661433402bddb4f84e49bafca39fa0671f4e81842afae7a2116da5ca3ce11e2",
        navigationSha256: "8116dc26ee02185d5053e4f22febee0500fc9a86b210013a64a16277f629522e",
        triangleCount: 41395,
        bounds: {
            min: vec3(-2.643332, -0.071016, -4.759779),
            max: vec3(4.614596, 3.048872, 8.173184)
        },
        player: {
            radius: 0.28,
            height: 1.7,
            skin: 0.03,
            stepHeight: 0.225,
            maxSlope: 48,
            eyeOffset: 0.81
        },
        navigation: null,
        collisionAsset: null,
        collisionRoot: null,
        colliderEntity: null,
        character: null,
        collisionSpawn: null,
        moveVelocity: vec3(0, 0, 0),
        characterPosition: vec3(0, 0, 0),
        characterVelocity: vec3(0, 0, 0),
        correctionPosition: vec3(0, 0, 0),
        lastSafePosition: vec3(0, 0, 0),
        lastSafeLayer: null,
        lastSafeCell: -1,
        lastSafeContactOffset: 0,
        lastSafeSampleId: -1,
        syncSampleId: 0,
        navigationHeight: 0,
        grounded: false,
        airborneTime: 0,
        recoveryCount: 0,
        recoveryReasons: {},
        navigationCorrectionCount: 0,
        navigationCorrectionReasons: {},
        diagnosticTeleportPending: false,
        testVelocity: vec3(0, 0, 0),
        testVelocityActive: false
    };

    var upsidePhysics = {
        collisionUrl: "./assets/replicacad/Baked_sc0_staging_00.collision.glb",
        navigationUrl: "./assets/replicacad/Baked_sc0_staging_00.navigation-mask.json",
        collisionSha256: "6678b4d6436776c44407173fe43438c57f648cf4b7ba441ae465ea6f85c13148",
        navigationSha256: "e2e99080bebd1569bdf0496c433cb98716746e88ec71350f54d12d1802a91e98",
        triangleCount: 40619,
        expectedNavigationCells: 26112,
        expectedNavigationCellSize: 0.04,
        navigationSupportTriangles: 12,
        requireCapsuleClearanceContract: true,
        bounds: {
            min: vec3(-3.628965, 0, -6.464027),
            max: vec3(3.628965, 3.107243, 6.464027)
        },
        player: {
            radius: 0.28,
            height: 1.7,
            skin: 0.03,
            stepHeight: 0.225,
            maxSlope: 48,
            restingCenterHeight: 0.81,
            // Bullet rests this capsule origin at y=0.81; keep the original 1.66 m camera height.
            eyeOffset: 0.85
        },
        loading: false,
        loaded: false,
        loadError: null,
        callbacks: [],
        navigation: null,
        collisionAsset: null,
        collisionRoot: null,
        colliderEntity: null,
        character: null,
        collisionSpawn: null,
        moveVelocity: vec3(0, 0, 0),
        characterPosition: vec3(0, 0, 0),
        characterVelocity: vec3(0, 0, 0),
        correctionPosition: vec3(0, 0, 0),
        lastSafePosition: vec3(0, 0, 0),
        lastSafeLayer: null,
        lastSafeCell: -1,
        lastSafeContactOffset: 0,
        lastSafeSampleId: -1,
        syncSampleId: 0,
        navigationHeight: 0,
        grounded: false,
        airborneTime: 0,
        recoveryCount: 0,
        recoveryReasons: {},
        navigationCorrectionCount: 0,
        navigationCorrectionReasons: {},
        diagnosticTeleportPending: false,
        testVelocity: vec3(0, 0, 0),
        testVelocityActive: false
    };
    var pauseState = {
        active: false,
        waitForRelease: false
    };

    var isGameplayKeyHeld = function () {
        return app.keyboard.isPressed(pc.KEY_W) ||
            app.keyboard.isPressed(pc.KEY_A) ||
            app.keyboard.isPressed(pc.KEY_S) ||
            app.keyboard.isPressed(pc.KEY_D) ||
            app.keyboard.isPressed(pc.KEY_SHIFT) ||
            app.keyboard.isPressed(pc.KEY_E) ||
            app.keyboard.isPressed(pc.KEY_Q) ||
            app.keyboard.isPressed(pc.KEY_R);
    };

    var stopKinematicMotion = function (physicsState) {
        if (!physicsState || !physicsState.character) {
            return;
        }

        var character = physicsState.character;
        character.walk.setValue(0, 0, 0);
        character.controller.setWalkDirection(character.walk);
        physicsState.moveVelocity.set(0, 0, 0);
    };

    var updatePauseGate = function () {
        var paused = isGameShellPaused();
        if (paused || (pauseState.active && !paused)) {
            pauseState.waitForRelease = true;
        }
        pauseState.active = paused;

        if (!paused && pauseState.waitForRelease && !isGameplayKeyHeld()) {
            pauseState.waitForRelease = false;
        }

        var inputBlocked = paused || pauseState.waitForRelease;
        if (inputBlocked) {
            stopKinematicMotion(upsidePhysics);
            stopKinematicMotion(storagePhysics);
        }
        return inputBlocked;
    };
    var ensureUpsideCollisionLoaded = null;

    storage.baseObstacles = storage.obstacles.slice();

    var upsideStudyAssets = {
        shell: {
            name: "scene1-replicacad-study-shell",
            url: "./assets/replicacad/Baked_sc0_staging_00.uncompressed.glb",
            filename: "Baked_sc0_staging_00.uncompressed.glb"
        }
    };
    var upsideStudyAssetCache = {};
    var upsideReplicaAssetUrl = null;
    var decodeEmbeddedStudyBuffer = function (parts) {
        var base64 = "";

        if (typeof parts === "string") {
            base64 = parts;
        } else if (Array.isArray(parts)) {
            base64 = parts.join("");
        } else if (parts && typeof parts.length === "number") {
            base64 = Array.prototype.join.call(parts, "");
        } else {
            throw new Error("Embedded scene 1 study asset is not in a decodable base64 format.");
        }

        var binary = atob(base64);
        var bytes = new Uint8Array(binary.length);
        for (var index = 0; index < binary.length; index += 1) {
            bytes[index] = binary.charCodeAt(index);
        }
        return bytes.buffer;
    };

    var getUpsideStudyAssetUrl = function (key) {
        var config = upsideStudyAssets[key];
        if (!config) {
            return null;
        }

        if (key === "shell") {
            return getUpsideReplicaAssetUrl();
        }

        if (config.blobUrl) {
            return config.blobUrl;
        }

        if (config.embeddedKey && window.__scene1StudyEmbedded && window.__scene1StudyEmbedded[config.embeddedKey]) {
            var buffer = decodeEmbeddedStudyBuffer(window.__scene1StudyEmbedded[config.embeddedKey]);
            config.blobUrl = URL.createObjectURL(new Blob([buffer], { type: "model/gltf-binary" }));
            return config.blobUrl;
        }

        return config.url;
    };

    var getUpsideReplicaAssetUrl = function () {
        if (upsideReplicaAssetUrl) {
            return upsideReplicaAssetUrl;
        }

        upsideReplicaAssetUrl = "./assets/replicacad/Baked_sc0_staging_00.uncompressed.glb";
        return upsideReplicaAssetUrl;
    };

    var cameraRig = new pc.Entity("camera-rig");
    cameraRig.setLocalPosition(0, room.floorY + 1.62, 1.72);
    app.root.addChild(cameraRig);

    var camera = new pc.Entity("camera");
    camera.addComponent("camera", {
        clearColor: new pc.Color(0.76, 0.77, 0.8),
        fov: 64,
        nearClip: 0.05,
        farClip: 80
    });
    cameraRig.addChild(camera);
    camera.setLocalEulerAngles(player.pitch, player.yaw, 0);

    // Keep input responsive while filtering pointer-lock spikes and visual micro-jitter.
    var cameraLook = {
        yaw: player.yaw,
        pitch: player.pitch
    };

    var snapCameraLook = function () {
        cameraLook.yaw = player.yaw;
        cameraLook.pitch = player.pitch;
        camera.setLocalEulerAngles(cameraLook.pitch, cameraLook.yaw, 0);
    };

    var shortestAngleDelta = function (from, to) {
        return ((to - from + 540) % 360) - 180;
    };

    var updateCameraLook = function (dt) {
        var smoothing = 1 - Math.exp(-dt * 24);
        cameraLook.yaw += shortestAngleDelta(cameraLook.yaw, player.yaw) * smoothing;
        cameraLook.pitch += (player.pitch - cameraLook.pitch) * smoothing;
        camera.setLocalEulerAngles(cameraLook.pitch, cameraLook.yaw, 0);
    };

    app.mouse.on(pc.EVENT_MOUSEDOWN, function () {
        if (isGameShellPaused()) {
            return;
        }
        try {
            app.mouse.enablePointerLock();
        } catch (pointerLockError) {
            console.warn("Pointer lock request failed, continuing without locked camera.", pointerLockError);
        }
    });

    app.mouse.on(pc.EVENT_MOUSEMOVE, function (event) {
        if (!pc.Mouse.isPointerLocked() || isGameShellPaused() || stage.current === "transition") {
            return;
        }

        var lookSensitivity = (storage.active && stage.current === "storage") ? 0.055 : 0.11;
        var deltaX = clamp(Number(event.dx) || 0, -48, 48);
        var deltaY = clamp(Number(event.dy) || 0, -48, 48);
        player.yaw -= deltaX * lookSensitivity;
        player.pitch = clamp(player.pitch - (deltaY * lookSensitivity), -72, 72);
    });

    var dayAmbient = rgb(232, 226, 216);
    var nightAmbient = rgb(92, 98, 110);

    app.scene.ambientLight = dayAmbient.clone();
    app.scene.exposure = 1.14;
    app.scene.fog = pc.FOG_NONE;

    var sunLight = new pc.Entity("sun-light");
    sunLight.addComponent("light", {
        type: "directional",
        castShadows: true,
        intensity: 1.35,
        color: rgb(255, 245, 228),
        shadowDistance: 20,
        shadowResolution: 2048
    });
    sunLight.setLocalEulerAngles(40, -28, 0);
    app.root.addChild(sunLight);

    var coolFillLight = new pc.Entity("cool-fill-light");
    coolFillLight.addComponent("light", {
        type: "omni",
        castShadows: false,
        intensity: 0.05,
        range: 9,
        color: rgb(160, 178, 198)
    });
    coolFillLight.setLocalPosition(-2.2, 2.1, -2.2);
    app.root.addChild(coolFillLight);

    var lampLight = new pc.Entity("lamp-light");
    lampLight.addComponent("light", {
        type: "omni",
        castShadows: false,
        intensity: 0.2,
        range: 5,
        color: rgb(255, 223, 177)
    });
    lampLight.setLocalPosition(-2.45, 1.56, 0.98);
    app.root.addChild(lampLight);

    var flashlight = new pc.Entity("flashlight");
    flashlight.addComponent("light", {
        type: "spot",
        castShadows: false,
        intensity: 0,
        range: 11,
        innerConeAngle: 10,
        outerConeAngle: 28,
        color: rgb(255, 245, 226)
    });
    camera.addChild(flashlight);
    flashlight.setLocalPosition(0.06, -0.04, -0.02);
    flashlight.setLocalEulerAngles(84, 0, 0);

    var flashlightView = createGroup("flashlight-view", camera);
    flashlightView.setLocalPosition(0.28, -0.22, -0.42);
    flashlightView.setLocalEulerAngles(16, -10, 6);
    flashlightView.enabled = false;

    var flashlightShellMaterial = createPbrMaterial({
        diffuse: rgb(52, 56, 64),
        gloss: 0.48,
        metalness: 0.88,
        reflectivity: 1
    });

    var flashlightGripMaterial = createPbrMaterial({
        diffuse: rgb(28, 30, 35),
        gloss: 0.16,
        metalness: 0.18
    });

    var flashlightTrimMaterial = createPbrMaterial({
        diffuse: rgb(112, 118, 128),
        gloss: 0.72,
        metalness: 1,
        reflectivity: 1
    });

    var flashlightLensMaterial = createPbrMaterial({
        diffuse: rgb(220, 230, 244),
        emissive: rgb(255, 238, 205),
        emissiveIntensity: 0.12,
        gloss: 0.88,
        metalness: 0.08,
        opacity: 0.92,
        cull: pc.CULLFACE_NONE
    });

    createPrimitive({
        name: "flashlight-handle",
        type: "cylinder",
        material: flashlightGripMaterial,
        position: [0.02, -0.12, -0.02],
        scale: [0.055, 0.16, 0.055],
        rotation: [8, 0, -8],
        parent: flashlightView
    });

    createPrimitive({
        name: "flashlight-body",
        type: "cylinder",
        material: flashlightShellMaterial,
        position: [0.04, -0.01, -0.13],
        scale: [0.07, 0.24, 0.07],
        rotation: [90, 0, 0],
        parent: flashlightView
    });

    createPrimitive({
        name: "flashlight-head",
        type: "cylinder",
        material: flashlightTrimMaterial,
        position: [0.05, 0, -0.29],
        scale: [0.105, 0.085, 0.105],
        rotation: [90, 0, 0],
        parent: flashlightView
    });

    createPrimitive({
        name: "flashlight-tail",
        type: "cylinder",
        material: flashlightTrimMaterial,
        position: [0.04, -0.01, 0.03],
        scale: [0.052, 0.03, 0.052],
        rotation: [90, 0, 0],
        parent: flashlightView
    });

    createPrimitive({
        name: "flashlight-lens",
        type: "sphere",
        material: flashlightLensMaterial,
        position: [0.05, 0, -0.365],
        scale: [0.07, 0.07, 0.026],
        parent: flashlightView,
        castShadows: false,
        receiveShadows: false
    });

    var updateFlashlightView = function (dt, time, movementAmount) {
        var inStorageRoom = storage.active || (stage.current === "transition" && stage.switchedRoom);
        var roomIsBright = storage.targetBrightness >= 0.99 && storage.brightness >= 0.96;
        var visible = inStorageRoom && !roomIsBright;
        flashlightView.enabled = visible;

        if (!visible) {
            return;
        }

        var moving = movementAmount > 0.001 ? 1 : 0;
        storage.flashlightSway += dt * (moving ? 7.2 : 2.6);

        var swayX = Math.sin(storage.flashlightSway) * 0.016 * moving;
        var swayY = Math.cos(storage.flashlightSway * 2) * 0.01 * moving;
        var drift = Math.sin(time * 0.9) * 0.004;

        flashlightView.setLocalPosition(0.28 + swayX, -0.22 + swayY + drift, -0.42);
        flashlightView.setLocalEulerAngles(
            16 + (Math.cos(storage.flashlightSway) * 1.4 * moving),
            -10 + (Math.sin(storage.flashlightSway * 0.7) * 2.2 * moving),
            6 + (Math.sin(storage.flashlightSway * 0.6) * 1.8 * moving)
        );
    };

    var updateObjective = function () {
        objective.textContent = "异常物件 " + game.foundCount + " / 3";
    };

    var getBaseHint = function () {
        if (!room.loaded) {
            return "房间正在稳定下来……";
        }

        if (game.foundCount >= 3) {
            return "墙上的照片已经完整，倒置房间暂时安静了下来。";
        }

        if (mode.target === 0) {
            return "先记住白天房间的样子。切到阴暗模式后，3 个不该存在的东西才会出现。";
        }

        if (game.foundCount === 0) {
            return "阴暗模式已经打开。看镜子、梳妆柜和天花板附近。";
        }

        if (game.foundCount === 1) {
            return "照片恢复了一角。还有两件异常只会在阴暗模式里显形。";
        }

        return "最后一件异常还藏在房间里，别只盯着地面。";
    };

    var refreshHint = function () {
        hint.textContent = game.activeMessageTimer > 0 ? game.activeMessage : getBaseHint();
    };

    var setPrompt = function (text, visible) {
        interactPrompt.textContent = text;
        interactPrompt.classList.toggle("interact-prompt--hidden", !visible);
    };

    var refreshUi = function () {
        modePill.textContent = mode.names[mode.target];
        document.body.classList.toggle("shadow-mode", mode.target === 1);
        updateObjective();
        refreshHint();
    };

    var showMessage = function (text, duration) {
        game.activeMessage = text;
        game.activeMessageTimer = duration || 2.8;
        refreshHint();
    };

    var createWallTexture = function () {
        return createCanvasTexture(512, 512, function (ctx, width, height) {
            ctx.fillStyle = "#d9d1c4";
            ctx.fillRect(0, 0, width, height);

            ctx.globalAlpha = 0.16;
            for (var i = 0; i < 18; i += 1) {
                var band = 0.35 + (Math.random() * 0.45);
                ctx.fillStyle = i % 2 === 0 ? "#e4ddd1" : "#cbc1b3";
                ctx.fillRect((i * width) / 18, 0, (width / 18) * band, height);
            }
            ctx.globalAlpha = 1;

            for (var j = 0; j < 900; j += 1) {
                var shade = 206 + Math.floor(Math.random() * 20);
                ctx.fillStyle = "rgba(" + shade + "," + (shade - 9) + "," + (shade - 18) + ",0.14)";
                ctx.fillRect(Math.random() * width, Math.random() * height, 2, 2);
            }

            ctx.strokeStyle = "rgba(120,108,95,0.05)";
            ctx.lineWidth = 2;
            for (var y = 76; y < height; y += 86) {
                ctx.beginPath();
                ctx.moveTo(0, y);
                ctx.lineTo(width, y + 2);
                ctx.stroke();
            }

            ctx.strokeStyle = "rgba(255,255,255,0.08)";
            ctx.lineWidth = 1;
            for (var x = 44; x < width; x += 92) {
                ctx.beginPath();
                ctx.moveTo(x, 0);
                ctx.lineTo(x + 5, height);
                ctx.stroke();
            }
        });
    };

    var createWoodTexture = function (dark) {
        return createCanvasTexture(512, 512, function (ctx, width, height) {
            var base = dark ? ["#74543c", "#684933", "#89664a"] : ["#b98d60", "#c39a70", "#a97b55"];
            ctx.fillStyle = base[1];
            ctx.fillRect(0, 0, width, height);

            var plankWidth = 56;
            for (var x = 0; x < width; x += plankWidth) {
                ctx.fillStyle = base[(x / plankWidth) % base.length];
                ctx.fillRect(x, 0, plankWidth - 2, height);

                ctx.strokeStyle = "rgba(56,34,20,0.18)";
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.moveTo(x + plankWidth - 1, 0);
                ctx.lineTo(x + plankWidth - 1, height);
                ctx.stroke();

                for (var i = 0; i < 20; i += 1) {
                    var y = Math.random() * height;
                    ctx.strokeStyle = i % 3 === 0 ? "rgba(255,244,232,0.08)" : "rgba(89,58,36,0.14)";
                    ctx.beginPath();
                    ctx.moveTo(x + 5, y);
                    ctx.bezierCurveTo(x + 14, y + 5, x + plankWidth - 18, y - 4, x + plankWidth - 7, y + 2);
                    ctx.stroke();
                }
            }

            ctx.fillStyle = "rgba(255,255,255,0.06)";
            ctx.fillRect(0, 0, width, 8);
            ctx.fillRect(0, height - 8, width, 8);
        });
    };

    var createFabricTexture = function (baseColor, lineColor) {
        return createCanvasTexture(256, 256, function (ctx, width, height) {
            ctx.fillStyle = baseColor;
            ctx.fillRect(0, 0, width, height);

            ctx.fillStyle = "rgba(255,255,255,0.08)";
            ctx.fillRect(0, 0, width, height * 0.12);
            ctx.fillStyle = "rgba(0,0,0,0.05)";
            ctx.fillRect(0, height * 0.72, width, height * 0.28);

            ctx.strokeStyle = lineColor;
            ctx.globalAlpha = 0.16;
            for (var x = 0; x < width; x += 8) {
                ctx.beginPath();
                ctx.moveTo(x, 0);
                ctx.lineTo(x, height);
                ctx.stroke();
            }
            for (var y = 0; y < height; y += 8) {
                ctx.beginPath();
                ctx.moveTo(0, y);
                ctx.lineTo(width, y);
                ctx.stroke();
            }
            ctx.globalAlpha = 1;

            ctx.fillStyle = "rgba(255,255,255,0.03)";
            for (var i = 0; i < 180; i += 1) {
                ctx.fillRect(Math.random() * width, Math.random() * height, 1, 1);
            }
        });
    };

    var createRugTexture = function () {
        return createCanvasTexture(512, 512, function (ctx, width, height) {
            ctx.fillStyle = "#8a7966";
            ctx.fillRect(0, 0, width, height);

            ctx.fillStyle = "#a99781";
            for (var y = 20; y < height; y += 72) {
                for (var x = 20; x < width; x += 72) {
                    ctx.save();
                    ctx.translate(x + 18, y + 18);
                    ctx.rotate(Math.PI * 0.25);
                    ctx.fillRect(-12, -12, 24, 24);
                    ctx.restore();
                }
            }

            ctx.strokeStyle = "rgba(230,220,207,0.34)";
            ctx.lineWidth = 14;
            ctx.strokeRect(18, 18, width - 36, height - 36);
            ctx.lineWidth = 4;
            ctx.strokeRect(36, 36, width - 72, height - 72);
        });
    };

    var createSkyTexture = function () {
        return createCanvasTexture(512, 512, function (ctx, width, height) {
            var gradient = ctx.createLinearGradient(0, 0, 0, height);
            gradient.addColorStop(0, "#d7ebff");
            gradient.addColorStop(1, "#b9d0ef");
            ctx.fillStyle = gradient;
            ctx.fillRect(0, 0, width, height);

            ctx.fillStyle = "rgba(255,255,255,0.66)";
            for (var i = 0; i < 6; i += 1) {
                var x = 40 + (i * 76);
                var y = 54 + ((i % 2) * 18);
                ctx.beginPath();
                ctx.arc(x, y, 24, 0, Math.PI * 2);
                ctx.arc(x + 20, y + 8, 30, 0, Math.PI * 2);
                ctx.arc(x - 20, y + 10, 20, 0, Math.PI * 2);
                ctx.fill();
            }
        });
    };

    var createSunflowerTexture = function (sliceIndex, sliceCount) {
        return createCanvasTexture(512, 512, function (ctx, width, height) {
            var fullWidth = width * sliceCount;
            var fullHeight = height;
            var art = document.createElement("canvas");
            art.width = fullWidth;
            art.height = fullHeight;

            var artCtx = art.getContext("2d");
            var bg = artCtx.createLinearGradient(0, 0, fullWidth, fullHeight);
            bg.addColorStop(0, "#f5ead6");
            bg.addColorStop(0.46, "#efe0c2");
            bg.addColorStop(1, "#d8c29f");
            artCtx.fillStyle = bg;
            artCtx.fillRect(0, 0, fullWidth, fullHeight);

            artCtx.fillStyle = "rgba(255,255,255,0.24)";
            for (var i = 0; i < 7; i += 1) {
                var beamX = (fullWidth * 0.16) + (i * fullWidth * 0.11);
                artCtx.fillRect(beamX, 0, fullWidth * 0.025, fullHeight);
            }

            var centerX = fullWidth * 0.53;
            var centerY = fullHeight * 0.46;
            var petalCount = 18;
            for (var p = 0; p < petalCount; p += 1) {
                var angle = (Math.PI * 2 * p) / petalCount;
                artCtx.save();
                artCtx.translate(centerX, centerY);
                artCtx.rotate(angle);
                artCtx.beginPath();
                artCtx.moveTo(0, -82);
                artCtx.bezierCurveTo(40, -106, 58, -24, 0, 0);
                artCtx.bezierCurveTo(-58, -24, -40, -106, 0, -82);
                artCtx.closePath();
                artCtx.fillStyle = p % 2 === 0 ? "#f4c451" : "#efb845";
                artCtx.fill();
                artCtx.restore();
            }

            artCtx.beginPath();
            artCtx.arc(centerX, centerY, 94, 0, Math.PI * 2);
            artCtx.fillStyle = "#6d3f16";
            artCtx.fill();

            artCtx.beginPath();
            artCtx.arc(centerX - 12, centerY - 12, 64, 0, Math.PI * 2);
            artCtx.fillStyle = "#3e240f";
            artCtx.fill();

            for (var s = 0; s < 120; s += 1) {
                var sx = centerX - 54 + ((s * 13) % 108);
                var sy = centerY - 54 + ((s * 17) % 108);
                artCtx.fillStyle = s % 3 === 0 ? "rgba(252,228,141,0.7)" : "rgba(63,35,14,0.65)";
                artCtx.fillRect(sx, sy, 3, 3);
            }

            artCtx.strokeStyle = "#6b7f4f";
            artCtx.lineWidth = 14;
            artCtx.lineCap = "round";
            artCtx.beginPath();
            artCtx.moveTo(centerX - 20, fullHeight);
            artCtx.quadraticCurveTo(centerX - 10, fullHeight * 0.77, centerX + 6, fullHeight * 0.59);
            artCtx.stroke();

            artCtx.strokeStyle = "#879d63";
            artCtx.lineWidth = 12;
            artCtx.beginPath();
            artCtx.moveTo(centerX - 2, fullHeight * 0.88);
            artCtx.lineTo(centerX - 92, fullHeight * 0.68);
            artCtx.stroke();
            artCtx.beginPath();
            artCtx.moveTo(centerX + 8, fullHeight * 0.79);
            artCtx.lineTo(centerX + 120, fullHeight * 0.7);
            artCtx.stroke();

            artCtx.fillStyle = "rgba(83,124,58,0.92)";
            artCtx.beginPath();
            artCtx.moveTo(centerX - 70, fullHeight * 0.72);
            artCtx.quadraticCurveTo(centerX - 120, fullHeight * 0.66, centerX - 110, fullHeight * 0.56);
            artCtx.quadraticCurveTo(centerX - 72, fullHeight * 0.6, centerX - 64, fullHeight * 0.69);
            artCtx.closePath();
            artCtx.fill();
            artCtx.beginPath();
            artCtx.moveTo(centerX + 58, fullHeight * 0.68);
            artCtx.quadraticCurveTo(centerX + 108, fullHeight * 0.62, centerX + 102, fullHeight * 0.53);
            artCtx.quadraticCurveTo(centerX + 64, fullHeight * 0.57, centerX + 56, fullHeight * 0.66);
            artCtx.closePath();
            artCtx.fill();

            artCtx.save();
            artCtx.translate(centerX, centerY + 24);
            artCtx.scale(1, 0.34);
            artCtx.fillStyle = "rgba(255,255,255,0.22)";
            artCtx.beginPath();
            artCtx.arc(0, 0, 180, 0, Math.PI * 2);
            artCtx.fill();
            artCtx.restore();

            ctx.drawImage(art, sliceIndex * width, 0, width, height, 0, 0, width, height);

            ctx.fillStyle = "rgba(255,255,255,0.09)";
            for (var g = 0; g < 240; g += 1) {
                ctx.fillRect((g * 13) % width, (g * 29) % height, 1, 1);
            }

            ctx.strokeStyle = "rgba(255,248,233,0.18)";
            ctx.lineWidth = 4;
            ctx.strokeRect(10, 10, width - 20, height - 20);
        });
    };

    var createMirrorTexture = function () {
        return createCanvasTexture(1024, 1024, function (ctx, width, height) {
            var gradient = ctx.createLinearGradient(0, 0, width, height);
            gradient.addColorStop(0, "#f4fbff");
            gradient.addColorStop(0.18, "#cedae4");
            gradient.addColorStop(0.48, "#8e9eab");
            gradient.addColorStop(0.8, "#46505a");
            gradient.addColorStop(1, "#1f2830");
            ctx.fillStyle = gradient;
            ctx.fillRect(0, 0, width, height);

            ctx.save();
            ctx.filter = "blur(20px)";
            ctx.globalAlpha = 0.58;

            ctx.fillStyle = "rgba(255,255,255,0.42)";
            ctx.fillRect(width * 0.08, height * 0.1, width * 0.32, height * 0.2);
            ctx.fillStyle = "rgba(215,192,164,0.36)";
            ctx.fillRect(width * 0.18, height * 0.64, width * 0.6, height * 0.12);
            ctx.fillStyle = "rgba(50,38,30,0.38)";
            ctx.fillRect(width * 0.48, height * 0.2, width * 0.08, height * 0.58);
            ctx.fillStyle = "rgba(73,95,58,0.32)";
            ctx.beginPath();
            ctx.ellipse(width * 0.82, height * 0.38, 84, 210, -0.28, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = "rgba(255,250,238,0.22)";
            ctx.fillRect(width * 0.64, height * 0.1, width * 0.12, height * 0.36);

            ctx.filter = "none";
            ctx.globalAlpha = 1;
            ctx.restore();

            ctx.fillStyle = "rgba(255,255,255,0.2)";
            ctx.fillRect(width * 0.015, 0, width * 0.012, height);
            ctx.fillRect(width * 0.03, 0, width * 0.006, height);
            ctx.fillStyle = "rgba(255,255,255,0.12)";
            ctx.fillRect(width * 0.1, height * 0.06, width * 0.8, 6);
            ctx.fillRect(width * 0.14, height * 0.5, width * 0.62, 4);
            ctx.fillRect(width * 0.26, height * 0.84, width * 0.5, 4);

            ctx.fillStyle = "rgba(0,0,0,0.1)";
            ctx.fillRect(0, 0, width, 24);
            ctx.fillRect(0, height - 18, width, 18);
            ctx.fillRect(0, 0, 18, height);
            ctx.fillRect(width - 16, 0, 16, height);

            ctx.fillStyle = "rgba(255,255,255,0.08)";
            for (var i = 0; i < 220; i += 1) {
                ctx.fillRect(Math.random() * width, Math.random() * height, 2, 2);
            }
        });
    };

    var createClockFaceTexture = function () {
        return createCanvasTexture(512, 512, function (ctx, width, height) {
            ctx.fillStyle = "#ede3d4";
            ctx.beginPath();
            ctx.arc(width * 0.5, height * 0.5, width * 0.45, 0, Math.PI * 2);
            ctx.fill();

            ctx.strokeStyle = "#5a4c3f";
            ctx.lineWidth = 16;
            ctx.stroke();

            ctx.save();
            ctx.translate(width * 0.5, height * 0.5);
            for (var i = 0; i < 12; i += 1) {
                ctx.rotate((Math.PI * 2) / 12);
                ctx.fillStyle = i % 3 === 0 ? "#453d37" : "#7d7166";
                ctx.fillRect(-5, -width * 0.38, 10, i % 3 === 0 ? 46 : 26);
            }
            ctx.restore();
        });
    };

    var buildShell = function (parent, materials) {
        createPrimitive({
            name: "floor",
            type: "box",
            material: materials.floor,
            position: [0, 0, 0],
            scale: [6.3, 0.08, 7.1],
            parent: parent
        });

        createPrimitive({
            name: "ceiling",
            type: "box",
            material: materials.ceiling,
            position: [0, 3.2, 0],
            scale: [6.3, 0.08, 7.1],
            parent: parent
        });

        createPrimitive({
            name: "wall-left",
            type: "box",
            material: materials.wall,
            position: [-3.15, 1.6, 0],
            scale: [0.08, 3.2, 7.1],
            parent: parent
        });

        createPrimitive({
            name: "wall-right",
            type: "box",
            material: materials.wall,
            position: [3.15, 1.6, 0],
            scale: [0.08, 3.2, 7.1],
            parent: parent
        });

        createPrimitive({
            name: "wall-back",
            type: "box",
            material: materials.wall,
            position: [0, 1.6, -3.55],
            scale: [6.3, 3.2, 0.08],
            parent: parent
        });

        createPrimitive({
            name: "wall-front-left",
            type: "box",
            material: materials.wall,
            position: [-2.05, 1.6, 3.55],
            scale: [2.1, 3.2, 0.08],
            parent: parent
        });

        createPrimitive({
            name: "wall-front-right",
            type: "box",
            material: materials.wall,
            position: [1.7, 1.6, 3.55],
            scale: [2.8, 3.2, 0.08],
            parent: parent
        });

        createPrimitive({
            name: "wall-front-top",
            type: "box",
            material: materials.wall,
            position: [-0.25, 2.83, 3.55],
            scale: [0.95, 0.72, 0.08],
            parent: parent
        });

        createPrimitive({
            name: "door-frame-left",
            type: "box",
            material: materials.trim,
            position: [-0.77, 1.1, 3.49],
            scale: [0.1, 2.2, 0.16],
            parent: parent
        });

        createPrimitive({
            name: "door-frame-right",
            type: "box",
            material: materials.trim,
            position: [0.27, 1.1, 3.49],
            scale: [0.1, 2.2, 0.16],
            parent: parent
        });

        createPrimitive({
            name: "door-frame-top",
            type: "box",
            material: materials.trim,
            position: [-0.25, 2.15, 3.49],
            scale: [1.14, 0.1, 0.16],
            parent: parent
        });

        createPrimitive({
            name: "baseboard-back",
            type: "box",
            material: materials.trim,
            position: [0, 0.12, -3.47],
            scale: [6.15, 0.18, 0.08],
            parent: parent
        });

        createPrimitive({
            name: "baseboard-left",
            type: "box",
            material: materials.trim,
            position: [-3.07, 0.12, 0],
            scale: [0.08, 0.18, 7.0],
            parent: parent
        });

        createPrimitive({
            name: "baseboard-right",
            type: "box",
            material: materials.trim,
            position: [3.07, 0.12, 0],
            scale: [0.08, 0.18, 7.0],
            parent: parent
        });

        createPrimitive({
            name: "baseboard-front-left",
            type: "box",
            material: materials.trim,
            position: [-2.04, 0.12, 3.47],
            scale: [2.08, 0.18, 0.08],
            parent: parent
        });

        createPrimitive({
            name: "baseboard-front-right",
            type: "box",
            material: materials.trim,
            position: [1.69, 0.12, 3.47],
            scale: [2.78, 0.18, 0.08],
            parent: parent
        });

        createPrimitive({
            name: "rug",
            type: "box",
            material: materials.rug,
            position: [0.35, 0.045, 0.55],
            scale: [2.7, 0.03, 2.1],
            parent: parent,
            castShadows: false
        });

        var windowRoot = createGroup("window-root", parent);
        windowRoot.setLocalPosition(-3.1, 1.76, -1.92);
        windowRoot.setLocalEulerAngles(0, 90, 0);

        createPrimitive({
            name: "window-glow",
            type: "plane",
            material: materials.sky,
            position: [0, 0, 0],
            scale: [1.6, 1.48, 1],
            parent: windowRoot,
            castShadows: false,
            receiveShadows: false
        });

        room.windowGlow = createPrimitive({
            name: "window-sheen",
            type: "plane",
            material: materials.windowGlow,
            position: [-0.01, 0, 0],
            scale: [1.72, 1.6, 1],
            parent: windowRoot,
            castShadows: false,
            receiveShadows: false
        });

        createPrimitive({
            name: "window-frame-top",
            type: "box",
            material: materials.trim,
            position: [0, 0.77, 0.03],
            scale: [1.78, 0.08, 0.08],
            rotation: [0, 0, 90],
            parent: windowRoot
        });

        createPrimitive({
            name: "window-frame-bottom",
            type: "box",
            material: materials.trim,
            position: [0, -0.77, 0.03],
            scale: [1.78, 0.08, 0.08],
            rotation: [0, 0, 90],
            parent: windowRoot
        });

        createPrimitive({
            name: "window-frame-left",
            type: "box",
            material: materials.trim,
            position: [-0.82, 0, 0.03],
            scale: [0.08, 1.54, 0.08],
            parent: windowRoot
        });

        createPrimitive({
            name: "window-frame-right",
            type: "box",
            material: materials.trim,
            position: [0.82, 0, 0.03],
            scale: [0.08, 1.54, 0.08],
            parent: windowRoot
        });

        createPrimitive({
            name: "window-curtain-left",
            type: "plane",
            material: materials.curtain,
            position: [-0.48, 0.05, 0.05],
            scale: [0.72, 1.34, 1],
            parent: windowRoot,
            castShadows: false
        });

        createPrimitive({
            name: "window-curtain-right",
            type: "plane",
            material: materials.curtain,
            position: [0.52, -0.02, 0.05],
            scale: [0.66, 1.26, 1],
            parent: windowRoot,
            castShadows: false
        });
    };

    var buildBed = function (parent, materials) {
        var bed = createGroup("bed", parent);
        bed.setLocalPosition(-1.55, 0, 1.1);
        room.nodes.bed = bed;

        createPrimitive({
            name: "bed-frame",
            type: "box",
            material: materials.woodDark,
            position: [0, 0.26, 0],
            scale: [2.08, 0.28, 1.55],
            parent: bed
        });

        createPrimitive({
            name: "bed-headboard",
            type: "box",
            material: materials.woodDark,
            position: [0, 0.86, -0.68],
            scale: [2.18, 1.1, 0.12],
            parent: bed
        });

        createPrimitive({
            name: "bed-mattress",
            type: "box",
            material: materials.mattress,
            position: [0, 0.47, 0.02],
            scale: [1.92, 0.22, 1.4],
            parent: bed
        });

        createPrimitive({
            name: "bed-blanket",
            type: "box",
            material: materials.blanket,
            position: [0, 0.59, 0.15],
            scale: [1.88, 0.08, 1.12],
            parent: bed
        });

        createPrimitive({
            name: "bed-throw",
            type: "box",
            material: materials.throw,
            position: [0.55, 0.63, 0.38],
            scale: [0.72, 0.04, 0.58],
            rotation: [0, 8, 0],
            parent: bed
        });

        createPrimitive({
            name: "bed-pillow-left",
            type: "box",
            material: materials.pillow,
            position: [-0.48, 0.64, -0.38],
            scale: [0.56, 0.12, 0.36],
            rotation: [8, 0, 0],
            parent: bed
        });

        createPrimitive({
            name: "bed-pillow-right",
            type: "box",
            material: materials.pillow,
            position: [0.48, 0.64, -0.38],
            scale: [0.56, 0.12, 0.36],
            rotation: [8, 0, 0],
            parent: bed
        });

        createPrimitive({
            name: "bed-bench",
            type: "box",
            material: materials.fabricTaupe,
            position: [0, 0.27, 1.05],
            scale: [1.18, 0.24, 0.34],
            parent: bed
        });
    };

    var buildNightstand = function (parent, materials) {
        var stand = createGroup("nightstand", parent);
        stand.setLocalPosition(-2.45, 0, 0.98);
        room.nodes.nightstand = stand;

        createPrimitive({
            name: "nightstand-body",
            type: "box",
            material: materials.woodLight,
            position: [0, 0.39, 0],
            scale: [0.54, 0.78, 0.5],
            parent: stand
        });

        createPrimitive({
            name: "nightstand-drawer",
            type: "box",
            material: materials.woodDark,
            position: [0, 0.42, 0.24],
            scale: [0.42, 0.18, 0.04],
            parent: stand
        });

        createPrimitive({
            name: "lamp-stand",
            type: "cylinder",
            material: materials.metal,
            position: [0, 1.02, 0],
            scale: [0.05, 0.44, 0.05],
            parent: stand
        });

        createPrimitive({
            name: "lamp-base",
            type: "cylinder",
            material: materials.metal,
            position: [0, 0.82, 0],
            scale: [0.16, 0.04, 0.16],
            parent: stand
        });

        createPrimitive({
            name: "lamp-shade",
            type: "cone",
            material: materials.lampShade,
            position: [0, 1.32, 0],
            scale: [0.26, 0.3, 0.26],
            rotation: [180, 0, 0],
            parent: stand,
            castShadows: false
        });
    };

    var buildDeskAndChair = function (parent, materials) {
        var desk = createGroup("desk", parent);
        desk.setLocalPosition(0.65, 0, -2.55);
        room.nodes.desk = desk;

        createPrimitive({
            name: "desk-top",
            type: "box",
            material: materials.woodDark,
            position: [0, 0.76, 0],
            scale: [1.78, 0.08, 0.7],
            parent: desk
        });

        createPrimitive({
            name: "desk-leg-a",
            type: "box",
            material: materials.metal,
            position: [-0.78, 0.38, -0.28],
            scale: [0.06, 0.76, 0.06],
            parent: desk
        });

        createPrimitive({
            name: "desk-leg-b",
            type: "box",
            material: materials.metal,
            position: [0.78, 0.38, -0.28],
            scale: [0.06, 0.76, 0.06],
            parent: desk
        });

        createPrimitive({
            name: "desk-leg-c",
            type: "box",
            material: materials.metal,
            position: [-0.78, 0.38, 0.28],
            scale: [0.06, 0.76, 0.06],
            parent: desk
        });

        createPrimitive({
            name: "desk-leg-d",
            type: "box",
            material: materials.metal,
            position: [0.78, 0.38, 0.28],
            scale: [0.06, 0.76, 0.06],
            parent: desk
        });

        createPrimitive({
            name: "desk-laptop-base",
            type: "box",
            material: materials.metal,
            position: [0.1, 0.84, -0.05],
            scale: [0.48, 0.02, 0.34],
            parent: desk
        });

        createPrimitive({
            name: "desk-laptop-screen",
            type: "box",
            material: materials.screen,
            position: [0.1, 1.04, -0.18],
            scale: [0.48, 0.34, 0.03],
            rotation: [70, 0, 0],
            parent: desk,
            castShadows: false
        });

        createPrimitive({
            name: "desk-books",
            type: "box",
            material: materials.book,
            position: [-0.42, 0.85, 0.1],
            scale: [0.28, 0.09, 0.22],
            parent: desk
        });

        var chair = createGroup("chair", parent);
        chair.setLocalPosition(0.62, 0, -1.58);
        room.nodes.chair = chair;

        createPrimitive({
            name: "chair-seat",
            type: "box",
            material: materials.fabricTaupe,
            position: [0, 0.48, 0],
            scale: [0.58, 0.09, 0.56],
            parent: chair
        });

        createPrimitive({
            name: "chair-back",
            type: "box",
            material: materials.fabricTaupe,
            position: [0, 0.9, -0.22],
            scale: [0.58, 0.72, 0.1],
            parent: chair
        });

        createPrimitive({
            name: "chair-leg-a",
            type: "box",
            material: materials.metal,
            position: [-0.22, 0.24, -0.2],
            scale: [0.05, 0.48, 0.05],
            parent: chair
        });

        createPrimitive({
            name: "chair-leg-b",
            type: "box",
            material: materials.metal,
            position: [0.22, 0.24, -0.2],
            scale: [0.05, 0.48, 0.05],
            parent: chair
        });

        createPrimitive({
            name: "chair-leg-c",
            type: "box",
            material: materials.metal,
            position: [-0.22, 0.24, 0.2],
            scale: [0.05, 0.48, 0.05],
            parent: chair
        });

        createPrimitive({
            name: "chair-leg-d",
            type: "box",
            material: materials.metal,
            position: [0.22, 0.24, 0.2],
            scale: [0.05, 0.48, 0.05],
            parent: chair
        });
    };

    var buildDresser = function (parent, materials) {
        var dresser = createGroup("dresser", parent);
        dresser.setLocalPosition(2.28, 0, 0.52);
        room.nodes.dresser = dresser;

        createPrimitive({
            name: "dresser-body",
            type: "box",
            material: materials.woodDark,
            position: [0, 0.76, 0],
            scale: [1.02, 0.96, 1.48],
            parent: dresser
        });

        for (var i = 0; i < 4; i += 1) {
            createPrimitive({
                name: "dresser-drawer-" + i,
                type: "box",
                material: materials.woodLight,
                position: [0, 0.38 + (i * 0.19), 0.74],
                scale: [0.82, 0.11, 0.04],
                parent: dresser
            });
        }

        createPrimitive({
            name: "dresser-handle-left",
            type: "box",
            material: materials.metal,
            position: [-0.18, 0.76, 0.79],
            scale: [0.08, 0.02, 0.02],
            parent: dresser
        });

        createPrimitive({
            name: "dresser-handle-right",
            type: "box",
            material: materials.metal,
            position: [0.18, 0.76, 0.79],
            scale: [0.08, 0.02, 0.02],
            parent: dresser
        });
    };

    var buildPlant = function (parent, materials) {
        var plant = createGroup("plant", parent);
        plant.setLocalPosition(2.52, 0, -2.62);
        room.nodes.plant = plant;

        createPrimitive({
            name: "plant-pot",
            type: "cylinder",
            material: materials.pot,
            position: [0, 0.42, 0],
            scale: [0.28, 0.42, 0.28],
            parent: plant
        });

        createPrimitive({
            name: "plant-soil",
            type: "cylinder",
            material: materials.soil,
            position: [0, 0.68, 0],
            scale: [0.24, 0.02, 0.24],
            parent: plant,
            castShadows: false
        });

        var leafPositions = [
            [-0.08, 1.1, 0.03, -30],
            [0.1, 1.18, -0.02, 26],
            [0.02, 1.42, 0.08, 8],
            [-0.05, 1.58, -0.05, -14],
            [0.12, 1.74, 0.02, 18],
            [0, 1.94, -0.03, 0]
        ];

        for (var i = 0; i < leafPositions.length; i += 1) {
            createPrimitive({
                name: "plant-leaf-" + i,
                type: "capsule",
                material: materials.leaf,
                position: [leafPositions[i][0], leafPositions[i][1], leafPositions[i][2]],
                scale: [0.11, 0.34, 0.11],
                rotation: [90, leafPositions[i][3], 0],
                parent: plant,
                castShadows: false
            });
        }
    };

    var buildMirror = function (parent, materials) {
        var mirrorTexture = new pc.Texture(app.graphicsDevice, {
            width: 1024,
            height: 1024,
            format: pc.PIXELFORMAT_R8_G8_B8_A8,
            mipmaps: false,
            minFilter: pc.FILTER_LINEAR,
            magFilter: pc.FILTER_LINEAR,
            addressU: pc.ADDRESS_CLAMP_TO_EDGE,
            addressV: pc.ADDRESS_CLAMP_TO_EDGE
        });
        var mirrorRenderTarget = new pc.RenderTarget({
            colorBuffer: mirrorTexture,
            depth: true,
            flipY: true,
            name: "mirror-rt"
        });

        var surfaceMaterial = createPbrMaterial({
            diffuse: new pc.Color(1, 1, 1),
            diffuseMap: mirrorTexture,
            emissive: new pc.Color(0.13, 0.15, 0.17),
            emissiveIntensity: 0.05,
            metalness: 0.05,
            gloss: 1,
            reflectivity: 0.98,
            clearCoat: 1,
            clearCoatGloss: 1,
            specular: new pc.Color(1, 1, 1),
            useMetalnessSpecularColor: false
        });

        var glassMaterial = createPbrMaterial({
            diffuse: rgb(225, 235, 244),
            emissive: rgb(205, 220, 235),
            emissiveIntensity: 0.02,
            opacity: 0.16,
            gloss: 1,
            metalness: 0,
            reflectivity: 0.55,
            clearCoat: 1,
            clearCoatGloss: 1,
            cull: pc.CULLFACE_NONE,
            depthWrite: false
        });

        var backingMaterial = createPbrMaterial({
            diffuse: rgb(92, 100, 109),
            emissive: rgb(112, 120, 129),
            emissiveIntensity: 0.03,
            metalness: 0.12,
            gloss: 0.84
        });

        var mirrorLayout = room.layout && room.layout.mirror ? room.layout.mirror : null;
        var mirrorRoot = createGroup("mirror-root", parent);
        if (mirrorLayout) {
            mirrorRoot.setPosition(mirrorLayout.position.x, mirrorLayout.position.y, mirrorLayout.position.z);
            mirrorRoot.setEulerAngles(mirrorLayout.rotation[0], mirrorLayout.rotation[1], mirrorLayout.rotation[2]);
        } else {
            mirrorRoot.setLocalPosition(2.36, 1.58, 0.24);
            mirrorRoot.setLocalEulerAngles(0, -90, 0);
        }
        room.nodes.mirror = mirrorRoot;
        room.mirrorTarget = mirrorTexture;
        room.mirrorSurfaceMaterial = surfaceMaterial;
        room.mirrorGlassMaterial = glassMaterial;
        room.mirrorBackingMaterial = backingMaterial;

        room.mirrorCamera = new pc.Entity("mirror-camera");
        room.mirrorCamera.addComponent("camera", {
            clearColor: new pc.Color(0.18, 0.19, 0.21),
            fov: 64,
            nearClip: 0.05,
            farClip: 80,
            priority: -5
        });
        room.mirrorCamera.camera.renderTarget = mirrorRenderTarget;
        room.mirrorCamera.camera.clearColorBuffer = true;
        room.mirrorCamera.camera.clearDepthBuffer = true;
        room.mirrorCamera.camera.flipFaces = true;
        app.root.addChild(room.mirrorCamera);

        createPrimitive({
            name: "mirror-frame",
            type: "box",
            material: materials.woodDark,
            position: [0, 0, 0],
            scale: [0.16, 2.08, 1.3],
            parent: mirrorRoot
        });

        createPrimitive({
            name: "mirror-backing",
            type: "box",
            material: backingMaterial,
            position: [-0.04, 0, 0],
            scale: [1.02, 1.84, 0.04],
            parent: mirrorRoot,
            castShadows: false,
            receiveShadows: false
        });

        var mirrorSurface = createPrimitive({
            name: "mirror-surface",
            type: "box",
            material: surfaceMaterial,
            position: [-0.01, 0, 0.02],
            scale: [1.08, 1.82, 0.02],
            parent: mirrorRoot,
            castShadows: false,
            receiveShadows: false
        });

        createPrimitive({
            name: "mirror-glass",
            type: "box",
            material: glassMaterial,
            position: [0, 0, 0.03],
            scale: [1.1, 1.86, 0.03],
            parent: mirrorRoot,
            castShadows: false,
            receiveShadows: false
        });

        room.mirrorAura = createPrimitive({
            name: "mirror-aura",
            type: "plane",
            material: materials.aura,
            position: [-0.08, 0, 0],
            scale: [1.18, 1.96, 1],
            rotation: [0, 180, 0],
            parent: mirrorRoot,
            castShadows: false,
            receiveShadows: false
        });

        room.mirror = {
            surface: mirrorSurface,
            point: mirrorSurface.getPosition().clone(),
            normal: mirrorSurface.forward.clone()
        };
    };

    var buildPhotoWall = function (parent, materials) {
        var anchor = createGroup("photo-wall", parent);
        anchor.setLocalPosition(-2.28, 1.76, 0.22);
        anchor.setLocalEulerAngles(0, 90, 0);
        room.nodes.photoWall = anchor;

        createPrimitive({
            name: "photo-frame",
            type: "box",
            material: materials.woodDark,
            position: [0, 0, 0],
            scale: [1.8, 1.08, 0.08],
            parent: anchor
        });

        createPrimitive({
            name: "photo-paper",
            type: "box",
            material: materials.paper,
            position: [0, 0, 0.04],
            scale: [1.56, 0.84, 0.05],
            parent: anchor,
            castShadows: false
        });

        var photoData = [
            { x: -0.48, label: "壹", tones: ["#be9a77", "#695242"] },
            { x: 0, label: "贰", tones: ["#8aa2ba", "#465768"] },
            { x: 0.48, label: "叁", tones: ["#d4b38e", "#806653"] }
        ];

        room.photoPieces.length = 0;
        for (var i = 0; i < photoData.length; i += 1) {
            var texture = createPhotoTexture(photoData[i].tones[0], photoData[i].tones[1], photoData[i].label);
            var pieceMaterial = createPbrMaterial({
                diffuse: new pc.Color(1, 1, 1),
                diffuseMap: texture,
                emissive: rgb(255, 246, 232),
                emissiveIntensity: 0.06,
                gloss: 0.06,
                metalness: 0,
                opacity: 0.12
            });

            var piece = createPrimitive({
                name: "photo-piece-" + i,
                type: "box",
                material: pieceMaterial,
                position: [photoData[i].x, 0, 0.055],
                scale: [0.44, 0.64, 0.06],
                parent: anchor,
                castShadows: false,
                receiveShadows: false
            });

            room.photoPieces.push({
                entity: piece,
                material: pieceMaterial,
                reveal: 0
            });
        }
    };

    var buildMirrorDoll = function (materials) {
        var dollRoot = createGroup("mirror-doll", app.root);
        var dollPoint = invertRoomPoint(vec3(1.86, 0.44, 0.38));
        dollRoot.setPosition(dollPoint.x, dollPoint.y, dollPoint.z);

        createPrimitive({
            name: "doll-body",
            type: "capsule",
            material: materials.ghostBody,
            position: [0, 0.18, 0],
            scale: [0.12, 0.26, 0.12],
            parent: dollRoot,
            castShadows: false,
            receiveShadows: false
        });

        createPrimitive({
            name: "doll-head",
            type: "sphere",
            material: materials.ghostBody,
            position: [0, 0.44, 0],
            scale: [0.14, 0.14, 0.14],
            parent: dollRoot,
            castShadows: false,
            receiveShadows: false
        });

        createPrimitive({
            name: "doll-eye-left",
            type: "sphere",
            material: materials.ghostEye,
            position: [-0.04, 0.45, 0.1],
            scale: [0.02, 0.02, 0.02],
            parent: dollRoot,
            castShadows: false,
            receiveShadows: false
        });

        createPrimitive({
            name: "doll-eye-right",
            type: "sphere",
            material: materials.ghostEye,
            position: [0.04, 0.45, 0.1],
            scale: [0.02, 0.02, 0.02],
            parent: dollRoot,
            castShadows: false,
            receiveShadows: false
        });

        dollRoot.enabled = false;

        game.anomalies.push({
            id: "mirror-doll",
            label: "镜子里的玩偶",
            point: dollPoint,
            range: 4.6,
            threshold: 0.975,
            found: false,
            entity: dollRoot,
            message: "镜面里多出来的玩偶已经消失了。"
        });
    };

    var buildGhostVase = function (materials) {
        var vaseRoot = createGroup("ghost-vase", app.root);
        var vasePoint = invertRoomPoint(vec3(2.28, 0.9, 0.36));
        vaseRoot.setPosition(vasePoint.x, vasePoint.y, vasePoint.z);

        createPrimitive({
            name: "vase-body",
            type: "cone",
            material: materials.ghostGlass,
            position: [0, 0.16, 0],
            scale: [0.14, 0.34, 0.14],
            rotation: [180, 0, 0],
            parent: vaseRoot,
            castShadows: false
        });

        createPrimitive({
            name: "vase-neck",
            type: "cylinder",
            material: materials.ghostGlass,
            position: [0, 0.42, 0],
            scale: [0.06, 0.16, 0.06],
            parent: vaseRoot,
            castShadows: false
        });

        createPrimitive({
            name: "vase-bloom-a",
            type: "sphere",
            material: materials.ghostBody,
            position: [0.05, 0.58, 0.02],
            scale: [0.08, 0.08, 0.08],
            parent: vaseRoot,
            castShadows: false
        });

        createPrimitive({
            name: "vase-bloom-b",
            type: "sphere",
            material: materials.ghostBody,
            position: [-0.05, 0.54, -0.02],
            scale: [0.07, 0.07, 0.07],
            parent: vaseRoot,
            castShadows: false
        });

        vaseRoot.enabled = false;

        game.anomalies.push({
            id: "ghost-vase",
            label: "柜面上的幽灵花瓶",
            point: vasePoint,
            range: 4.8,
            threshold: 0.972,
            found: false,
            entity: vaseRoot,
            message: "梳妆柜上的花瓶像雾一样散开了。"
        });
    };

    var makeGhostClone = function (sourceEntity, ghostMaterial) {
        var clone = sourceEntity.clone();
        var position = sourceEntity.getPosition();
        var rotation = sourceEntity.getEulerAngles();
        var inverted = invertRoomPoint(position);
        clone.setPosition(inverted.x, inverted.y, inverted.z);
        clone.setEulerAngles(rotation.x + 180, rotation.y, rotation.z);

        visitEntityTree(clone, function (node) {
            if (node.render && node.render.meshInstances && node.render.meshInstances.length) {
                for (var i = 0; i < node.render.meshInstances.length; i += 1) {
                    node.render.meshInstances[i].material = ghostMaterial;
                }
            }
        });

        app.root.addChild(clone);
        clone.enabled = false;
        return clone;
    };

    var buildUpsideChairAnomaly = function (materials) {
        var clone = makeGhostClone(room.nodes.chair, materials.ghostBody);

        game.anomalies.push({
            id: "upside-chair",
            label: "天花板上的倒挂椅子",
            point: clone.getPosition().clone(),
            range: 5.2,
            threshold: 0.97,
            found: false,
            entity: clone,
            message: "倒挂在天花板上的椅子慢慢褪掉了。"
        });
    };

    var rememberRoomEntityMaterials = function (entity) {
        visitEntityTree(entity, function (node) {
            if (!node.render || !node.render.meshInstances || !node.render.meshInstances.length) {
                return;
            }

            node.render.castShadows = true;
            node.render.receiveShadows = true;

            for (var meshIndex = 0; meshIndex < node.render.meshInstances.length; meshIndex += 1) {
                trackRoomMaterial(node.render.meshInstances[meshIndex].material);
            }
        });
    };

    var loadUpsideStudyAsset = function (key, callback) {
        var config = upsideStudyAssets[key];
        if (!config) {
            callback(new Error("Missing upside study asset config: " + key));
            return;
        }
        var assetUrl = getUpsideStudyAssetUrl(key);

        if (upsideStudyAssetCache[key]) {
            callback(null, upsideStudyAssetCache[key]);
            return;
        }

        var handleAsset = function (error, asset) {
            if (error) {
                callback(error);
                return;
            }

            upsideStudyAssetCache[key] = asset;
            callback(null, asset);
        };

        if (app.assets.loadFromUrlAndFilename) {
            app.assets.loadFromUrlAndFilename(assetUrl, config.filename, "container", handleAsset);
            return;
        }

        var asset = new pc.Asset(config.name, "container", {
            url: assetUrl,
            filename: config.filename
        });

        app.assets.add(asset);
        asset.ready(function () {
            handleAsset(null, asset);
        });
        asset.on("error", function (assetError) {
            callback(assetError || new Error("Failed to load " + config.filename));
        });
        app.assets.load(asset);
    };

    var instantiateUpsideStudyAsset = function (key, parent, transform) {
        var asset = upsideStudyAssetCache[key];
        if (!asset || !asset.resource) {
            throw new Error("Asset not ready: " + key);
        }

        var entity = asset.resource.instantiateRenderEntity ? asset.resource.instantiateRenderEntity() : asset.resource.instantiateModelEntity();
        entity.name = key + "-instance";
        (parent || app.root).addChild(entity);

        if (transform && transform.position) {
            entity.setLocalPosition(transform.position[0], transform.position[1], transform.position[2]);
        }
        if (transform && transform.rotation) {
            entity.setLocalEulerAngles(transform.rotation[0], transform.rotation[1], transform.rotation[2]);
        }
        if (transform && transform.scale) {
            entity.setLocalScale(transform.scale[0], transform.scale[1], transform.scale[2]);
        }

        rememberRoomEntityMaterials(entity);
        return entity;
    };

    var buildStudyChair = function (parent, materials) {
        var chair = createGroup("study-chair", parent);
        chair.setLocalPosition(0.56, 0, -0.72);
        room.nodes.chair = chair;

        createPrimitive({
            name: "chair-seat",
            type: "box",
            material: materials.fabricTaupe,
            position: [0, 0.5, 0],
            scale: [0.58, 0.1, 0.54],
            parent: chair
        });

        createPrimitive({
            name: "chair-back",
            type: "box",
            material: materials.fabricTaupe,
            position: [0, 0.94, -0.22],
            scale: [0.56, 0.7, 0.1],
            parent: chair
        });

        createPrimitive({
            name: "chair-back-bar",
            type: "box",
            material: materials.woodDark,
            position: [0, 0.78, -0.18],
            scale: [0.44, 0.08, 0.08],
            parent: chair
        });

        createPrimitive({
            name: "chair-leg-a",
            type: "box",
            material: materials.woodDark,
            position: [-0.21, 0.23, -0.2],
            scale: [0.06, 0.46, 0.06],
            parent: chair
        });

        createPrimitive({
            name: "chair-leg-b",
            type: "box",
            material: materials.woodDark,
            position: [0.21, 0.23, -0.2],
            scale: [0.06, 0.46, 0.06],
            parent: chair
        });

        createPrimitive({
            name: "chair-leg-c",
            type: "box",
            material: materials.woodDark,
            position: [-0.21, 0.23, 0.2],
            scale: [0.06, 0.46, 0.06],
            parent: chair
        });

        createPrimitive({
            name: "chair-leg-d",
            type: "box",
            material: materials.woodDark,
            position: [0.21, 0.23, 0.2],
            scale: [0.06, 0.46, 0.06],
            parent: chair
        });
    };

    var buildStudyBackdrop = function (parent, materials) {
        var facade = createGroup("study-facade", parent);

        createPrimitive({
            name: "study-door-frame",
            type: "box",
            material: materials.trim,
            position: [-1.82, 1.28, 2.66],
            scale: [0.9, 2.34, 0.08],
            parent: facade
        });

        createPrimitive({
            name: "study-door-panel",
            type: "box",
            material: materials.woodDark,
            position: [-1.82, 1.26, 2.61],
            scale: [0.72, 2.08, 0.06],
            parent: facade
        });

        room.windowGlow = createPrimitive({
            name: "study-window-glow",
            type: "box",
            material: materials.windowGlow,
            position: [0.98, 1.62, 2.62],
            scale: [1.88, 1.46, 0.05],
            parent: facade,
            castShadows: false,
            receiveShadows: false
        });

        createPrimitive({
            name: "study-window-mullion-h",
            type: "box",
            material: materials.trim,
            position: [0.98, 1.62, 2.64],
            scale: [1.8, 0.06, 0.03],
            parent: facade,
            castShadows: false
        });

        createPrimitive({
            name: "study-window-mullion-v",
            type: "box",
            material: materials.trim,
            position: [0.98, 1.62, 2.64],
            scale: [0.06, 1.38, 0.03],
            parent: facade,
            castShadows: false
        });
    };

    var buildUpsideStudyFromAssets = function (materials, onDone) {
        var studyKeys = ["shell"];

        var loadNextStudyAsset = function (index) {
            if (index >= studyKeys.length) {
                try {
                    room.nodes.shell = instantiateUpsideStudyAsset("shell", room.root, {
                        position: [0, 0, 0],
                        rotation: [0, 0, 0],
                        scale: [1, 1, 1]
                    });

                    var initialBounds = getEntityWorldBounds(room.nodes.shell);
                    if (!initialBounds) {
                        throw new Error("Scene 1 baked shell did not produce render bounds.");
                    }

                    var localBounds = getUpsideLocalBoundsFromWorld(initialBounds);
                    room.nodes.shell.setLocalPosition(
                        -((localBounds.minX + localBounds.maxX) * 0.5),
                        room.flipHeight - localBounds.maxY,
                        -((localBounds.minZ + localBounds.maxZ) * 0.5)
                    );

                    var shellBounds = getEntityWorldBounds(room.nodes.shell);
                    if (!shellBounds) {
                        throw new Error("Scene 1 baked shell bounds could not be refreshed.");
                    }

                    room.layout = createUpsideRoomLayout(shellBounds);

                    buildMirror(room.root, materials);
                    buildPhotoWall(room.root, materials);
                    buildMirrorDoll(materials);
                    buildGhostVase(materials);
                    buildUpsideChairAnomaly(materials);

                    lampLight.setLocalPosition(room.layout.lamp.x, room.layout.lamp.y, room.layout.lamp.z);

                    room.bounds = {
                        minX: shellBounds.minX + 0.22,
                        maxX: shellBounds.maxX - 0.22,
                        minZ: shellBounds.minZ + 0.22,
                        maxZ: shellBounds.maxZ - 0.22
                    };

                    room.meshColliders = [];
                    room.obstacles = buildPerimeterObstacles(room.bounds, 0.28);

                    player.yaw = room.layout.spawn.yaw;
                    player.pitch = room.layout.spawn.pitch;
                    snapCameraLook();
                    cameraRig.setLocalPosition(
                        room.layout.spawn.position.x,
                        room.layout.spawn.position.y,
                        room.layout.spawn.position.z
                    );

                    window.__upsideRoomSceneDebug = {
                        scene1Asset: getUpsideReplicaAssetUrl(),
                        roomBounds: room.bounds,
                        collision: {
                            mesh: room.meshColliders.length,
                            total: room.obstacles.length
                        },
                        spawn: {
                            x: room.layout.spawn.position.x,
                            y: room.layout.spawn.position.y,
                            z: room.layout.spawn.position.z,
                            yaw: room.layout.spawn.yaw,
                            pitch: room.layout.spawn.pitch
                        },
                        mirror: {
                            x: room.layout.mirror.position.x,
                            y: room.layout.mirror.position.y,
                            z: room.layout.mirror.position.z
                        },
                        photo: {
                            x: room.layout.photo.position.x,
                            y: room.layout.photo.position.y,
                            z: room.layout.photo.position.z
                        }
                    };
                    document.body.setAttribute("data-scene1-asset", "Baked_sc0_staging_00.uncompressed.glb");
                    document.body.setAttribute("data-scene1-mesh-colliders", String(room.meshColliders.length));
                    document.body.setAttribute("data-scene1-total-obstacles", String(room.obstacles.length));

                    if (onDone) {
                        onDone(null);
                    }
                } catch (buildError) {
                    if (onDone) {
                        onDone(buildError);
                    }
                }
                return;
            }

            loadUpsideStudyAsset(studyKeys[index], function (loadError) {
                if (loadError) {
                    if (onDone) {
                        onDone(loadError);
                    }
                    return;
                }
                loadNextStudyAsset(index + 1);
            });
        };

        loadNextStudyAsset(0);
    };

    var buildManualRoom = function () {
        room.container = createGroup("room-container", app.root);
        room.container.setLocalPosition(0, room.flipHeight * 0.5, 0);
        room.container.setLocalEulerAngles(180, 0, 0);

        room.root = createGroup("room-root", room.container);
        room.root.setLocalPosition(0, -room.flipHeight * 0.5, 0);

        var wallTexture = createWallTexture();
        var floorTexture = createWoodTexture(false);
        var trimTexture = createWoodTexture(true);
        var blanketTexture = createFabricTexture("#6c7f86", "#80939a");
        var mattressTexture = createFabricTexture("#dfd7ca", "#c8c1b7");
        var pillowTexture = createFabricTexture("#d8d0c5", "#c9c2b9");
        var taupeTexture = createFabricTexture("#9a8775", "#ad9c8f");
        var throwTexture = createFabricTexture("#81685a", "#9a7f6f");
        var rugTexture = createRugTexture();
        var curtainTexture = createFabricTexture("#dbd2c8", "#cfc6bb");
        var skyTexture = createSkyTexture();

        var materials = {
            wall: trackRoomMaterial(createPbrMaterial({
                diffuse: rgb(214, 205, 193),
                diffuseMap: wallTexture,
                tiling: new pc.Vec2(2, 2),
                gloss: 0.06,
                metalness: 0
            })),
            ceiling: trackRoomMaterial(createPbrMaterial({
                diffuse: rgb(228, 224, 218),
                gloss: 0.02,
                metalness: 0
            })),
            floor: trackRoomMaterial(createPbrMaterial({
                diffuse: rgb(191, 162, 132),
                diffuseMap: floorTexture,
                tiling: new pc.Vec2(5, 4),
                gloss: 0.24,
                metalness: 0.02
            })),
            trim: trackRoomMaterial(createPbrMaterial({
                diffuse: rgb(116, 89, 66),
                diffuseMap: trimTexture,
                gloss: 0.2,
                metalness: 0.02
            })),
            rug: trackRoomMaterial(createPbrMaterial({
                diffuse: rgb(140, 126, 108),
                diffuseMap: rugTexture,
                tiling: new pc.Vec2(1.4, 1.2),
                gloss: 0.08,
                metalness: 0
            })),
            woodDark: trackRoomMaterial(createPbrMaterial({
                diffuse: rgb(98, 72, 54),
                diffuseMap: trimTexture,
                gloss: 0.22,
                metalness: 0.02
            })),
            woodLight: trackRoomMaterial(createPbrMaterial({
                diffuse: rgb(148, 112, 80),
                diffuseMap: floorTexture,
                gloss: 0.16,
                metalness: 0
            })),
            mattress: trackRoomMaterial(createPbrMaterial({
                diffuse: rgb(228, 222, 212),
                diffuseMap: mattressTexture,
                gloss: 0.08,
                metalness: 0
            })),
            blanket: trackRoomMaterial(createPbrMaterial({
                diffuse: rgb(113, 128, 137),
                diffuseMap: blanketTexture,
                gloss: 0.09,
                metalness: 0
            })),
            pillow: trackRoomMaterial(createPbrMaterial({
                diffuse: rgb(224, 216, 205),
                diffuseMap: pillowTexture,
                gloss: 0.08,
                metalness: 0
            })),
            fabricTaupe: trackRoomMaterial(createPbrMaterial({
                diffuse: rgb(158, 140, 122),
                diffuseMap: taupeTexture,
                gloss: 0.1,
                metalness: 0
            })),
            throw: trackRoomMaterial(createPbrMaterial({
                diffuse: rgb(131, 108, 93),
                diffuseMap: throwTexture,
                gloss: 0.1,
                metalness: 0
            })),
            curtain: trackRoomMaterial(createPbrMaterial({
                diffuse: rgb(223, 216, 208),
                diffuseMap: curtainTexture,
                gloss: 0.06,
                metalness: 0,
                cull: pc.CULLFACE_NONE,
                twoSidedLighting: true
            })),
            metal: trackRoomMaterial(createPbrMaterial({
                diffuse: rgb(72, 78, 87),
                gloss: 0.84,
                metalness: 1,
                reflectivity: 0.95
            })),
            screen: trackRoomMaterial(createPbrMaterial({
                diffuse: rgb(32, 36, 44),
                emissive: rgb(86, 130, 160),
                emissiveIntensity: 0.1,
                gloss: 0.78,
                metalness: 0.1
            })),
            book: trackRoomMaterial(createPbrMaterial({
                diffuse: rgb(128, 94, 68),
                gloss: 0.14,
                metalness: 0
            })),
            lampShade: trackRoomMaterial(createPbrMaterial({
                diffuse: rgb(235, 223, 201),
                emissive: rgb(255, 238, 208),
                emissiveIntensity: 0.08,
                gloss: 0.08,
                metalness: 0
            })),
            pot: trackRoomMaterial(createPbrMaterial({
                diffuse: rgb(126, 112, 101),
                gloss: 0.1,
                metalness: 0
            })),
            soil: trackRoomMaterial(createPbrMaterial({
                diffuse: rgb(74, 60, 48),
                gloss: 0.04,
                metalness: 0
            })),
            leaf: trackRoomMaterial(createPbrMaterial({
                diffuse: rgb(100, 122, 89),
                gloss: 0.12,
                metalness: 0,
                twoSidedLighting: true
            })),
            sky: createPbrMaterial({
                diffuse: new pc.Color(1, 1, 1),
                diffuseMap: skyTexture,
                useLighting: false,
                gloss: 0,
                metalness: 0,
                cull: pc.CULLFACE_NONE
            }),
            windowGlow: createPbrMaterial({
                diffuse: rgb(255, 245, 220),
                emissive: rgb(255, 243, 212),
                emissiveIntensity: 0.34,
                opacity: 0.22,
                useLighting: false,
                cull: pc.CULLFACE_NONE
            }),
            aura: createPbrMaterial({
                diffuse: rgb(66, 86, 118),
                emissive: rgb(122, 179, 255),
                emissiveIntensity: 0.18,
                opacity: 0.12,
                useLighting: false,
                cull: pc.CULLFACE_NONE
            }),
            paper: trackRoomMaterial(createPbrMaterial({
                diffuse: rgb(236, 231, 220),
                gloss: 0.08,
                metalness: 0,
                twoSidedLighting: true
            })),
            ghostBody: createPbrMaterial({
                diffuse: rgb(192, 202, 220),
                emissive: rgb(104, 166, 255),
                emissiveIntensity: 0.22,
                gloss: 0.22,
                metalness: 0.04,
                opacity: 0.24,
                cull: pc.CULLFACE_NONE
            }),
            ghostEye: createPbrMaterial({
                diffuse: rgb(18, 20, 28),
                emissive: rgb(172, 212, 255),
                emissiveIntensity: 0.5,
                gloss: 0.3,
                metalness: 0,
                useLighting: false
            }),
            ghostGlass: createPbrMaterial({
                diffuse: rgb(188, 215, 238),
                emissive: rgb(110, 170, 255),
                emissiveIntensity: 0.16,
                gloss: 0.74,
                metalness: 0.3,
                opacity: 0.34,
                cull: pc.CULLFACE_NONE
            })
        };

        buildUpsideStudyFromAssets(materials, function (error) {
            if (error) {
                console.warn("Scene 1 study asset load failed, falling back to manual room.", error);

                buildShell(room.root, materials);
                buildStudyBackdrop(room.root, materials);
                buildDeskAndChair(room.root, materials);
                buildPlant(room.root, materials);
                buildMirror(room.root, materials);
                buildPhotoWall(room.root, materials);
                buildMirrorDoll(materials);
                buildGhostVase(materials);
                buildUpsideChairAnomaly(materials);

                if (room.nodes.piano) {
                    room.nodes.piano.setLocalPosition(1.82, 0, 1.42);
                    room.nodes.piano.setLocalScale(0.82, 0.82, 0.82);
                    room.nodes.piano.setLocalEulerAngles(0, -90, 0);
                }

                var fallbackLampPoint = invertRoomPoint(vec3(1.06, 0.9, -1.58));
                lampLight.setLocalPosition(fallbackLampPoint.x, fallbackLampPoint.y + 0.04, fallbackLampPoint.z);

                room.bounds = {
                    minX: -2.26,
                    maxX: 2.26,
                    minZ: -2.16,
                    maxZ: 2.18
                };
                room.obstacles = [
                    { minX: -0.28, maxX: 1.46, minZ: -2.84, maxZ: -1.88 },
                    { minX: 0.22, maxX: 1.04, minZ: -1.94, maxZ: -1.02 },
                    { minX: 1.62, maxX: 2.42, minZ: -0.08, maxZ: 1.94 }
                ].map(invertRoomBox);
                room.obstacles = buildPerimeterObstacles(room.bounds, 0.28).concat(room.obstacles);
                document.body.setAttribute("data-scene1-mesh-colliders", "fallback");
                document.body.setAttribute("data-scene1-total-obstacles", String(room.obstacles.length));

                room.loaded = true;
                document.body.setAttribute("data-scene1-collision", "fallback-manual");
                refreshUi();
                return;
            }

            if (typeof ensureUpsideCollisionLoaded !== "function") {
                fatal(new Error("Scene 1 collision loader was not initialized."));
                return;
            }

            ensureUpsideCollisionLoaded(function (collisionError) {
                if (collisionError) {
                    document.body.setAttribute("data-scene1-collision", "error");
                    fatal(new Error("Scene 1 exact collision failed to initialize: " + collisionError.message));
                    return;
                }
                room.loaded = true;
                refreshUi();
            });
        });
    };

    var collectAnomaly = function (anomaly) {
        if (!anomaly || anomaly.found) {
            return;
        }

        anomaly.found = true;
        game.foundCount += 1;
        anomaly.entity.enabled = false;

        if (room.photoPieces[game.foundCount - 1]) {
            room.photoPieces[game.foundCount - 1].reveal = 1;
        }

        game.currentTarget = null;
        setPrompt("", false);
        showMessage(anomaly.message, game.foundCount >= 3 ? 4.2 : 3.1);
        refreshUi();
    };

    var toggleMode = function () {
        if (isGameShellPaused() || pauseState.waitForRelease || stage.current !== "upside") {
            return;
        }
        mode.target = mode.target === 0 ? 1 : 0;
        refreshUi();
    };

    toggleButton.addEventListener("click", toggleMode);

    mode.names = ["阳光模式", "阴暗模式"];
    title.textContent = "倒置房间";
    copy.textContent = "白昼会整理表象，阴影才承认哪里多出了一件东西。";
    toggleButton.textContent = "切换明暗";
    interactPrompt.style.whiteSpace = "pre-line";
    interactPrompt.style.lineHeight = "1.35";

    updateObjective = function () {
        objective.textContent = "异常物件 " + game.foundCount + " / 3";
    };

    getBaseHint = function () {
        if (!room.loaded) {
            return "房间正在稳定下来……";
        }

        if (game.foundCount >= 3) {
            return "当三次错误被看见，向日葵会替你打开出口。";
        }

        if (mode.target === 0) {
            return "白昼替世界整理好表情。";
        }

        if (game.foundCount === 0) {
            return "黑暗才肯承认，哪里多留下了一样东西。";
        }

        if (game.foundCount === 1) {
            return "向日葵已经拼回一角，剩下的错位正在退潮。";
        }

        return "再找一处，照片就会完整。";
    };

    refreshHint = function () {
        hint.textContent = game.activeMessageTimer > 0 ? game.activeMessage : getBaseHint();
    };

    buildPlant = function (parent, materials) {
        var piano = createGroup("piano", parent);
        piano.setLocalPosition(2.52, 0, -2.62);
        room.nodes.plant = piano;
        room.nodes.piano = piano;

        createPrimitive({
            name: "piano-body",
            type: "box",
            material: materials.woodDark,
            position: [0, 0.52, 0],
            scale: [0.98, 1.04, 1.76],
            parent: piano
        });

        createPrimitive({
            name: "piano-lid",
            type: "box",
            material: materials.woodLight,
            position: [0, 1.08, -0.18],
            scale: [1.0, 0.08, 1.52],
            rotation: [-10, 0, 0],
            parent: piano
        });

        createPrimitive({
            name: "piano-key-bed",
            type: "box",
            material: materials.paper,
            position: [0, 0.24, 0.72],
            scale: [0.72, 0.08, 0.34],
            parent: piano
        });

        createPrimitive({
            name: "piano-keys",
            type: "box",
            material: materials.screen,
            position: [0, 0.29, 0.76],
            scale: [0.64, 0.03, 0.2],
            parent: piano,
            castShadows: false
        });

        createPrimitive({
            name: "piano-leg-left",
            type: "box",
            material: materials.metal,
            position: [-0.36, -0.02, -0.5],
            scale: [0.08, 0.54, 0.08],
            parent: piano
        });

        createPrimitive({
            name: "piano-leg-right",
            type: "box",
            material: materials.metal,
            position: [0.36, -0.02, -0.5],
            scale: [0.08, 0.54, 0.08],
            parent: piano
        });

        createPrimitive({
            name: "piano-pedal",
            type: "box",
            material: materials.metal,
            position: [0, 0.02, 0.72],
            scale: [0.18, 0.03, 0.06],
            parent: piano,
            castShadows: false
        });

        createPrimitive({
            name: "piano-stool",
            type: "box",
            material: materials.fabricTaupe,
            position: [-0.74, 0.18, 0.6],
            scale: [0.24, 0.08, 0.26],
            parent: piano
        });
    };

    buildPhotoWall = function (parent, materials) {
        var photoLayout = room.layout && room.layout.photo ? room.layout.photo : null;
        var anchor = createGroup("photo-wall", parent);
        if (photoLayout) {
            anchor.setPosition(photoLayout.position.x, photoLayout.position.y, photoLayout.position.z);
            anchor.setEulerAngles(photoLayout.rotation[0], photoLayout.rotation[1], photoLayout.rotation[2]);
        } else {
            anchor.setLocalPosition(-2.28, 1.76, 0.22);
            anchor.setLocalEulerAngles(0, 90, 0);
        }
        room.nodes.photoWall = anchor;

        createPrimitive({
            name: "photo-frame",
            type: "box",
            material: materials.woodDark,
            position: [0, 0, 0],
            scale: [1.86, 1.12, 0.08],
            parent: anchor
        });

        createPrimitive({
            name: "photo-paper",
            type: "box",
            material: materials.paper,
            position: [0, 0, 0.04],
            scale: [1.62, 0.88, 0.05],
            parent: anchor,
            castShadows: false
        });

        room.photoPieces.length = 0;
        for (var i = 0; i < 3; i += 1) {
            var texture = createSunflowerTexture(i, 3);
            var pieceMaterial = createPbrMaterial({
                diffuse: new pc.Color(1, 1, 1),
                diffuseMap: texture,
                emissive: rgb(255, 248, 230),
                emissiveIntensity: 0.08,
                gloss: 0.08,
                metalness: 0,
                opacity: 0.12
            });

            var piece = createPrimitive({
                name: "photo-piece-" + i,
                type: "box",
                material: pieceMaterial,
                position: [-0.54 + (i * 0.54), 0, 0.055],
                scale: [0.52, 0.68, 0.06],
                parent: anchor,
                castShadows: false,
                receiveShadows: false
            });

            room.photoPieces.push({
                entity: piece,
                material: pieceMaterial,
                reveal: 0
            });
        }
    };

    buildMirrorDoll = function (materials) {
        var dollRoot = createGroup("mirror-doll", app.root);
        var dollPoint = invertRoomPoint(vec3(1.9, 0.5, 0.42));
        dollRoot.setPosition(dollPoint.x, dollPoint.y, dollPoint.z);

        createPrimitive({
            name: "doll-body",
            type: "capsule",
            material: materials.ghostBody,
            position: [0, 0.16, 0],
            scale: [0.13, 0.28, 0.13],
            parent: dollRoot,
            castShadows: false,
            receiveShadows: false
        });

        createPrimitive({
            name: "doll-head",
            type: "sphere",
            material: materials.ghostBody,
            position: [0, 0.42, 0],
            scale: [0.16, 0.16, 0.16],
            parent: dollRoot,
            castShadows: false,
            receiveShadows: false
        });

        createPrimitive({
            name: "doll-ribbon",
            type: "box",
            material: materials.paper,
            position: [0, 0.52, 0.08],
            scale: [0.2, 0.02, 0.02],
            parent: dollRoot,
            castShadows: false,
            receiveShadows: false
        });

        dollRoot.enabled = false;

        game.anomalies.push({
            id: "mirror-doll",
            label: "镜畔纸偶",
            description: "像被月光剪下的一页空白，越靠近，越像在学着呼吸。",
            point: dollPoint,
            range: 4.6,
            threshold: 0.975,
            found: false,
            entity: dollRoot,
            message: "镜畔纸偶已经安静地合上眼睛。"
        });
    };

    buildGhostVase = function (materials) {
        var vaseRoot = createGroup("ghost-vase", app.root);
        var vasePoint = invertRoomPoint(vec3(2.28, 0.92, 0.36));
        vaseRoot.setPosition(vasePoint.x, vasePoint.y, vasePoint.z);

        createPrimitive({
            name: "vase-body",
            type: "cone",
            material: materials.ghostGlass,
            position: [0, 0.18, 0],
            scale: [0.16, 0.38, 0.16],
            rotation: [180, 0, 0],
            parent: vaseRoot,
            castShadows: false
        });

        createPrimitive({
            name: "vase-neck",
            type: "cylinder",
            material: materials.ghostGlass,
            position: [0, 0.48, 0],
            scale: [0.07, 0.16, 0.07],
            parent: vaseRoot,
            castShadows: false
        });

        createPrimitive({
            name: "vase-crown",
            type: "sphere",
            material: materials.ghostBody,
            position: [0, 0.66, 0],
            scale: [0.09, 0.09, 0.09],
            parent: vaseRoot,
            castShadows: false
        });

        vaseRoot.enabled = false;

        game.anomalies.push({
            id: "ghost-vase",
            label: "雾光花瓶",
            description: "明明盛着影子，却总像快要溢出一束很轻的晨光。",
            point: vasePoint,
            range: 4.8,
            threshold: 0.972,
            found: false,
            entity: vaseRoot,
            message: "雾光花瓶像一口气，轻轻散进了暗处。"
        });
    };

    buildUpsideChairAnomaly = function (materials) {
        var clone = makeGhostClone(room.nodes.chair, materials.ghostBody);

        game.anomalies.push({
            id: "upside-chair",
            label: "天花板倒椅",
            description: "椅脚朝向天空，像一段被房间误记的句子。",
            point: clone.getPosition().clone(),
            range: 5.2,
            threshold: 0.97,
            found: false,
            entity: clone,
            message: "天花板倒椅已经从静默里松开。"
        });
    };

    var createSunflowerPhotoTexture = function () {
        return createCanvasTexture(1024, 768, function (ctx, width, height) {
            var background = ctx.createLinearGradient(0, 0, 0, height);
            background.addColorStop(0, "#f3e4cb");
            background.addColorStop(0.52, "#ead7b7");
            background.addColorStop(1, "#ceb18c");
            ctx.fillStyle = background;
            ctx.fillRect(0, 0, width, height);

            var vignette = ctx.createRadialGradient(width * 0.52, height * 0.44, 40, width * 0.52, height * 0.44, width * 0.62);
            vignette.addColorStop(0, "rgba(255,251,240,0.14)");
            vignette.addColorStop(1, "rgba(92,52,28,0.16)");
            ctx.fillStyle = vignette;
            ctx.fillRect(0, 0, width, height);

            ctx.save();
            ctx.filter = "blur(20px)";
            ctx.fillStyle = "rgba(255,251,235,0.38)";
            ctx.fillRect(width * 0.08, height * 0.08, width * 0.26, height * 0.76);
            ctx.fillStyle = "rgba(255,245,214,0.24)";
            ctx.fillRect(width * 0.54, height * 0.16, width * 0.12, height * 0.56);
            ctx.restore();

            ctx.fillStyle = "rgba(255,255,255,0.16)";
            for (var beam = 0; beam < 7; beam += 1) {
                var beamX = width * 0.16 + (beam * width * 0.094);
                ctx.fillRect(beamX, 0, width * 0.022, height);
            }

            var stemGradient = ctx.createLinearGradient(width * 0.48, height * 0.55, width * 0.56, height);
            stemGradient.addColorStop(0, "#7d8f52");
            stemGradient.addColorStop(1, "#52663d");
            ctx.strokeStyle = stemGradient;
            ctx.lineCap = "round";
            ctx.lineWidth = 18;
            ctx.beginPath();
            ctx.moveTo(width * 0.51, height * 0.96);
            ctx.quadraticCurveTo(width * 0.49, height * 0.73, width * 0.55, height * 0.54);
            ctx.stroke();

            var drawLeaf = function (x, y, scaleX, scaleY, rotation) {
                ctx.save();
                ctx.translate(x, y);
                ctx.rotate(rotation);
                var leafGradient = ctx.createLinearGradient(-scaleX, 0, scaleX, 0);
                leafGradient.addColorStop(0, "#70885a");
                leafGradient.addColorStop(1, "#9cb57d");
                ctx.fillStyle = leafGradient;
                ctx.beginPath();
                ctx.moveTo(-scaleX, 0);
                ctx.quadraticCurveTo(-scaleX * 0.24, -scaleY, scaleX, 0);
                ctx.quadraticCurveTo(-scaleX * 0.18, scaleY * 0.72, -scaleX, 0);
                ctx.closePath();
                ctx.fill();
                ctx.restore();
            };

            drawLeaf(width * 0.42, height * 0.69, 84, 52, -0.78);
            drawLeaf(width * 0.64, height * 0.74, 102, 56, 0.58);

            var centerX = width * 0.53;
            var centerY = height * 0.39;
            var outerPetals = 28;
            ctx.save();
            ctx.shadowColor = "rgba(94,56,22,0.22)";
            ctx.shadowBlur = 8;
            for (var petal = 0; petal < outerPetals; petal += 1) {
                var angle = (Math.PI * 2 * petal) / outerPetals;
                ctx.save();
                ctx.translate(centerX, centerY);
                ctx.rotate(angle);
                var petalGradient = ctx.createLinearGradient(0, -112, 0, -12);
                petalGradient.addColorStop(0, petal % 2 === 0 ? "#f7cf60" : "#efbb47");
                petalGradient.addColorStop(1, "#d79834");
                ctx.fillStyle = petalGradient;
                ctx.beginPath();
                ctx.moveTo(0, -18);
                ctx.bezierCurveTo(46, -82, 40, -148, 0, -186);
                ctx.bezierCurveTo(-40, -148, -46, -82, 0, -18);
                ctx.closePath();
                ctx.fill();
                ctx.restore();
            }
            ctx.restore();

            for (var innerPetal = 0; innerPetal < 14; innerPetal += 1) {
                var innerAngle = (Math.PI * 2 * innerPetal) / 14 + 0.12;
                ctx.save();
                ctx.translate(centerX, centerY);
                ctx.rotate(innerAngle);
                ctx.fillStyle = innerPetal % 2 === 0 ? "#e5a83b" : "#cf8e2f";
                ctx.beginPath();
                ctx.moveTo(0, -10);
                ctx.bezierCurveTo(22, -40, 22, -78, 0, -98);
                ctx.bezierCurveTo(-22, -78, -22, -40, 0, -10);
                ctx.closePath();
                ctx.fill();
                ctx.restore();
            }

            var coreGradient = ctx.createRadialGradient(centerX - 14, centerY - 16, 12, centerX, centerY, 108);
            coreGradient.addColorStop(0, "#5f2f12");
            coreGradient.addColorStop(0.54, "#7d471d");
            coreGradient.addColorStop(1, "#2e180c");
            ctx.fillStyle = coreGradient;
            ctx.beginPath();
            ctx.arc(centerX, centerY, 102, 0, Math.PI * 2);
            ctx.fill();

            for (var seed = 0; seed < 240; seed += 1) {
                var seedAngle = (Math.PI * 2 * seed) / 240;
                var seedRadius = 20 + ((seed * 17) % 74);
                var sx = centerX + Math.cos(seedAngle * 1.7) * seedRadius;
                var sy = centerY + Math.sin(seedAngle * 1.3) * seedRadius * 0.88;
                ctx.fillStyle = seed % 5 === 0 ? "rgba(243,199,95,0.34)" : "rgba(47,24,11,0.62)";
                ctx.fillRect(sx, sy, 3, 3);
            }

            ctx.fillStyle = "rgba(255,252,240,0.16)";
            ctx.fillRect(0, 0, width, 32);
            ctx.fillRect(0, height - 24, width, 24);
            ctx.fillRect(0, 0, 28, height);
            ctx.fillRect(width - 28, 0, 28, height);

            ctx.strokeStyle = "rgba(126,82,49,0.28)";
            ctx.lineWidth = 3;
            ctx.strokeRect(18, 18, width - 36, height - 36);

            for (var grain = 0; grain < 1200; grain += 1) {
                var grainX = (grain * 37) % width;
                var grainY = (grain * 71) % height;
                ctx.fillStyle = grain % 4 === 0 ? "rgba(255,255,255,0.05)" : "rgba(92,66,40,0.05)";
                ctx.fillRect(grainX, grainY, 1, 1);
            }

            ctx.strokeStyle = "rgba(122,93,66,0.14)";
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(width * 0.23, 0);
            ctx.lineTo(width * 0.27, height);
            ctx.moveTo(width * 0.71, 0);
            ctx.lineTo(width * 0.68, height);
            ctx.stroke();
        });
    };

    var createPhotoCoverTexture = function (lightTone, darkTone) {
        return createCanvasTexture(512, 512, function (ctx, width, height) {
            var coverGradient = ctx.createLinearGradient(0, 0, width, height);
            coverGradient.addColorStop(0, lightTone);
            coverGradient.addColorStop(1, darkTone);
            ctx.fillStyle = coverGradient;
            ctx.fillRect(0, 0, width, height);

            ctx.fillStyle = "rgba(255,255,255,0.12)";
            ctx.fillRect(width * 0.08, 0, width * 0.12, height);
            ctx.fillRect(width * 0.56, 0, width * 0.06, height);

            ctx.strokeStyle = "rgba(112,92,74,0.18)";
            ctx.lineWidth = 3;
            ctx.strokeRect(12, 12, width - 24, height - 24);

            for (var dot = 0; dot < 420; dot += 1) {
                var px = (dot * 29) % width;
                var py = (dot * 47) % height;
                ctx.fillStyle = dot % 3 === 0 ? "rgba(255,255,255,0.06)" : "rgba(90,72,58,0.08)";
                ctx.fillRect(px, py, 2, 2);
            }

            ctx.strokeStyle = "rgba(138,113,92,0.14)";
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(width * 0.18, 0);
            ctx.lineTo(width * 0.32, height);
            ctx.moveTo(width * 0.78, 0);
            ctx.lineTo(width * 0.7, height);
            ctx.stroke();
        });
    };

    buildDeskAndChair = function (parent, materials) {
        var desk = createGroup("desk", parent);
        desk.setLocalPosition(0.68, 0, -2.54);
        room.nodes.desk = desk;

        createPrimitive({
            name: "desk-top",
            type: "box",
            material: materials.woodDark,
            position: [0, 0.8, 0],
            scale: [1.84, 0.12, 0.82],
            parent: desk
        });

        createPrimitive({
            name: "desk-apron-front",
            type: "box",
            material: materials.woodDark,
            position: [0, 0.7, 0.34],
            scale: [1.62, 0.08, 0.08],
            parent: desk
        });

        createPrimitive({
            name: "desk-apron-back",
            type: "box",
            material: materials.woodDark,
            position: [0, 0.7, -0.34],
            scale: [1.62, 0.08, 0.08],
            parent: desk
        });

        createPrimitive({
            name: "desk-pedestal-left",
            type: "box",
            material: materials.woodLight,
            position: [-0.58, 0.43, 0.06],
            scale: [0.46, 0.62, 0.48],
            parent: desk
        });

        createPrimitive({
            name: "desk-drawer-top",
            type: "box",
            material: materials.paper,
            position: [-0.58, 0.62, 0.31],
            scale: [0.36, 0.07, 0.03],
            parent: desk,
            castShadows: false
        });

        createPrimitive({
            name: "desk-drawer-mid",
            type: "box",
            material: materials.paper,
            position: [-0.58, 0.44, 0.31],
            scale: [0.36, 0.07, 0.03],
            parent: desk,
            castShadows: false
        });

        createPrimitive({
            name: "desk-drawer-low",
            type: "box",
            material: materials.paper,
            position: [-0.58, 0.26, 0.31],
            scale: [0.36, 0.07, 0.03],
            parent: desk,
            castShadows: false
        });

        createPrimitive({
            name: "desk-leg-a",
            type: "box",
            material: materials.metal,
            position: [0.72, 0.38, -0.3],
            scale: [0.08, 0.76, 0.08],
            parent: desk
        });

        createPrimitive({
            name: "desk-leg-b",
            type: "box",
            material: materials.metal,
            position: [0.72, 0.38, 0.3],
            scale: [0.08, 0.76, 0.08],
            parent: desk
        });

        createPrimitive({
            name: "desk-monitor-body",
            type: "box",
            material: materials.screen,
            position: [0.42, 1.06, -0.1],
            scale: [0.58, 0.36, 0.12],
            parent: desk,
            castShadows: false
        });

        createPrimitive({
            name: "desk-monitor-stand",
            type: "box",
            material: materials.metal,
            position: [0.42, 0.88, -0.1],
            scale: [0.08, 0.16, 0.08],
            parent: desk
        });

        createPrimitive({
            name: "desk-monitor-base",
            type: "box",
            material: materials.metal,
            position: [0.42, 0.81, -0.1],
            scale: [0.24, 0.02, 0.16],
            parent: desk
        });

        createPrimitive({
            name: "desk-book-stack-bottom",
            type: "box",
            material: materials.book,
            position: [-0.06, 0.86, 0.1],
            scale: [0.34, 0.06, 0.24],
            parent: desk
        });

        createPrimitive({
            name: "desk-book-stack-top",
            type: "box",
            material: materials.paper,
            position: [-0.02, 0.92, 0.08],
            scale: [0.28, 0.04, 0.2],
            rotation: [0, 9, 0],
            parent: desk,
            castShadows: false
        });

        createPrimitive({
            name: "desk-notebook",
            type: "box",
            material: materials.woodLight,
            position: [0.22, 0.85, 0.2],
            scale: [0.28, 0.05, 0.22],
            rotation: [0, -12, 0],
            parent: desk
        });

        createPrimitive({
            name: "desk-lamp-base",
            type: "cylinder",
            material: materials.metal,
            position: [0.76, 0.84, 0.22],
            scale: [0.1, 0.03, 0.1],
            parent: desk
        });

        createPrimitive({
            name: "desk-lamp-stem",
            type: "box",
            material: materials.metal,
            position: [0.76, 1.02, 0.2],
            scale: [0.04, 0.26, 0.04],
            rotation: [0, 0, 18],
            parent: desk
        });

        createPrimitive({
            name: "desk-lamp-shade",
            type: "cone",
            material: materials.lampShade,
            position: [0.68, 1.22, 0.16],
            scale: [0.14, 0.22, 0.14],
            rotation: [180, 0, 28],
            parent: desk,
            castShadows: false
        });

        var chair = createGroup("chair", parent);
        chair.setLocalPosition(0.58, 0, -1.48);
        room.nodes.chair = chair;

        createPrimitive({
            name: "chair-seat",
            type: "box",
            material: materials.fabricTaupe,
            position: [0, 0.5, 0],
            scale: [0.62, 0.1, 0.58],
            parent: chair
        });

        createPrimitive({
            name: "chair-back",
            type: "box",
            material: materials.fabricTaupe,
            position: [0, 0.94, -0.22],
            scale: [0.6, 0.68, 0.12],
            parent: chair
        });

        createPrimitive({
            name: "chair-back-bar",
            type: "box",
            material: materials.woodDark,
            position: [0, 0.8, -0.18],
            scale: [0.46, 0.08, 0.08],
            parent: chair
        });

        createPrimitive({
            name: "chair-leg-a",
            type: "box",
            material: materials.woodDark,
            position: [-0.23, 0.23, -0.22],
            scale: [0.06, 0.46, 0.06],
            parent: chair
        });

        createPrimitive({
            name: "chair-leg-b",
            type: "box",
            material: materials.woodDark,
            position: [0.23, 0.23, -0.22],
            scale: [0.06, 0.46, 0.06],
            parent: chair
        });

        createPrimitive({
            name: "chair-leg-c",
            type: "box",
            material: materials.woodDark,
            position: [-0.23, 0.23, 0.22],
            scale: [0.06, 0.46, 0.06],
            parent: chair
        });

        createPrimitive({
            name: "chair-leg-d",
            type: "box",
            material: materials.woodDark,
            position: [0.23, 0.23, 0.22],
            scale: [0.06, 0.46, 0.06],
            parent: chair
        });
    };

    buildPlant = function (parent, materials) {
        var piano = createGroup("piano", parent);
        piano.setLocalPosition(2.46, 0, -2.6);
        room.nodes.plant = piano;
        room.nodes.piano = piano;

        createPrimitive({
            name: "piano-body",
            type: "box",
            material: materials.woodDark,
            position: [0, 0.76, 0],
            scale: [1.14, 1.34, 0.56],
            parent: piano
        });

        createPrimitive({
            name: "piano-top",
            type: "box",
            material: materials.woodLight,
            position: [0, 1.44, -0.02],
            scale: [1.18, 0.08, 0.6],
            parent: piano
        });

        createPrimitive({
            name: "piano-front-panel",
            type: "box",
            material: materials.woodLight,
            position: [0, 0.92, 0.24],
            scale: [0.94, 0.24, 0.08],
            parent: piano
        });

        createPrimitive({
            name: "piano-key-bed",
            type: "box",
            material: materials.paper,
            position: [0, 0.98, 0.31],
            scale: [0.8, 0.05, 0.12],
            parent: piano,
            castShadows: false
        });

        createPrimitive({
            name: "piano-black-keys",
            type: "box",
            material: materials.screen,
            position: [0, 1.02, 0.31],
            scale: [0.76, 0.025, 0.07],
            parent: piano,
            castShadows: false
        });

        createPrimitive({
            name: "piano-side-left",
            type: "box",
            material: materials.woodDark,
            position: [-0.47, 0.28, 0.1],
            scale: [0.08, 0.46, 0.32],
            parent: piano
        });

        createPrimitive({
            name: "piano-side-right",
            type: "box",
            material: materials.woodDark,
            position: [0.47, 0.28, 0.1],
            scale: [0.08, 0.46, 0.32],
            parent: piano
        });

        createPrimitive({
            name: "piano-pedal-board",
            type: "box",
            material: materials.woodDark,
            position: [0, 0.27, 0.24],
            scale: [0.24, 0.26, 0.08],
            parent: piano
        });

        createPrimitive({
            name: "piano-pedal-left",
            type: "box",
            material: materials.metal,
            position: [-0.08, 0.1, 0.29],
            scale: [0.03, 0.1, 0.02],
            parent: piano,
            castShadows: false
        });

        createPrimitive({
            name: "piano-pedal-mid",
            type: "box",
            material: materials.metal,
            position: [0, 0.1, 0.29],
            scale: [0.03, 0.1, 0.02],
            parent: piano,
            castShadows: false
        });

        createPrimitive({
            name: "piano-pedal-right",
            type: "box",
            material: materials.metal,
            position: [0.08, 0.1, 0.29],
            scale: [0.03, 0.1, 0.02],
            parent: piano,
            castShadows: false
        });

        var bench = createGroup("piano-bench", piano);
        bench.setLocalPosition(-0.82, 0, 0.34);

        createPrimitive({
            name: "bench-seat",
            type: "box",
            material: materials.fabricTaupe,
            position: [0, 0.28, 0],
            scale: [0.42, 0.08, 0.24],
            parent: bench
        });

        createPrimitive({
            name: "bench-leg-a",
            type: "box",
            material: materials.woodDark,
            position: [-0.14, 0.12, -0.08],
            scale: [0.05, 0.24, 0.05],
            parent: bench
        });

        createPrimitive({
            name: "bench-leg-b",
            type: "box",
            material: materials.woodDark,
            position: [0.14, 0.12, -0.08],
            scale: [0.05, 0.24, 0.05],
            parent: bench
        });

        createPrimitive({
            name: "bench-leg-c",
            type: "box",
            material: materials.woodDark,
            position: [-0.14, 0.12, 0.08],
            scale: [0.05, 0.24, 0.05],
            parent: bench
        });

        createPrimitive({
            name: "bench-leg-d",
            type: "box",
            material: materials.woodDark,
            position: [0.14, 0.12, 0.08],
            scale: [0.05, 0.24, 0.05],
            parent: bench
        });
    };

    buildPhotoWall = function (parent, materials) {
        var anchor = createGroup("photo-wall", parent);
        anchor.setLocalPosition(-2.28, 1.76, 0.22);
        anchor.setLocalEulerAngles(0, 90, 0);
        room.nodes.photoWall = anchor;

        createPrimitive({
            name: "photo-frame",
            type: "box",
            material: materials.woodDark,
            position: [0, 0, 0],
            scale: [1.94, 1.18, 0.1],
            parent: anchor
        });

        createPrimitive({
            name: "photo-mat",
            type: "box",
            material: materials.paper,
            position: [0, 0, 0.035],
            scale: [1.72, 0.96, 0.05],
            parent: anchor,
            castShadows: false
        });

        var photoMaterial = createPbrMaterial({
            diffuse: new pc.Color(1, 1, 1),
            diffuseMap: createSunflowerPhotoTexture(),
            emissive: rgb(255, 244, 220),
            emissiveIntensity: 0.02,
            gloss: 0.08,
            metalness: 0,
            cull: pc.CULLFACE_NONE
        });

        createPrimitive({
            name: "photo-art",
            type: "box",
            material: photoMaterial,
            position: [0, 0, 0.055],
            scale: [1.56, 0.84, 0.02],
            parent: anchor,
            castShadows: false,
            receiveShadows: false
        });

        room.photoArtworkMaterial = photoMaterial;
        room.photoPieces.length = 0;

        var coverConfigs = [
            {
                name: "photo-cover-left",
                position: [-0.42, 0.02, 0.072],
                scale: [0.68, 0.8, 0.024],
                rotation: [0, 0, -4],
                tones: ["#ece2d2", "#d9c7b1"]
            },
            {
                name: "photo-cover-mid",
                position: [0.06, -0.16, 0.074],
                scale: [0.8, 0.38, 0.024],
                rotation: [0, 0, 2],
                tones: ["#efe6d6", "#d7c4aa"]
            },
            {
                name: "photo-cover-right",
                position: [0.48, 0.06, 0.076],
                scale: [0.56, 0.76, 0.024],
                rotation: [0, 0, 5],
                tones: ["#e8dbc7", "#cfbaa0"]
            }
        ];

        for (var coverIndex = 0; coverIndex < coverConfigs.length; coverIndex += 1) {
            var cover = coverConfigs[coverIndex];
            var coverMaterial = createPbrMaterial({
                diffuse: new pc.Color(1, 1, 1),
                diffuseMap: createPhotoCoverTexture(cover.tones[0], cover.tones[1]),
                emissive: rgb(255, 247, 236),
                emissiveIntensity: 0.02,
                gloss: 0.04,
                metalness: 0,
                opacity: 0.96,
                cull: pc.CULLFACE_NONE
            });

            var piece = createPrimitive({
                name: cover.name,
                type: "box",
                material: coverMaterial,
                position: cover.position,
                scale: cover.scale,
                rotation: cover.rotation,
                parent: anchor,
                castShadows: false,
                receiveShadows: false
            });

            room.photoPieces.push({
                entity: piece,
                material: coverMaterial,
                reveal: 0
            });
        }
    };

    buildMirrorDoll = function (materials) {
        var dollRoot = createGroup("mirror-doll", app.root);
        var dollPoint = room.layout && room.layout.anomalies ? room.layout.anomalies.doll.clone() : invertRoomPoint(vec3(-1.38, 0.22, -0.56));
        dollRoot.setPosition(dollPoint.x, dollPoint.y, dollPoint.z);

        createPrimitive({
            name: "doll-thread",
            type: "cylinder",
            material: materials.ghostGlass,
            position: [0, 0.16, 0],
            scale: [0.014, 0.24, 0.014],
            parent: dollRoot,
            castShadows: false
        });

        createPrimitive({
            name: "doll-head",
            type: "sphere",
            material: materials.ghostBody,
            position: [0, -0.14, 0],
            scale: [0.18, 0.18, 0.18],
            parent: dollRoot,
            castShadows: false,
            receiveShadows: false
        });

        createPrimitive({
            name: "doll-torso",
            type: "capsule",
            material: materials.ghostBody,
            position: [0, -0.36, 0],
            scale: [0.14, 0.26, 0.14],
            parent: dollRoot,
            castShadows: false,
            receiveShadows: false
        });

        createPrimitive({
            name: "doll-skirt",
            type: "cone",
            material: materials.ghostGlass,
            position: [0, -0.58, 0],
            scale: [0.2, 0.22, 0.2],
            parent: dollRoot,
            castShadows: false,
            receiveShadows: false
        });

        createPrimitive({
            name: "doll-ribbon",
            type: "box",
            material: materials.paper,
            position: [0, -0.12, 0.08],
            scale: [0.18, 0.02, 0.02],
            parent: dollRoot,
            castShadows: false,
            receiveShadows: false
        });

        dollRoot.enabled = false;

        game.anomalies.push({
            id: "mirror-doll",
            label: "月褶纸偶",
            description: "它像从镜子背面掉下来的一小截月光，靠近时连安静都像在呼吸。",
            point: dollPoint.clone().add(new pc.Vec3(0, -0.34, 0)),
            range: 5.2,
            threshold: 0.962,
            found: false,
            entity: dollRoot,
            message: "月褶纸偶轻轻合上了影子的褶皱。"
        });
    };

    buildGhostVase = function (materials) {
        var vaseRoot = createGroup("ghost-vase", app.root);
        var vasePoint = room.layout && room.layout.anomalies ? room.layout.anomalies.vase.clone() : invertRoomPoint(vec3(1.56, 0.2, 0.96));
        vaseRoot.setPosition(vasePoint.x, vasePoint.y, vasePoint.z);

        createPrimitive({
            name: "vase-ring",
            type: "cylinder",
            material: materials.ghostGlass,
            position: [0, 0.1, 0],
            scale: [0.08, 0.02, 0.08],
            parent: vaseRoot,
            castShadows: false
        });

        createPrimitive({
            name: "vase-neck",
            type: "cylinder",
            material: materials.ghostGlass,
            position: [0, -0.12, 0],
            scale: [0.08, 0.16, 0.08],
            parent: vaseRoot,
            castShadows: false
        });

        createPrimitive({
            name: "vase-body",
            type: "sphere",
            material: materials.ghostGlass,
            position: [0, -0.38, 0],
            scale: [0.24, 0.3, 0.24],
            parent: vaseRoot,
            castShadows: false
        });

        createPrimitive({
            name: "vase-core",
            type: "sphere",
            material: materials.ghostBody,
            position: [0, -0.36, 0],
            scale: [0.1, 0.1, 0.1],
            parent: vaseRoot,
            castShadows: false
        });

        createPrimitive({
            name: "vase-drop",
            type: "cone",
            material: materials.ghostBody,
            position: [0, -0.62, 0],
            scale: [0.08, 0.18, 0.08],
            rotation: [180, 0, 0],
            parent: vaseRoot,
            castShadows: false
        });

        vaseRoot.enabled = false;

        game.anomalies.push({
            id: "ghost-vase",
            label: "雾冠玻璃瓶",
            description: "瓶口没有花，却盛着一团发亮的夜色，像谁把黄昏忘在了天花板上。",
            point: vasePoint.clone().add(new pc.Vec3(0, -0.36, 0)),
            range: 5.3,
            threshold: 0.96,
            found: false,
            entity: vaseRoot,
            message: "雾冠玻璃瓶里的冷光，终于慢慢沉了下去。"
        });
    };

    buildUpsideChairAnomaly = function (materials) {
        var chairRoot = createGroup("upside-chair", app.root);
        var chairPoint = room.layout && room.layout.anomalies ? room.layout.anomalies.chair.clone() : invertRoomPoint(vec3(0.18, 0.22, -0.18));
        chairRoot.setPosition(chairPoint.x, chairPoint.y, chairPoint.z);

        createPrimitive({
            name: "anomaly-chair-strap-left",
            type: "box",
            material: materials.ghostGlass,
            position: [-0.18, 0.14, 0],
            scale: [0.03, 0.22, 0.03],
            parent: chairRoot,
            castShadows: false
        });

        createPrimitive({
            name: "anomaly-chair-strap-right",
            type: "box",
            material: materials.ghostGlass,
            position: [0.18, 0.14, 0],
            scale: [0.03, 0.22, 0.03],
            parent: chairRoot,
            castShadows: false
        });

        createPrimitive({
            name: "anomaly-chair-seat",
            type: "box",
            material: materials.ghostBody,
            position: [0, -0.14, 0],
            scale: [0.64, 0.08, 0.58],
            parent: chairRoot,
            castShadows: false,
            receiveShadows: false
        });

        createPrimitive({
            name: "anomaly-chair-back",
            type: "box",
            material: materials.ghostBody,
            position: [0, -0.52, -0.2],
            scale: [0.58, 0.58, 0.1],
            parent: chairRoot,
            castShadows: false,
            receiveShadows: false
        });

        createPrimitive({
            name: "anomaly-chair-leg-a",
            type: "box",
            material: materials.ghostGlass,
            position: [-0.22, -0.4, -0.2],
            scale: [0.05, 0.44, 0.05],
            parent: chairRoot,
            castShadows: false
        });

        createPrimitive({
            name: "anomaly-chair-leg-b",
            type: "box",
            material: materials.ghostGlass,
            position: [0.22, -0.4, -0.2],
            scale: [0.05, 0.44, 0.05],
            parent: chairRoot,
            castShadows: false
        });

        createPrimitive({
            name: "anomaly-chair-leg-c",
            type: "box",
            material: materials.ghostGlass,
            position: [-0.22, -0.4, 0.2],
            scale: [0.05, 0.44, 0.05],
            parent: chairRoot,
            castShadows: false
        });

        createPrimitive({
            name: "anomaly-chair-leg-d",
            type: "box",
            material: materials.ghostGlass,
            position: [0.22, -0.4, 0.2],
            scale: [0.05, 0.44, 0.05],
            parent: chairRoot,
            castShadows: false
        });

        chairRoot.enabled = false;

        game.anomalies.push({
            id: "upside-chair",
            label: "逆眠木椅",
            description: "它倒扣在天花板的呼吸里，像一句家常话被黑暗悄悄改了结尾。",
            point: chairPoint.clone().add(new pc.Vec3(0, -0.34, 0)),
            range: 5.6,
            threshold: 0.05,
            found: false,
            entity: chairRoot,
            message: "逆眠木椅像被纠正的梦，慢慢贴回了夜色里。"
        });
    };

    buildManualRoom();
    refreshUi();

    var doesCircleHitBox = function (x, z, radius, box) {
        var nearestX = clamp(x, box.minX, box.maxX);
        var nearestZ = clamp(z, box.minZ, box.maxZ);
        var dx = x - nearestX;
        var dz = z - nearestZ;
        return (dx * dx) + (dz * dz) < (radius * radius);
    };

    var moveWithCollision = function (position, dx, dz) {
        var nextX = position.x + dx;
        var nextZ = position.z + dz;
        var minX = room.bounds.minX + player.radius;
        var maxX = room.bounds.maxX - player.radius;
        var minZ = room.bounds.minZ + player.radius;
        var maxZ = room.bounds.maxZ - player.radius;

        nextX = clamp(nextX, minX, maxX);
        nextZ = clamp(nextZ, minZ, maxZ);

        for (var i = 0; i < room.obstacles.length; i += 1) {
            var box = room.obstacles[i];
            if (doesCircleHitBox(nextX, position.z, player.radius, box)) {
                nextX = dx > 0 ? box.minX - player.radius : box.maxX + player.radius;
            }
        }

        nextX = clamp(nextX, minX, maxX);

        for (var j = 0; j < room.obstacles.length; j += 1) {
            var boxZ = room.obstacles[j];
            if (doesCircleHitBox(nextX, nextZ, player.radius, boxZ)) {
                nextZ = dz > 0 ? boxZ.minZ - player.radius : boxZ.maxZ + player.radius;
            }
        }

        nextZ = clamp(nextZ, minZ, maxZ);

        return {
            x: nextX,
            z: nextZ
        };
    };

    var syncMirrorCamera = function () {
        if (!room.mirror) {
            return;
        }

        if (!room.mirrorCamera) {
            return;
        }

        var cameraPosition = camera.getPosition();
        var cameraForward = camera.forward.clone().normalize();
        var reflectedPosition = reflectPoint(cameraPosition, room.mirror.point, room.mirror.normal);
        var reflectedTarget = reflectPoint(cameraPosition.clone().add(cameraForward), room.mirror.point, room.mirror.normal);

        room.mirrorCamera.setPosition(reflectedPosition);
        room.mirrorCamera.lookAt(reflectedTarget, pc.Vec3.UP);
    };

    var updateModeLook = function (t, time) {
        lerpColor(app.scene.ambientLight, dayAmbient, nightAmbient, t);
        app.scene.exposure = lerp(0.95, 0.58, t);

        sunLight.light.intensity = lerp(1, 0.12, t);
        lerpColor(sunLight.light.color, rgb(255, 236, 214), rgb(118, 144, 186), t);

        coolFillLight.light.intensity = lerp(0.08, 0.18, t);
        lampLight.light.intensity = lerp(0.12, 0.3, t);

        for (var i = 0; i < room.sceneMaterials.length; i += 1) {
            var material = room.sceneMaterials[i];
            var base = material._roomBaseDiffuse || material.diffuse;
            material.diffuse.set(
                lerp(base.r, base.r * 0.68, t),
                lerp(base.g, base.g * 0.72, t),
                lerp(base.b, base.b * 0.82, t)
            );
            material.emissive.set(
                lerp(0, 0.01, t),
                lerp(0, 0.012, t),
                lerp(0, 0.02, t)
            );
            material.update();
        }

        if (room.windowGlow) {
            var windowInstance = room.windowGlow.render && room.windowGlow.render.meshInstances ? room.windowGlow.render.meshInstances[0] : null;
            if (windowInstance && windowInstance.material) {
                windowInstance.material.opacity = lerp(0.24, 0.08, t);
                windowInstance.material.emissiveIntensity = lerp(0.34, 0.08, t);
                windowInstance.material.update();
            }
        }

        if (room.mirrorAura) {
            room.mirrorAura.enabled = true;
            var pulse = 1 + (Math.sin(time * 2.1) * 0.03 * t);
            room.mirrorAura.setLocalScale(1.18 * pulse, 1.96 * pulse, 1);
            var auraInstance = room.mirrorAura.render && room.mirrorAura.render.meshInstances ? room.mirrorAura.render.meshInstances[0] : null;
            if (auraInstance && auraInstance.material) {
                auraInstance.material.opacity = lerp(0.04, 0.16, t);
                auraInstance.material.update();
            }
        }

        for (var j = 0; j < room.photoPieces.length; j += 1) {
            var piece = room.photoPieces[j];
            piece.material.opacity = lerp(0.12, 0.98, piece.reveal);
            piece.material.emissiveIntensity = lerp(0.02, 0.14 + (t * 0.08), piece.reveal);
            piece.material.update();
        }

        for (var k = 0; k < game.anomalies.length; k += 1) {
            var anomaly = game.anomalies[k];
            if (!anomaly.found) {
                anomaly.entity.enabled = t > 0.66;
            }
        }
    };

    var segmentIntersectsObstacle = function (start, end, box) {
        var dx = end.x - start.x;
        var dz = end.z - start.z;
        var tMin = 0;
        var tMax = 1;
        var axes = [
            { origin: start.x, direction: dx, min: box.minX, max: box.maxX },
            { origin: start.z, direction: dz, min: box.minZ, max: box.maxZ }
        ];

        for (var axisIndex = 0; axisIndex < axes.length; axisIndex += 1) {
            var axis = axes[axisIndex];
            if (Math.abs(axis.direction) < 0.000001) {
                if (axis.origin < axis.min || axis.origin > axis.max) {
                    return false;
                }
                continue;
            }

            var axisStart = (axis.min - axis.origin) / axis.direction;
            var axisEnd = (axis.max - axis.origin) / axis.direction;
            if (axisStart > axisEnd) {
                var swapped = axisStart;
                axisStart = axisEnd;
                axisEnd = swapped;
            }
            tMin = Math.max(tMin, axisStart);
            tMax = Math.min(tMax, axisEnd);
            if (tMin > tMax) {
                return false;
            }
        }

        return tMax >= 0 && tMin <= 1;
    };

    var rayIntersectsBounds = function (origin, direction, bounds) {
        var tMin = 0;
        var tMax = Infinity;
        var axes = [
            { origin: origin.x, direction: direction.x, min: bounds.minX, max: bounds.maxX },
            { origin: origin.y, direction: direction.y, min: bounds.minY, max: bounds.maxY },
            { origin: origin.z, direction: direction.z, min: bounds.minZ, max: bounds.maxZ }
        ];

        for (var axisIndex = 0; axisIndex < axes.length; axisIndex += 1) {
            var axis = axes[axisIndex];
            if (Math.abs(axis.direction) < 0.000001) {
                if (axis.origin < axis.min || axis.origin > axis.max) {
                    return null;
                }
                continue;
            }

            var near = (axis.min - axis.origin) / axis.direction;
            var far = (axis.max - axis.origin) / axis.direction;
            if (near > far) {
                var swapped = near;
                near = far;
                far = swapped;
            }

            tMin = Math.max(tMin, near);
            tMax = Math.min(tMax, far);
            if (tMin > tMax) {
                return null;
            }
        }

        return tMax >= 0 ? tMin : null;
    };

    var getAnomalyRayHitDistance = function (cameraPosition, forward, anomaly) {
        var bounds = getEntityWorldBounds(anomaly.entity);
        if (!bounds) {
            return null;
        }

        var hitDistance = rayIntersectsBounds(cameraPosition, forward, bounds);
        if (hitDistance === null || hitDistance > anomaly.range) {
            return null;
        }

        // Check visibility to the surface the reticle actually enters, rather than
        // the object's center, which can sit behind a nearby door frame or wall.
        var targetPoint = cameraPosition.clone().add(
            forward.clone().mulScalar(hitDistance + 0.04)
        );
        var rayStart = cameraPosition.clone().add(forward.clone().mulScalar(0.08));

        if (isUpsideColliderBodyReady() &&
            app.systems.rigidbody &&
            typeof app.systems.rigidbody.raycastFirst === "function") {
            if (app.systems.rigidbody.raycastFirst(rayStart, targetPoint)) {
                return null;
            }
        } else {
            for (var obstacleIndex = 0; obstacleIndex < room.obstacles.length; obstacleIndex += 1) {
                if (segmentIntersectsObstacle(rayStart, targetPoint, room.obstacles[obstacleIndex])) {
                    return null;
                }
            }
        }

        return hitDistance;
    };

    var updateAnomalyPrompt = function () {
        game.currentTarget = null;

        if (mode.current <= 0.66 || !room.loaded) {
            setPrompt("", false);
            return;
        }

        var cameraPosition = camera.getPosition();
        var forward = camera.forward.clone().normalize();
        var bestScore = -999;

        for (var i = 0; i < game.anomalies.length; i += 1) {
            var anomaly = game.anomalies[i];
            if (anomaly.found || !anomaly.entity.enabled) {
                continue;
            }

            var hitDistance = getAnomalyRayHitDistance(cameraPosition, forward, anomaly);
            if (hitDistance === null) {
                continue;
            }

            var score = 1 - (hitDistance * 0.02);
            if (score > bestScore) {
                bestScore = score;
                game.currentTarget = anomaly;
            }
        }

        if (game.currentTarget) {
            setPrompt("[E] 检查 " + game.currentTarget.label, true);
            if (app.keyboard.wasPressed(pc.KEY_E)) {
                collectAnomaly(game.currentTarget);
            }
        } else {
            setPrompt("", false);
        }
    };

    updateModeLook = function (t, time) {
        lerpColor(app.scene.ambientLight, dayAmbient, nightAmbient, t);
        app.scene.exposure = lerp(1.02, 0.76, t);

        sunLight.light.intensity = lerp(1.18, 0.18, t);
        lerpColor(sunLight.light.color, rgb(255, 236, 214), rgb(118, 144, 186), t);

        coolFillLight.light.intensity = lerp(0.12, 0.22, t);
        lampLight.light.intensity = lerp(0.14, 0.38, t);

        for (var i = 0; i < room.sceneMaterials.length; i += 1) {
            var material = room.sceneMaterials[i];
            var base = material._roomBaseDiffuse || material.diffuse;
            material.diffuse.set(
                lerp(base.r, base.r * 0.76, t),
                lerp(base.g, base.g * 0.8, t),
                lerp(base.b, base.b * 0.88, t)
            );
            material.emissive.set(
                lerp(0, 0.01, t),
                lerp(0, 0.012, t),
                lerp(0, 0.02, t)
            );
            material.update();
        }

        if (room.windowGlow) {
            var windowInstance = room.windowGlow.render && room.windowGlow.render.meshInstances ? room.windowGlow.render.meshInstances[0] : null;
            if (windowInstance && windowInstance.material) {
                windowInstance.material.opacity = lerp(0.3, 0.1, t);
                windowInstance.material.emissiveIntensity = lerp(0.42, 0.1, t);
                windowInstance.material.update();
            }
        }

        if (room.mirrorAura) {
            room.mirrorAura.enabled = true;
            var pulse = 1 + (Math.sin(time * 2.1) * 0.03 * t);
            room.mirrorAura.setLocalScale(1.18 * pulse, 1.96 * pulse, 1);
            var auraInstance = room.mirrorAura.render && room.mirrorAura.render.meshInstances ? room.mirrorAura.render.meshInstances[0] : null;
            if (auraInstance && auraInstance.material) {
                auraInstance.material.opacity = lerp(0.04, 0.18, t);
                auraInstance.material.update();
            }
        }

        if (room.photoArtworkMaterial) {
            room.photoArtworkMaterial.emissiveIntensity = lerp(0.01, 0.12 + (t * 0.04), game.foundCount / 3);
            room.photoArtworkMaterial.update();
        }

        for (var j = 0; j < room.photoPieces.length; j += 1) {
            var piece = room.photoPieces[j];
            var coverOpacity = lerp(0.96, 0.02, piece.reveal);
            piece.material.opacity = coverOpacity;
            piece.material.emissiveIntensity = lerp(0.03, 0.01 + (t * 0.01), piece.reveal);
            piece.material.update();
            piece.entity.enabled = coverOpacity > 0.03;
        }

        for (var k = 0; k < game.anomalies.length; k += 1) {
            var anomaly = game.anomalies[k];
            if (!anomaly.found) {
                anomaly.entity.enabled = t > 0.66;
            }
        }
    };

    updateAnomalyPrompt = function () {
        game.currentTarget = null;

        if (mode.current <= 0.66 || !room.loaded) {
            setPrompt("", false);
            return;
        }

        var cameraPosition = camera.getPosition();
        var forward = camera.forward.clone().normalize();
        var bestScore = -999;

        for (var i = 0; i < game.anomalies.length; i += 1) {
            var anomaly = game.anomalies[i];
            if (anomaly.found || !anomaly.entity.enabled) {
                continue;
            }

            var hitDistance = getAnomalyRayHitDistance(cameraPosition, forward, anomaly);
            if (hitDistance === null) {
                continue;
            }

            var score = 1 - (hitDistance * 0.02);
            if (score > bestScore) {
                bestScore = score;
                game.currentTarget = anomaly;
            }
        }

        if (game.currentTarget) {
            var promptText = "[E] " + game.currentTarget.label;
            if (game.currentTarget.description) {
                promptText += "\n" + game.currentTarget.description;
            }
            setPrompt(promptText, true);
            if (app.keyboard.wasPressed(pc.KEY_E)) {
                collectAnomaly(game.currentTarget);
            }
        } else {
            setPrompt("", false);
        }
    };

    var updateUpsideRoomLook = updateModeLook;
    var updateUpsideRoomPrompt = updateAnomalyPrompt;
    var baseCollectAnomaly = collectAnomaly;
    var baseMoveWithCollision = moveWithCollision;
    var baseSyncMirrorCamera = syncMirrorCamera;

    var formatStorageTime = function (seconds) {
        var remaining = Math.max(0, Math.ceil(seconds));
        var minutes = Math.floor(remaining / 60);
        var remainder = remaining % 60;
        return (minutes < 10 ? "0" : "") + minutes + ":" + (remainder < 10 ? "0" : "") + remainder;
    };

    var getStorageAssetUrl = function () {
        storage.assetUrl = storage.assetUrl || "./assets/replicacad/Baked_sc1_staging_01.playcanvas.glb";
        return storage.assetUrl;
    };

    var rememberStorageMaterial = function (material) {
        if (!material || material._storageTracked) {
            return;
        }
        material._storageTracked = true;
        material._storageBaseDiffuse = material.diffuse.clone();
        storage.materials.push(material);
    };

    var setNodePurifiedStyle = function (node, purified) {
        node.purified = purified;
        node.coreMaterial.emissive = purified ? rgb(255, 223, 143) : rgb(111, 191, 255);
        node.coreMaterial.emissiveIntensity = purified ? 0.24 : 0.44;
        node.coreMaterial.opacity = purified ? 0.94 : 0.86;
        node.coreMaterial.update();

        node.auraMaterial.emissive = purified ? rgb(255, 196, 115) : rgb(84, 154, 255);
        node.auraMaterial.emissiveIntensity = purified ? 0.18 : 0.28;
        node.auraMaterial.opacity = purified ? 0.08 : 0.12;
        node.auraMaterial.update();
    };

    var setNodeRevealState = function (node, revealed) {
        node.revealed = revealed;
        node.entity.enabled = revealed || node.purified;
    };

    var createPurificationNode = function (parent, config) {
        var root = createGroup(config.id, parent);
        root.setLocalPosition(config.position.x, config.position.y, config.position.z);

        var metalMaterial = createPbrMaterial({
            diffuse: rgb(92, 102, 116),
            gloss: 0.68,
            metalness: 0.94,
            reflectivity: 1
        });

        var coreMaterial = createPbrMaterial({
            diffuse: rgb(204, 220, 236),
            emissive: rgb(111, 191, 255),
            emissiveIntensity: 0.44,
            gloss: 0.72,
            metalness: 0.08,
            opacity: 0.86,
            cull: pc.CULLFACE_NONE
        });

        var auraMaterial = createPbrMaterial({
            diffuse: rgb(98, 132, 188),
            emissive: rgb(84, 154, 255),
            emissiveIntensity: 0.28,
            gloss: 0.08,
            metalness: 0,
            opacity: 0.12,
            useLighting: false,
            cull: pc.CULLFACE_NONE
        });

        createPrimitive({
            name: config.id + "-pedestal",
            type: "cylinder",
            material: metalMaterial,
            position: [0, 0.08, 0],
            scale: [0.1, 0.07, 0.1],
            parent: root
        });

        createPrimitive({
            name: config.id + "-stem",
            type: "cylinder",
            material: metalMaterial,
            position: [0, 0.2, 0],
            scale: [0.03, 0.16, 0.03],
            parent: root
        });

        createPrimitive({
            name: config.id + "-core",
            type: "sphere",
            material: coreMaterial,
            position: [0, 0.34, 0],
            scale: [0.18, 0.18, 0.18],
            parent: root,
            castShadows: false,
            receiveShadows: false
        });

        createPrimitive({
            name: config.id + "-crown",
            type: "torus",
            material: metalMaterial,
            position: [0, 0.34, 0],
            scale: [0.16, 0.022, 0.16],
            rotation: [90, 0, 0],
            parent: root,
            castShadows: false,
            receiveShadows: false
        });

        createPrimitive({
            name: config.id + "-aura",
            type: "sphere",
            material: auraMaterial,
            position: [0, 0.34, 0],
            scale: [0.42, 0.24, 0.42],
            parent: root,
            castShadows: false,
            receiveShadows: false
        });

        var node = {
            id: config.id,
            label: config.label,
            description: config.description,
            message: config.message,
            revealMessage: config.revealMessage,
            entity: root,
            point: config.position.clone().add(new pc.Vec3(0, 0.34, 0)),
            range: 3.9,
            beamRadius: 0.24,
            purified: false,
            revealed: false,
            pulseOffset: config.pulseOffset,
            coreMaterial: coreMaterial,
            auraMaterial: auraMaterial,
            metalMaterial: metalMaterial
        };

        setNodePurifiedStyle(node, false);
        setNodeRevealState(node, false);
        return node;
    };

    var createWhisperClue = function (parent, config) {
        var root = createGroup(config.id, parent);
        root.setLocalPosition(config.position.x, config.position.y, config.position.z);

        var pinMaterial = createPbrMaterial({
            diffuse: rgb(92, 98, 108),
            gloss: 0.66,
            metalness: 0.76,
            opacity: 0.88
        });

        var moteMaterial = createPbrMaterial({
            diffuse: rgb(154, 177, 214),
            emissive: rgb(124, 182, 255),
            emissiveIntensity: 0.08,
            gloss: 0.44,
            metalness: 0.02,
            opacity: 0.3,
            useLighting: false,
            cull: pc.CULLFACE_NONE
        });

        createPrimitive({
            name: config.id + "-pin",
            type: "cylinder",
            material: pinMaterial,
            position: [0, 0.06, 0],
            scale: [0.018, 0.07, 0.018],
            parent: root,
            castShadows: false,
            receiveShadows: false
        });

        createPrimitive({
            name: config.id + "-mote-a",
            type: "sphere",
            material: moteMaterial,
            position: [0.03, 0.12, 0],
            scale: [0.04, 0.04, 0.04],
            parent: root,
            castShadows: false,
            receiveShadows: false
        });

        createPrimitive({
            name: config.id + "-mote-b",
            type: "sphere",
            material: moteMaterial,
            position: [-0.024, 0.095, 0.018],
            scale: [0.026, 0.026, 0.026],
            parent: root,
            castShadows: false,
            receiveShadows: false
        });

        createPrimitive({
            name: config.id + "-ring",
            type: "torus",
            material: moteMaterial,
            position: [0, 0.1, 0],
            scale: [0.08, 0.012, 0.08],
            rotation: [90, 0, 0],
            parent: root,
            castShadows: false,
            receiveShadows: false
        });

        return {
            id: config.id,
            order: config.order,
            label: config.label,
            hint: config.hint,
            message: config.message,
            entity: root,
            point: config.position.clone().add(new pc.Vec3(0, 0.1, 0)),
            linkedNodeId: config.linkedNodeId,
            range: 4.6,
            beamRadius: 0.12,
            focus: 0,
            found: false,
            active: false,
            pulseOffset: config.pulseOffset,
            pinMaterial: pinMaterial,
            moteMaterial: moteMaterial
        };
    };

    var setClueState = function (clue, active) {
        clue.active = active;
        clue.entity.enabled = active && !clue.found;
        clue.focus = active ? clue.focus : 0;
    };

    var createPollutionZone = function (parent, config) {
        var root = createGroup(config.id, parent);
        root.setLocalPosition(config.position.x, config.position.y, config.position.z);

        var mistMaterial = createPbrMaterial({
            diffuse: rgb(70, 10, 16),
            emissive: rgb(255, 38, 48),
            emissiveIntensity: 0.42,
            gloss: 0.12,
            metalness: 0,
            opacity: 0.22,
            useLighting: false,
            cull: pc.CULLFACE_NONE
        });

        var ringMaterial = createPbrMaterial({
            diffuse: rgb(112, 18, 26),
            emissive: rgb(255, 72, 72),
            emissiveIntensity: 0.5,
            gloss: 0.08,
            metalness: 0,
            opacity: 0.28,
            useLighting: false,
            cull: pc.CULLFACE_NONE
        });

        var shell = createPrimitive({
            name: config.id + "-shell",
            type: "sphere",
            material: mistMaterial,
            position: [0, 0.2, 0],
            scale: [1, 0.46, 1],
            parent: root,
            castShadows: false,
            receiveShadows: false
        });

        var ring = createPrimitive({
            name: config.id + "-ring",
            type: "torus",
            material: ringMaterial,
            position: [0, 0.02, 0],
            scale: [1, 0.04, 1],
            rotation: [90, 0, 0],
            parent: root,
            castShadows: false,
            receiveShadows: false
        });

        return {
            id: config.id,
            entity: root,
            shell: shell,
            ring: ring,
            mistMaterial: mistMaterial,
            ringMaterial: ringMaterial,
            center: config.position.clone(),
            baseRadius: config.baseRadius,
            expand: config.expand,
            speed: config.speed,
            pulseOffset: config.pulseOffset,
            radius: config.baseRadius,
            active: true
        };
    };

    var createFinalKey = function (parent) {
        var root = createGroup("final-key", parent);
        var keyPosition = storage.spawn.clone().add(new pc.Vec3(0.04, 0.94, -0.08));
        root.setLocalPosition(keyPosition.x, keyPosition.y, keyPosition.z);

        var keyMaterial = createPbrMaterial({
            diffuse: rgb(232, 187, 92),
            emissive: rgb(255, 216, 126),
            emissiveIntensity: 0.32,
            gloss: 0.86,
            metalness: 1,
            reflectivity: 1
        });

        var auraMaterial = createPbrMaterial({
            diffuse: rgb(254, 210, 120),
            emissive: rgb(255, 216, 126),
            emissiveIntensity: 0.34,
            opacity: 0.16,
            useLighting: false,
            cull: pc.CULLFACE_NONE
        });

        createPrimitive({
            name: "key-ring",
            type: "torus",
            material: keyMaterial,
            position: [0, 0.16, 0],
            scale: [0.12, 0.02, 0.12],
            rotation: [90, 0, 0],
            parent: root,
            castShadows: false,
            receiveShadows: false
        });

        createPrimitive({
            name: "key-stem",
            type: "box",
            material: keyMaterial,
            position: [0.18, 0.16, 0],
            scale: [0.28, 0.04, 0.04],
            parent: root,
            castShadows: false,
            receiveShadows: false
        });

        createPrimitive({
            name: "key-tooth-a",
            type: "box",
            material: keyMaterial,
            position: [0.28, 0.1, 0],
            scale: [0.04, 0.12, 0.04],
            parent: root,
            castShadows: false,
            receiveShadows: false
        });

        createPrimitive({
            name: "key-tooth-b",
            type: "box",
            material: keyMaterial,
            position: [0.2, 0.08, 0],
            scale: [0.04, 0.08, 0.04],
            parent: root,
            castShadows: false,
            receiveShadows: false
        });

        createPrimitive({
            name: "key-aura",
            type: "sphere",
            material: auraMaterial,
            position: [0.12, 0.16, 0],
            scale: [0.5, 0.22, 0.5],
            parent: root,
            castShadows: false,
            receiveShadows: false
        });

        root.enabled = false;

        return {
            entity: root,
            point: keyPosition.clone().add(new pc.Vec3(0.12, 0.16, 0)),
            label: "日照钥匙",
            description: "它像终于被清晨承认的一小块金属，轻得像出口先开了一半。",
            range: 3.5,
            threshold: 0.952,
            collected: false,
            keyMaterial: keyMaterial,
            auraMaterial: auraMaterial
        };
    };

    var buildStorageGameplay = function () {
        storage.nodes.length = 0;
        storage.clues.length = 0;
        storage.pollutionZones.length = 0;
        storage.purifiedCount = 0;
        storage.activeClueIndex = 0;
        storage.keyCollected = false;
        storage.timer = storage.timerLimit;
        storage.targetBrightness = 0;
        storage.brightness = 0;
        storage.danger = 0;

        storage.nodes.push(createPurificationNode(storage.root, {
            id: "purify-node-a",
            position: vec3(-1.78, 0.3, 3.56),
            label: "光茧节点",
            description: "像一枚没有醒完的晨星，被手电照到才肯显出脉搏。",
            message: "第一枚净化节点亮了，墙角像轻轻吐出了一口气。",
            pulseOffset: 0.5
        }));

        storage.nodes.push(createPurificationNode(storage.root, {
            id: "purify-node-b",
            position: vec3(3.14, 0.34, 5.34),
            label: "回声节点",
            description: "光落上去时，它像在把旧噩梦一层层剥离下来。",
            message: "第二枚净化节点亮了，红色的喘息短了一瞬。",
            pulseOffset: 1.4
        }));

        storage.nodes.push(createPurificationNode(storage.root, {
            id: "purify-node-c",
            position: vec3(1.86, 0.34, -2.84),
            label: "余温节点",
            description: "它藏着最后一点不肯散去的黑，像睡迟了的黄昏。",
            message: "第三枚净化节点亮了，储藏室终于开始把光还给你。",
            pulseOffset: 2.3
        }));

        storage.clues.push(createWhisperClue(storage.root, {
            id: "storage-clue-a",
            order: 0,
            position: vec3(-1.18, 0.92, 2.42),
            label: "第一道光痕",
            hint: "先别急着找节点，顺着左侧木架和墙缝慢慢扫，光痕会在手电里回温。",
            message: "你把第一道光痕照醒了。它像一根很细的针，把光引向左侧木架的暗处。",
            linkedNodeId: "purify-node-a",
            pulseOffset: 0.3
        }));

        storage.clues.push(createWhisperClue(storage.root, {
            id: "storage-clue-b",
            order: 1,
            position: vec3(2.58, 1.08, 4.22),
            label: "第二道光痕",
            hint: "第二道光痕躲得更深。让手电沿着远处角落慢慢抹过去。",
            message: "第二道光痕被照出，它缩成一点冷亮，把你推向更深的角落。",
            linkedNodeId: "purify-node-b",
            pulseOffset: 1.2
        }));

        storage.clues.push(createWhisperClue(storage.root, {
            id: "storage-clue-c",
            order: 2,
            position: vec3(0.94, 1.02, -1.58),
            label: "第三道光痕",
            hint: "最后一道光痕贴着你来时的边缘，别只盯着屋子深处。",
            message: "最后一道光痕终于显影，它把末尾那枚灯芯交还给了门边。",
            linkedNodeId: "purify-node-c",
            pulseOffset: 2.1
        }));

        storage.pollutionZones.push(createPollutionZone(storage.root, {
            id: "pollution-a",
            position: vec3(0.44, 0.04, 2.18),
            baseRadius: 0.78,
            expand: 0.34,
            speed: 0.9,
            pulseOffset: 0.2
        }));

        storage.pollutionZones.push(createPollutionZone(storage.root, {
            id: "pollution-b",
            position: vec3(2.56, 0.04, 3.3),
            baseRadius: 0.72,
            expand: 0.3,
            speed: 1.12,
            pulseOffset: 1.1
        }));

        storage.pollutionZones.push(createPollutionZone(storage.root, {
            id: "pollution-c",
            position: vec3(-0.64, 0.04, -2.22),
            baseRadius: 0.68,
            expand: 0.28,
            speed: 1.28,
            pulseOffset: 2.2
        }));

        storage.finalKey = createFinalKey(storage.root);
    };

    var getStorageNodeById = function (id) {
        for (var nodeIndex = 0; nodeIndex < storage.nodes.length; nodeIndex += 1) {
            if (storage.nodes[nodeIndex].id === id) {
                return storage.nodes[nodeIndex];
            }
        }
        return null;
    };

    var boxesOverlap2D = function (a, b) {
        return a.minX <= b.maxX &&
            a.maxX >= b.minX &&
            a.minZ <= b.maxZ &&
            a.maxZ >= b.minZ;
    };

    var mergeObstacleBoxes = function (boxes) {
        var merged = [];

        for (var boxIndex = 0; boxIndex < boxes.length; boxIndex += 1) {
            var candidate = {
                minX: boxes[boxIndex].minX,
                maxX: boxes[boxIndex].maxX,
                minZ: boxes[boxIndex].minZ,
                maxZ: boxes[boxIndex].maxZ
            };

            var didMerge = false;
            for (var mergedIndex = 0; mergedIndex < merged.length; mergedIndex += 1) {
                var target = merged[mergedIndex];
                if (!boxesOverlap2D(candidate, target)) {
                    continue;
                }

                target.minX = Math.min(target.minX, candidate.minX);
                target.maxX = Math.max(target.maxX, candidate.maxX);
                target.minZ = Math.min(target.minZ, candidate.minZ);
                target.maxZ = Math.max(target.maxZ, candidate.maxZ);
                didMerge = true;
                break;
            }

            if (!didMerge) {
                merged.push(candidate);
            }
        }

        return merged;
    };

    var buildStorageWallColliders = function (sceneEntity) {
        return buildMeshCollisionLayer(sceneEntity, {
            floorY: storage.floorY,
            bounds: storage.bounds,
            padding: 0.085,
            minObjectHeight: 0.3,
            minFootprint: 0.22,
            minLowObjectHeight: 0.12,
            minLowObjectFootprint: 0.6,
            mergeMargin: 0.02,
            wallLength: 0.84,
            ignoreVertical: true,
            clampToBounds: false,
            debugPrefix: "storage",
            excludePoints: [storage.spawn]
        });
    };

    var STORAGE_CHARACTER_GROUP = 32;
    var STORAGE_CHARACTER_FLAG = 16;
    var STORAGE_NAVIGATION_CORRECTION_INSET = 0.002;
    var STORAGE_NAVIGATION_CORRECTION_GUARD = 0.012;

    var loadStorageContainerAsset = function (url, filename) {
        return new Promise(function (resolve, reject) {
            var handleLoad = function (error, asset) {
                if (error) {
                    reject(new Error(url + ": " + error));
                    return;
                }
                resolve(asset);
            };

            if (app.assets.loadFromUrlAndFilename) {
                app.assets.loadFromUrlAndFilename(url, filename, "container", handleLoad);
                return;
            }

            var asset = new pc.Asset(filename, "container", {
                url: url,
                filename: filename
            });
            app.assets.add(asset);
            asset.ready(function () {
                resolve(asset);
            });
            asset.on("error", function (assetError) {
                reject(assetError || new Error(url + ": container load failed"));
            });
            app.assets.load(asset);
        });
    };

    var verifyStorageSha256 = function (bytes, expected, label) {
        if (!window.crypto || !window.crypto.subtle || !/^[0-9a-f]{64}$/i.test(expected || "")) {
            return Promise.reject(new Error(label + " is missing a verifiable SHA-256 digest."));
        }

        return window.crypto.subtle.digest("SHA-256", bytes).then(function (digest) {
            var values = new Uint8Array(digest);
            var actual = "";
            for (var index = 0; index < values.length; index += 1) {
                actual += values[index].toString(16).padStart(2, "0");
            }
            if (actual !== expected.toLowerCase()) {
                throw new Error(label + " failed SHA-256 verification.");
            }
        });
    };

    var loadVerifiedStorageContainerAsset = function (url, filename, expectedSha256, label) {
        return fetch(url, { cache: "no-store" }).then(function (response) {
            if (!response.ok) {
                throw new Error(url + ": HTTP " + response.status);
            }
            return response.arrayBuffer();
        }).then(function (buffer) {
            return verifyStorageSha256(new Uint8Array(buffer), expectedSha256, label).then(function () {
                var verifiedUrl = URL.createObjectURL(new Blob([buffer], { type: "model/gltf-binary" }));
                return loadStorageContainerAsset(verifiedUrl, filename).then(function (asset) {
                    URL.revokeObjectURL(verifiedUrl);
                    return asset;
                }, function (error) {
                    URL.revokeObjectURL(verifiedUrl);
                    throw error;
                });
            });
        });
    };

    var decodeStorageBase64Bytes = function (encoded, label) {
        if (typeof encoded !== "string") {
            throw new Error(label + " is missing Base64 data.");
        }

        try {
            var binary = atob(encoded);
            var bytes = new Uint8Array(binary.length);
            for (var index = 0; index < binary.length; index += 1) {
                bytes[index] = binary.charCodeAt(index);
            }
            return bytes;
        } catch (error) {
            throw new Error(label + " contains invalid Base64 data.");
        }
    };

    var parseCollisionNavigationMask = function (data, physics, label) {
        var prefix = label || "Collision";
        if (!data || data.version !== 2 || data.bit_order !== "lsb0") {
            throw new Error(prefix + " navigation mask version is not supported.");
        }

        var layers = data.layers;
        var query = data.query;
        var parameters = data.parameters;
        var cellCount = data.width * data.height;
        if (!Number.isInteger(data.width) || !Number.isInteger(data.height) || cellCount <= 0 ||
            data.cell_size <= 0 || !Array.isArray(data.origin) || data.origin.length !== 2 ||
            !layers || layers.cell_counts_encoding !== "uint4_lsb0" ||
            layers.foot_heights_encoding !== "int16_le" || layers.foot_height_scale <= 0 ||
            !query || query.foot_tolerance_m <= 0 || query.neighbor_layer_delta_max_m <= 0) {
            throw new Error(prefix + " navigation mask dimensions are invalid.");
        }

        var character = physics.player;
        var contractValues = parameters ? [
            parameters.capsule_height_m,
            parameters.max_slope_degrees,
            parameters.max_rise_m,
            parameters.erosion_radius_m,
            parameters.required_vertical_clearance_m,
            query.neighbor_layer_delta_max_m
        ] : [];
        var parameterMismatch = contractValues.length !== 6 || !contractValues.every(Number.isFinite) ||
            Math.abs(parameters.capsule_height_m - character.height) > 1e-6 ||
            parameters.max_slope_degrees > character.maxSlope + 1e-6 ||
            parameters.max_rise_m > character.stepHeight + 1e-6 ||
            parameters.erosion_radius_m + 1e-6 < character.radius + character.skin ||
            parameters.required_vertical_clearance_m + 1e-6 < character.height ||
            Math.abs(query.neighbor_layer_delta_max_m - parameters.max_rise_m) > 1e-6;
        if (parameterMismatch) {
            throw new Error(prefix + " navigation mask does not match the character capsule.");
        }

        if (physics.requireCapsuleClearanceContract) {
            var stats = data.stats;
            var tolerance = 1e-6;
            var expectedCylinderHeight = character.height - (character.radius * 2);
            var expectedGroundContactOffset = (character.height * 0.5) -
                character.restingCenterHeight;
            var expectedAxisHalfLength = expectedCylinderHeight * 0.5;
            var expectedAxisMin = character.restingCenterHeight - expectedAxisHalfLength;
            var expectedAxisMax = character.restingCenterHeight + expectedAxisHalfLength;
            var expectedRequiredClearance = character.radius + character.skin;
            var expectedCellCornerGuard = Math.hypot(data.cell_size * 0.5, data.cell_size * 0.5);
            var strictValues = parameters ? [
                parameters.capsule_radius_m,
                parameters.capsule_skin_m,
                parameters.capsule_cylinder_height_m,
                parameters.ground_contact_offset_m,
                parameters.grounded_capsule_center_height_m,
                parameters.grounded_capsule_center_offset_from_nominal_m,
                parameters.grounded_capsule_bottom_offset_m,
                parameters.grounded_capsule_top_offset_m,
                parameters.capsule_axis_min_offset_m,
                parameters.capsule_axis_max_offset_m,
                parameters.capsule_required_continuous_clearance_m,
                parameters.capsule_axis_sample_step_max_m,
                parameters.capsule_axis_sample_step_actual_m,
                parameters.capsule_axis_sample_count,
                parameters.capsule_cell_corner_guard_m,
                parameters.capsule_axis_half_step_guard_m,
                parameters.capsule_combined_lipschitz_guard_m,
                parameters.capsule_center_clearance_minimum_m,
                parameters.capsule_center_clearance_threshold_m,
                parameters.capsule_clearance_numerical_epsilon_m,
                parameters.support_required_radius_m,
                parameters.support_cell_corner_guard_m,
                parameters.support_center_erosion_minimum_m,
                parameters.support_center_erosion_threshold_m,
                parameters.capsule_axis_obstacle_triangles,
                parameters.capsule_axis_excluded_support_triangles,
                parameters.capsule_candidate_query_tolerance_m,
                parameters.capsule_candidate_query_radius_m
            ] : [];
            var strictStats = stats ? [
                stats.capsule_clearance_final_cells,
                stats.capsule_clearance_final_layers,
                stats.capsule_clearance_final_continuous_certified_lower_bound_m,
                stats.capsule_clearance_final_boundary_cells,
                stats.capsule_clearance_final_boundary_layers,
                stats.capsule_clearance_final_boundary_continuous_certified_lower_bound_m
            ] : [];
            var expectedAxisGuard = parameters && Number.isFinite(parameters.capsule_axis_sample_step_actual_m)
                ? parameters.capsule_axis_sample_step_actual_m * 0.5
                : NaN;
            var expectedCombinedGuard = Math.hypot(expectedCellCornerGuard, expectedAxisGuard);
            var expectedNumericalEpsilon = parameters &&
                Number.isFinite(parameters.capsule_clearance_numerical_epsilon_m)
                ? parameters.capsule_clearance_numerical_epsilon_m
                : NaN;
            var expectedCenterMinimum = expectedRequiredClearance + expectedCombinedGuard +
                expectedNumericalEpsilon;
            var expectedSupportMinimum = expectedRequiredClearance + expectedCellCornerGuard +
                expectedNumericalEpsilon;
            var strictMismatch = strictValues.length !== 28 ||
                !strictValues.every(Number.isFinite) ||
                strictStats.length !== 6 || !strictStats.every(Number.isFinite) ||
                data.connected_cells !== physics.expectedNavigationCells ||
                Math.abs(data.cell_size - physics.expectedNavigationCellSize) > tolerance ||
                Math.abs(parameters.capsule_radius_m - character.radius) > tolerance ||
                Math.abs(parameters.capsule_skin_m - character.skin) > tolerance ||
                Math.abs(parameters.capsule_cylinder_height_m - expectedCylinderHeight) > tolerance ||
                Math.abs(parameters.ground_contact_offset_m - expectedGroundContactOffset) > tolerance ||
                Math.abs(parameters.grounded_capsule_center_height_m -
                    character.restingCenterHeight) > tolerance ||
                Math.abs(parameters.grounded_capsule_center_offset_from_nominal_m +
                    expectedGroundContactOffset) > tolerance ||
                Math.abs(parameters.grounded_capsule_bottom_offset_m +
                    expectedGroundContactOffset) > tolerance ||
                Math.abs(parameters.grounded_capsule_top_offset_m -
                    (character.restingCenterHeight + character.height * 0.5)) > tolerance ||
                Math.abs(parameters.capsule_axis_min_offset_m - expectedAxisMin) > tolerance ||
                Math.abs(parameters.capsule_axis_max_offset_m - expectedAxisMax) > tolerance ||
                Math.abs(parameters.capsule_required_continuous_clearance_m -
                    expectedRequiredClearance) > tolerance ||
                parameters.capsule_axis_sample_step_max_m <= 0 ||
                parameters.capsule_axis_sample_step_max_m > 0.01 + tolerance ||
                parameters.capsule_axis_sample_step_actual_m <= 0 ||
                parameters.capsule_axis_sample_step_actual_m >
                    parameters.capsule_axis_sample_step_max_m + tolerance ||
                !Number.isInteger(parameters.capsule_axis_sample_count) ||
                parameters.capsule_axis_sample_count < 2 ||
                Math.abs(parameters.capsule_axis_sample_step_actual_m *
                    (parameters.capsule_axis_sample_count - 1) -
                    (expectedAxisMax - expectedAxisMin)) > tolerance ||
                Math.abs(parameters.capsule_cell_corner_guard_m -
                    expectedCellCornerGuard) > tolerance ||
                Math.abs(parameters.capsule_axis_half_step_guard_m - expectedAxisGuard) > tolerance ||
                Math.abs(parameters.capsule_combined_lipschitz_guard_m -
                    expectedCombinedGuard) > tolerance ||
                Math.abs(parameters.capsule_center_clearance_minimum_m -
                    expectedCenterMinimum) > tolerance ||
                parameters.capsule_center_clearance_threshold_m + tolerance <
                    parameters.capsule_center_clearance_minimum_m ||
                parameters.capsule_center_clearance_threshold_m -
                    parameters.capsule_combined_lipschitz_guard_m + tolerance <
                    expectedRequiredClearance ||
                parameters.capsule_clearance_numerical_epsilon_m < 0 ||
                Math.abs(parameters.support_required_radius_m -
                    expectedRequiredClearance) > tolerance ||
                Math.abs(parameters.support_cell_corner_guard_m -
                    expectedCellCornerGuard) > tolerance ||
                Math.abs(parameters.support_center_erosion_minimum_m -
                    expectedSupportMinimum) > tolerance ||
                parameters.support_center_erosion_threshold_m + tolerance <
                    parameters.support_center_erosion_minimum_m ||
                Math.abs(parameters.support_center_erosion_threshold_m -
                    parameters.erosion_radius_m) > tolerance ||
                parameters.capsule_axis_excluded_support_triangles !==
                    physics.navigationSupportTriangles ||
                parameters.capsule_axis_obstacle_triangles +
                    parameters.capsule_axis_excluded_support_triangles !== physics.triangleCount ||
                parameters.capsule_candidate_query_tolerance_m <
                    parameters.capsule_clearance_numerical_epsilon_m ||
                Math.abs(parameters.capsule_candidate_query_radius_m -
                    (parameters.capsule_center_clearance_threshold_m +
                        parameters.capsule_candidate_query_tolerance_m)) > tolerance ||
                parameters.capsule_axis_clearance_model !==
                    "threshold_aabb_candidates_exact_point_triangle_distance_with_capped_lower_bounds_and_1_lipschitz_guard" ||
                parameters.capsule_axis_obstacle_model !==
                    "full_collision_except_source_frl_apartment_ceiling_support_triangles" ||
                parameters.capsule_distance_value_semantics !==
                    "exact below threshold; otherwise a certified lower bound capped at threshold" ||
                (parameters.capsule_candidate_query_backend !== "rtree_intersection_v" &&
                    parameters.capsule_candidate_query_backend !==
                        "rtree_scalar_intersection_fallback") ||
                parameters.erosion_model !==
                    "local_height_connected_disk_coverage_with_cell_corner_guard" ||
                parameters.clearance_model !==
                    "double_sided_upward_segment_against_full_collision" ||
                parameters.floor_surface_model !== "upside_down_source_ceiling" ||
                parameters.height_model !== "clustered_multi_layer" ||
                parameters.connectivity !== 4 ||
                !Array.isArray(parameters.surface_nodes) ||
                parameters.surface_nodes.length !== 1 ||
                parameters.surface_nodes[0] !== "frl_apartment_ceiling" ||
                stats.capsule_clearance_final_cells !== data.connected_cells ||
                stats.capsule_clearance_final_layers !== data.connected_layers ||
                stats.capsule_clearance_final_boundary_cells <= 0 ||
                stats.capsule_clearance_final_boundary_layers <= 0 ||
                stats.capsule_clearance_final_continuous_certified_lower_bound_m + tolerance <
                    expectedRequiredClearance ||
                stats.capsule_clearance_final_boundary_continuous_certified_lower_bound_m + tolerance <
                    expectedRequiredClearance;
            if (strictMismatch) {
                throw new Error(prefix + " navigation mask lacks the required full-capsule clearance proof.");
            }
        }

        var maskBytes = decodeStorageBase64Bytes(data.mask_base64, prefix + " navigation bitmap");
        var countBytes = decodeStorageBase64Bytes(layers.cell_counts_base64, prefix + " navigation layer counts");
        var heightBytes = decodeStorageBase64Bytes(layers.foot_heights_base64, prefix + " navigation heights");
        if (maskBytes.length !== Math.ceil(cellCount / 8) || countBytes.length !== Math.ceil(cellCount / 2)) {
            throw new Error(prefix + " navigation binary lengths are invalid.");
        }

        return Promise.all([
            verifyStorageSha256(maskBytes, data.mask_sha256, prefix + " navigation bitmap"),
            verifyStorageSha256(countBytes, layers.cell_counts_sha256, prefix + " navigation layer counts"),
            verifyStorageSha256(heightBytes, layers.foot_heights_sha256, prefix + " navigation heights")
        ]).then(function () {
            var counts = new Uint8Array(cellCount);
            var offsets = new Uint32Array(cellCount + 1);
            var connectedCells = 0;
            var maxLayersPerCell = 0;

            for (var index = 0; index < cellCount; index += 1) {
                var packed = countBytes[index >> 1];
                var count = (packed >> ((index & 1) * 4)) & 0x0f;
                var present = Boolean(maskBytes[index >> 3] & (1 << (index & 7)));
                if (present !== (count > 0)) {
                    throw new Error(prefix + " navigation bitmap and layer counts disagree.");
                }
                counts[index] = count;
                offsets[index + 1] = offsets[index] + count;
                if (count > 0) {
                    connectedCells += 1;
                }
                maxLayersPerCell = Math.max(maxLayersPerCell, count);
            }

            var trailingMaskBits = cellCount & 7;
            if (trailingMaskBits && (maskBytes[maskBytes.length - 1] >> trailingMaskBits) !== 0) {
                throw new Error(prefix + " navigation bitmap has nonzero padding bits.");
            }
            if ((cellCount & 1) && (countBytes[countBytes.length - 1] & 0xf0) !== 0) {
                throw new Error(prefix + " navigation layer counts have nonzero padding bits.");
            }

            var connectedLayers = offsets[cellCount];
            if (connectedCells !== data.connected_cells || connectedLayers !== data.connected_layers ||
                maxLayersPerCell !== layers.max_layers_per_cell || heightBytes.length !== connectedLayers * 2) {
                throw new Error(prefix + " navigation layer totals are invalid.");
            }

            var heightView = new DataView(heightBytes.buffer, heightBytes.byteOffset, heightBytes.byteLength);
            var heights = new Float32Array(connectedLayers);
            for (var heightIndex = 0; heightIndex < connectedLayers; heightIndex += 1) {
                heights[heightIndex] = heightView.getInt16(heightIndex * 2, true) * layers.foot_height_scale;
            }
            for (var cell = 0; cell < cellCount; cell += 1) {
                for (var layerIndex = offsets[cell] + 1; layerIndex < offsets[cell + 1]; layerIndex += 1) {
                    if (heights[layerIndex] <= heights[layerIndex - 1]) {
                        throw new Error(prefix + " navigation layers are not sorted.");
                    }
                }
            }

            return {
                version: data.version,
                originX: data.origin[0],
                originZ: data.origin[1],
                cellSize: data.cell_size,
                width: data.width,
                height: data.height,
                connectedCells: connectedCells,
                connectedLayers: connectedLayers,
                footTolerance: query.foot_tolerance_m,
                maxLayerDelta: query.neighbor_layer_delta_max_m + (query.neighbor_comparison_epsilon_m || 0),
                counts: counts,
                offsets: offsets,
                heights: heights
            };
        });
    };

    var loadCollisionNavigationMask = function (url, physics, label) {
        return fetch(url, { cache: "no-store" }).then(function (response) {
            if (!response.ok) {
                throw new Error(url + ": HTTP " + response.status);
            }
            return response.arrayBuffer();
        }).then(function (buffer) {
            var bytes = new Uint8Array(buffer);
            return verifyStorageSha256(bytes, physics.navigationSha256, label + " navigation file").then(function () {
                var text = new TextDecoder("utf-8").decode(bytes);
                return parseCollisionNavigationMask(JSON.parse(text), physics, label);
            });
        });
    };

    var loadStorageNavigationMask = function (url) {
        return loadCollisionNavigationMask(url, storagePhysics, "Storage");
    };

    var storageNavigationCell = function (x, z) {
        var navigation = storagePhysics.navigation;
        if (!navigation) {
            return -1;
        }
        var ix = Math.floor((x - navigation.originX) / navigation.cellSize);
        var iz = Math.floor((z - navigation.originZ) / navigation.cellSize);
        if (ix < 0 || iz < 0 || ix >= navigation.width || iz >= navigation.height) {
            return -1;
        }
        return (iz * navigation.width) + ix;
    };

    var insideStorageNavigation = function (x, z) {
        var cell = storageNavigationCell(x, z);
        return cell >= 0 && storagePhysics.navigation.counts[cell] > 0;
    };

    var findStorageNavigationLayer = function (x, z, referenceHeight, tolerance) {
        var navigation = storagePhysics.navigation;
        var cell = storageNavigationCell(x, z);
        if (cell < 0) {
            return null;
        }

        var start = navigation.offsets[cell];
        var end = navigation.offsets[cell + 1];
        var best = null;
        var bestDelta = Infinity;
        for (var index = start; index < end; index += 1) {
            var height = navigation.heights[index];
            var delta = Math.abs(height - referenceHeight);
            if (delta <= tolerance && delta < bestDelta) {
                best = height;
                bestDelta = delta;
            }
        }
        return best;
    };

    var findNearestStorageNavigationPoint = function (x, z) {
        var navigation = storagePhysics.navigation;
        var nearest = null;
        var nearestDistanceSq = Infinity;

        for (var cell = 0; cell < navigation.width * navigation.height; cell += 1) {
            if (navigation.counts[cell] === 0) {
                continue;
            }
            var ix = cell % navigation.width;
            var iz = Math.floor(cell / navigation.width);
            var cellX = navigation.originX + ((ix + 0.5) * navigation.cellSize);
            var cellZ = navigation.originZ + ((iz + 0.5) * navigation.cellSize);
            var dx = cellX - x;
            var dz = cellZ - z;
            var distanceSq = (dx * dx) + (dz * dz);
            if (distanceSq < nearestDistanceSq) {
                nearestDistanceSq = distanceSq;
                nearest = vec3(
                    cellX,
                    navigation.heights[navigation.offsets[cell]] + (storagePhysics.player.height * 0.5) + 0.05,
                    cellZ
                );
            }
        }

        if (!nearest) {
            throw new Error("The storage navigation mask has no safe spawn point.");
        }
        return nearest;
    };

    var addStorageBoundaryBox = function (parent, name, center, halfExtents) {
        var entity = new pc.Entity(name);
        entity.setPosition(center);
        entity.addComponent("collision", { type: "box", halfExtents: halfExtents });
        entity.addComponent("rigidbody", { type: "static", friction: 0.65, restitution: 0 });
        parent.addChild(entity);
        return entity;
    };

    var createStorageSafetyCage = function (parent) {
        var min = storagePhysics.bounds.min;
        var max = storagePhysics.bounds.max;
        var thickness = 0.12;
        var centerX = (min.x + max.x) * 0.5;
        var centerY = (min.y + max.y) * 0.5;
        var centerZ = (min.z + max.z) * 0.5;
        var halfX = ((max.x - min.x) * 0.5) + 0.18;
        var halfY = ((max.y - min.y) * 0.5) + 0.24;
        var halfZ = ((max.z - min.z) * 0.5) + 0.18;

        addStorageBoundaryBox(parent, "Storage Safety West", vec3(min.x - thickness, centerY, centerZ), vec3(thickness, halfY, halfZ));
        addStorageBoundaryBox(parent, "Storage Safety East", vec3(max.x + thickness, centerY, centerZ), vec3(thickness, halfY, halfZ));
        addStorageBoundaryBox(parent, "Storage Safety North", vec3(centerX, centerY, min.z - thickness), vec3(halfX, halfY, thickness));
        addStorageBoundaryBox(parent, "Storage Safety South", vec3(centerX, centerY, max.z + thickness), vec3(halfX, halfY, thickness));
        addStorageBoundaryBox(parent, "Storage Safety Floor", vec3(centerX, min.y - 0.16, centerZ), vec3(halfX, 0.1, halfZ));
        addStorageBoundaryBox(parent, "Storage Safety Ceiling", vec3(centerX, max.y + 0.16, centerZ), vec3(halfX, 0.1, halfZ));
    };

    var createStorageCollisionEnvironment = function (collisionAsset) {
        var renderAsset = collisionAsset.resource && collisionAsset.resource.renders ? collisionAsset.resource.renders[0] : null;
        if (!renderAsset) {
            throw new Error("The storage collision GLB has no render asset.");
        }

        var collisionRoot = createGroup("storage-exact-collision", storage.root);
        var collider = new pc.Entity("Storage Static BVH");
        collider.addComponent("collision", {
            type: "mesh",
            renderAsset: renderAsset,
            checkVertexDuplicates: true
        });
        collider.addComponent("rigidbody", { type: "static", friction: 0.72, restitution: 0 });
        collisionRoot.addChild(collider);
        createStorageSafetyCage(collisionRoot);

        storagePhysics.collisionAsset = collisionAsset;
        storagePhysics.collisionRoot = collisionRoot;
        storagePhysics.colliderEntity = collider;
    };

    var upsideNavigationCell = function (x, z) {
        var navigation = upsidePhysics.navigation;
        if (!navigation) {
            return -1;
        }
        var ix = Math.floor((x - navigation.originX) / navigation.cellSize);
        var iz = Math.floor((z - navigation.originZ) / navigation.cellSize);
        if (ix < 0 || iz < 0 || ix >= navigation.width || iz >= navigation.height) {
            return -1;
        }
        return (iz * navigation.width) + ix;
    };

    var insideUpsideNavigation = function (x, z) {
        var cell = upsideNavigationCell(x, z);
        return cell >= 0 && upsidePhysics.navigation.counts[cell] > 0;
    };

    var findUpsideNavigationLayer = function (x, z, referenceHeight, tolerance) {
        var navigation = upsidePhysics.navigation;
        var cell = upsideNavigationCell(x, z);
        if (cell < 0) {
            return null;
        }

        var best = null;
        var bestDelta = Infinity;
        for (var index = navigation.offsets[cell]; index < navigation.offsets[cell + 1]; index += 1) {
            var height = navigation.heights[index];
            var delta = Math.abs(height - referenceHeight);
            if (delta <= tolerance && delta < bestDelta) {
                best = height;
                bestDelta = delta;
            }
        }
        return best;
    };

    var findNearestUpsideNavigationPoint = function (x, z) {
        var navigation = upsidePhysics.navigation;
        var nearest = null;
        var nearestDistanceSq = Infinity;
        for (var cell = 0; cell < navigation.width * navigation.height; cell += 1) {
            if (navigation.counts[cell] === 0) {
                continue;
            }
            var ix = cell % navigation.width;
            var iz = Math.floor(cell / navigation.width);
            var cellX = navigation.originX + ((ix + 0.5) * navigation.cellSize);
            var cellZ = navigation.originZ + ((iz + 0.5) * navigation.cellSize);
            var dx = cellX - x;
            var dz = cellZ - z;
            var distanceSq = (dx * dx) + (dz * dz);
            if (distanceSq < nearestDistanceSq) {
                nearestDistanceSq = distanceSq;
                nearest = vec3(
                    cellX,
                    navigation.heights[navigation.offsets[cell]] + upsidePhysics.player.restingCenterHeight,
                    cellZ
                );
            }
        }
        if (!nearest) {
            throw new Error("The scene 1 navigation mask has no safe spawn point.");
        }
        return nearest;
    };

    var createUpsideSafetyCage = function (parent) {
        var min = upsidePhysics.bounds.min;
        var max = upsidePhysics.bounds.max;
        var thickness = 0.12;
        var centerX = (min.x + max.x) * 0.5;
        var centerY = (min.y + max.y) * 0.5;
        var centerZ = (min.z + max.z) * 0.5;
        var halfX = ((max.x - min.x) * 0.5) + 0.18;
        var halfY = ((max.y - min.y) * 0.5) + 0.24;
        var halfZ = ((max.z - min.z) * 0.5) + 0.18;

        addStorageBoundaryBox(parent, "Scene 1 Safety West", vec3(min.x - thickness, centerY, centerZ), vec3(thickness, halfY, halfZ));
        addStorageBoundaryBox(parent, "Scene 1 Safety East", vec3(max.x + thickness, centerY, centerZ), vec3(thickness, halfY, halfZ));
        addStorageBoundaryBox(parent, "Scene 1 Safety North", vec3(centerX, centerY, min.z - thickness), vec3(halfX, halfY, thickness));
        addStorageBoundaryBox(parent, "Scene 1 Safety South", vec3(centerX, centerY, max.z + thickness), vec3(halfX, halfY, thickness));
        addStorageBoundaryBox(parent, "Scene 1 Safety Floor", vec3(centerX, min.y - 0.16, centerZ), vec3(halfX, 0.1, halfZ));
        addStorageBoundaryBox(parent, "Scene 1 Safety Ceiling", vec3(centerX, max.y + 0.16, centerZ), vec3(halfX, 0.1, halfZ));
    };

    var createUpsideCollisionEnvironment = function (collisionAsset) {
        var renderAsset = collisionAsset.resource && collisionAsset.resource.renders ? collisionAsset.resource.renders[0] : null;
        if (!renderAsset) {
            throw new Error("The scene 1 collision GLB has no render asset.");
        }

        var collisionRoot = createGroup("scene1-exact-collision", app.root);
        var collider = new pc.Entity("Scene 1 Static BVH");
        collisionRoot.addChild(collider);
        collider.addComponent("collision", {
            type: "mesh",
            renderAsset: renderAsset,
            checkVertexDuplicates: true
        });
        collider.addComponent("rigidbody", { type: "static", friction: 0.72, restitution: 0 });
        createUpsideSafetyCage(collisionRoot);

        upsidePhysics.collisionAsset = collisionAsset;
        upsidePhysics.collisionRoot = collisionRoot;
        upsidePhysics.colliderEntity = collider;
    };

    var isUpsideColliderBodyReady = function () {
        return Boolean(
            upsidePhysics.colliderEntity &&
            upsidePhysics.colliderEntity.rigidbody &&
            upsidePhysics.colliderEntity.rigidbody.body
        );
    };

    var getUpsideCharacterPosition = function (target) {
        var origin = upsidePhysics.character.ghost.getWorldTransform().getOrigin();
        return target.set(origin.x(), origin.y(), origin.z());
    };

    var getUpsideCharacterVelocity = function (target) {
        var linear = upsidePhysics.character.controller.getLinearVelocity();
        return target.set(linear.x(), linear.y(), linear.z());
    };

    var warpUpsideCharacter = function (position) {
        var character = upsidePhysics.character;
        if (!character) {
            return;
        }
        character.controller.reset(character.world);
        character.warp.setValue(position.x, position.y, position.z);
        character.controller.warp(character.warp);
        character.world.updateSingleAabb(character.ghost);
        character.walk.setValue(0, 0, 0);
        character.controller.setWalkDirection(character.walk);
        upsidePhysics.moveVelocity.set(0, 0, 0);
    };

    var createUpsideCharacter = function () {
        if (upsidePhysics.character) {
            return upsidePhysics.character;
        }
        if (storagePhysics.character) {
            throw new Error("Cannot activate both room collision controllers at once.");
        }

        var spawn = upsidePhysics.collisionSpawn;
        var config = upsidePhysics.player;
        var world = app.systems.rigidbody.dynamicsWorld;
        var ghostPairCallback = new Ammo.btGhostPairCallback();
        world.getBroadphase().getOverlappingPairCache().setInternalGhostPairCallback(ghostPairCallback);
        var shape = new Ammo.btCapsuleShape(config.radius, config.height - (config.radius * 2));
        var ghost = new Ammo.btPairCachingGhostObject();
        var transform = new Ammo.btTransform();
        transform.setIdentity();
        var spawnVector = new Ammo.btVector3(spawn.x, spawn.y, spawn.z);
        transform.setOrigin(spawnVector);
        ghost.setWorldTransform(transform);
        ghost.setCollisionShape(shape);
        ghost.setCollisionFlags(ghost.getCollisionFlags() | STORAGE_CHARACTER_FLAG);
        ghost.forceActivationState(pc.BODYSTATE_DISABLE_DEACTIVATION);
        world.addCollisionObject(ghost, STORAGE_CHARACTER_GROUP, 1 | 2 | 4);

        var up = new Ammo.btVector3(0, 1, 0);
        var gravity = new Ammo.btVector3(0, -16.5, 0);
        var controller = new Ammo.btKinematicCharacterController(ghost, shape, config.stepHeight, up);
        controller.setUseGhostSweepTest(false);
        controller.setGravity(gravity);
        controller.setFallSpeed(30);
        controller.setJumpSpeed(5.1);
        controller.setMaxJumpHeight(1.15);
        controller.setMaxSlope(config.maxSlope * pc.math.DEG_TO_RAD);
        controller.setMaxPenetrationDepth(0.01);
        controller.setLinearDamping(0);

        upsidePhysics.character = {
            world: world,
            ghostPairCallback: ghostPairCallback,
            shape: shape,
            ghost: ghost,
            transform: transform,
            spawn: spawnVector,
            up: up,
            gravity: gravity,
            controller: controller,
            walk: new Ammo.btVector3(0, 0, 0),
            warp: new Ammo.btVector3(spawn.x, spawn.y, spawn.z),
            actionActive: false
        };
        return upsidePhysics.character;
    };

    var destroyUpsideCharacter = function () {
        var character = upsidePhysics.character;
        if (!character) {
            return;
        }
        upsidePhysics.character = null;
        if (character.actionActive) {
            character.world.removeAction(character.controller);
        }
        character.world.removeCollisionObject(character.ghost);
        character.world.getBroadphase().getOverlappingPairCache().setInternalGhostPairCallback(null);
        Ammo.destroy(character.controller);
        Ammo.destroy(character.ghost);
        Ammo.destroy(character.shape);
        Ammo.destroy(character.transform);
        Ammo.destroy(character.spawn);
        Ammo.destroy(character.up);
        Ammo.destroy(character.gravity);
        Ammo.destroy(character.walk);
        Ammo.destroy(character.warp);
        Ammo.destroy(character.ghostPairCallback);
    };

    var activateUpsideCharacter = function (position) {
        var character = createUpsideCharacter();
        if (!character.actionActive) {
            character.world.addAction(character.controller);
            character.actionActive = true;
        }
        if (position) {
            warpUpsideCharacter(position);
        }
        return character;
    };

    var findUpsideFootprintTransitionLayer = function (x, z, footHeight) {
        var navigation = upsidePhysics.navigation;
        var baseHeight = findUpsideNavigationLayer(
            x,
            z,
            upsidePhysics.navigationHeight,
            navigation.maxLayerDelta
        );
        if (baseHeight === null) {
            return null;
        }

        var radius = upsidePhysics.player.radius + upsidePhysics.player.skin;
        var radiusSq = radius * radius;
        var minX = Math.max(0, Math.floor((x - radius - navigation.originX) / navigation.cellSize));
        var maxX = Math.min(navigation.width - 1, Math.floor((x + radius - navigation.originX) / navigation.cellSize));
        var minZ = Math.max(0, Math.floor((z - radius - navigation.originZ) / navigation.cellSize));
        var maxZ = Math.min(navigation.height - 1, Math.floor((z + radius - navigation.originZ) / navigation.cellSize));
        var best = null;
        var bestHeightDelta = Infinity;
        var bestDistanceSq = Infinity;

        for (var iz = minZ; iz <= maxZ; iz += 1) {
            var cellMinZ = navigation.originZ + (iz * navigation.cellSize);
            var cellMaxZ = cellMinZ + navigation.cellSize;
            var dz = Math.max(cellMinZ - z, 0, z - cellMaxZ);
            for (var ix = minX; ix <= maxX; ix += 1) {
                var cellMinX = navigation.originX + (ix * navigation.cellSize);
                var cellMaxX = cellMinX + navigation.cellSize;
                var dx = Math.max(cellMinX - x, 0, x - cellMaxX);
                var distanceSq = (dx * dx) + (dz * dz);
                if (distanceSq > radiusSq) {
                    continue;
                }

                var cell = (iz * navigation.width) + ix;
                for (var index = navigation.offsets[cell]; index < navigation.offsets[cell + 1]; index += 1) {
                    var height = navigation.heights[index];
                    if (Math.abs(height - baseHeight) > navigation.maxLayerDelta) {
                        continue;
                    }
                    var transitionMin = Math.min(baseHeight, height) - navigation.footTolerance;
                    var transitionMax = Math.max(baseHeight, height) + navigation.footTolerance;
                    if (footHeight < transitionMin || footHeight > transitionMax) {
                        continue;
                    }
                    var heightDelta = Math.abs(height - footHeight);
                    if (heightDelta < bestHeightDelta ||
                        (heightDelta === bestHeightDelta && distanceSq < bestDistanceSq)) {
                        best = height;
                        bestHeightDelta = heightDelta;
                        bestDistanceSq = distanceSq;
                    }
                }
            }
        }
        return best;
    };

    var upsideSegmentNavigationHeight = function (x0, z0, x1, z1, startHeight) {
        var navigation = upsidePhysics.navigation;
        var distance = Math.hypot(x1 - x0, z1 - z0);
        var samples = Math.max(1, Math.ceil(distance / (navigation.cellSize * 0.5)));
        var height = startHeight;
        for (var index = 1; index <= samples; index += 1) {
            var t = index / samples;
            var nextHeight = findUpsideNavigationLayer(
                lerp(x0, x1, t),
                lerp(z0, z1, t),
                height,
                navigation.maxLayerDelta
            );
            if (nextHeight === null) {
                return null;
            }
            height = nextHeight;
        }
        return height;
    };

    var upsideNavigationSimulationTime = function (rawDt) {
        var fixedStep = app.systems.rigidbody.fixedTimeStep;
        return Math.min(
            Math.max(0, rawDt) + fixedStep,
            fixedStep * app.systems.rigidbody.maxSubSteps
        );
    };

    var constrainUpsideVelocityToNavigation = function (position, simulationTime) {
        var navigation = upsidePhysics.navigation;
        var velocity = upsidePhysics.moveVelocity;
        var footHeight = position.y - (upsidePhysics.player.height * 0.5);
        var startHeight = upsidePhysics.grounded
            ? findUpsideNavigationLayer(position.x, position.z, footHeight, navigation.footTolerance)
            : findUpsideNavigationLayer(
                position.x,
                position.z,
                upsidePhysics.navigationHeight,
                navigation.maxLayerDelta
            );
        if (upsidePhysics.grounded && startHeight === null) {
            startHeight = findUpsideNavigationLayer(
                position.x,
                position.z,
                upsidePhysics.navigationHeight,
                navigation.maxLayerDelta
            );
        }
        if (startHeight === null) {
            velocity.x = 0;
            velocity.z = 0;
            return;
        }

        var targetX = position.x + (velocity.x * simulationTime);
        var targetZ = position.z + (velocity.z * simulationTime);
        var fullHeight = upsideSegmentNavigationHeight(position.x, position.z, targetX, targetZ, startHeight);
        if (fullHeight !== null) {
            upsidePhysics.navigationHeight = fullHeight;
            return;
        }

        var xHeight = upsideSegmentNavigationHeight(position.x, position.z, targetX, position.z, startHeight);
        var zHeight = upsideSegmentNavigationHeight(position.x, position.z, position.x, targetZ, startHeight);
        var allowX = xHeight !== null;
        var allowZ = zHeight !== null;
        if (!allowX) {
            velocity.x = 0;
        }
        if (!allowZ) {
            velocity.z = 0;
        }
        if (allowX && allowZ) {
            if (Math.abs(velocity.x) >= Math.abs(velocity.z)) {
                velocity.z = 0;
                upsidePhysics.navigationHeight = xHeight;
            } else {
                velocity.x = 0;
                upsidePhysics.navigationHeight = zHeight;
            }
        } else if (allowX) {
            upsidePhysics.navigationHeight = xHeight;
        } else if (allowZ) {
            upsidePhysics.navigationHeight = zHeight;
        }
    };

    var outsideUpsideSafetyBounds = function (position) {
        var min = upsidePhysics.bounds.min;
        var max = upsidePhysics.bounds.max;
        var margin = 0.42;
        return position.x < min.x - margin || position.x > max.x + margin ||
            position.z < min.z - margin || position.z > max.z + margin ||
            position.y < min.y - 0.8 || position.y > max.y + 0.9;
    };

    var findStrictUpsideNavigationLayer = function (x, y, z) {
        if (!insideUpsideNavigation(x, z)) {
            return null;
        }
        var position = upsidePhysics.characterPosition.set(x, y, z);
        if (outsideUpsideSafetyBounds(position)) {
            return null;
        }
        return findUpsideNavigationLayer(
            x,
            z,
            y - (upsidePhysics.player.height * 0.5),
            upsidePhysics.navigation.footTolerance
        );
    };

    var validateUpsideLastSafeLayer = function (requireFreshSample) {
        var safe = upsidePhysics.lastSafePosition;
        if (!Number.isFinite(safe.x) || !Number.isFinite(safe.y) || !Number.isFinite(safe.z) ||
            !Number.isFinite(upsidePhysics.lastSafeLayer) ||
            (requireFreshSample && upsidePhysics.lastSafeSampleId !== upsidePhysics.syncSampleId - 1) ||
            outsideUpsideSafetyBounds(safe) ||
            upsideNavigationCell(safe.x, safe.z) !== upsidePhysics.lastSafeCell ||
            Math.abs(safe.y - (upsidePhysics.player.height * 0.5) - upsidePhysics.lastSafeLayer) >
                upsidePhysics.navigation.footTolerance) {
            return null;
        }
        return findUpsideNavigationLayer(safe.x, safe.z, upsidePhysics.lastSafeLayer, 0);
    };

    var correctInvalidUpsideNavigationPosition = function (position, rawDt) {
        if (upsidePhysics.diagnosticTeleportPending || !upsidePhysics.grounded) {
            return false;
        }
        var safeLayer = validateUpsideLastSafeLayer(true);
        if (safeLayer === null) {
            return false;
        }

        var safe = upsidePhysics.lastSafePosition;
        var dx = position.x - safe.x;
        var dz = position.z - safe.z;
        var distance = Math.hypot(dx, dz);
        var speed = Math.hypot(upsidePhysics.moveVelocity.x, upsidePhysics.moveVelocity.z);
        var reachableDistance = (speed * upsideNavigationSimulationTime(rawDt)) +
            STORAGE_NAVIGATION_CORRECTION_GUARD;
        if (!Number.isFinite(distance) || !Number.isFinite(reachableDistance) ||
            distance <= 0 || distance > reachableDistance) {
            return false;
        }

        var navigation = upsidePhysics.navigation;
        var samples = Math.max(1, Math.ceil(distance / (navigation.cellSize * 0.25)));
        var validT = 0;
        var invalidT = 1;
        var validLayer = safeLayer;
        for (var index = 1; index <= samples; index += 1) {
            var t = index / samples;
            var layer = findUpsideNavigationLayer(
                safe.x + (dx * t),
                safe.z + (dz * t),
                validLayer,
                navigation.maxLayerDelta
            );
            if (layer === null) {
                invalidT = t;
                break;
            }
            validT = t;
            validLayer = layer;
        }
        if (validT >= 1) {
            return false;
        }

        for (var iteration = 0; iteration < 16; iteration += 1) {
            var midpoint = (validT + invalidT) * 0.5;
            var midpointLayer = findUpsideNavigationLayer(
                safe.x + (dx * midpoint),
                safe.z + (dz * midpoint),
                validLayer,
                navigation.maxLayerDelta
            );
            if (midpointLayer !== null) {
                validT = midpoint;
                validLayer = midpointLayer;
            } else {
                invalidT = midpoint;
            }
        }

        validT = Math.max(0, validT - (STORAGE_NAVIGATION_CORRECTION_INSET / distance));
        validLayer = findUpsideNavigationLayer(
            safe.x + (dx * validT),
            safe.z + (dz * validT),
            validLayer,
            navigation.maxLayerDelta
        );
        if (validLayer === null) {
            return false;
        }

        var corrected = upsidePhysics.correctionPosition.set(
            safe.x + (dx * validT),
            validLayer + (upsidePhysics.player.height * 0.5) + upsidePhysics.lastSafeContactOffset,
            safe.z + (dz * validT)
        );
        var projectedLayer = findStrictUpsideNavigationLayer(corrected.x, corrected.y, corrected.z);
        if (projectedLayer === null || projectedLayer !== validLayer) {
            return false;
        }

        upsidePhysics.navigationHeight = projectedLayer;
        upsidePhysics.lastSafePosition.copy(corrected);
        upsidePhysics.lastSafeLayer = projectedLayer;
        upsidePhysics.lastSafeCell = upsideNavigationCell(corrected.x, corrected.z);
        upsidePhysics.lastSafeSampleId = upsidePhysics.syncSampleId;
        warpUpsideCharacter(corrected);
        upsidePhysics.grounded = false;
        upsidePhysics.airborneTime = 0;
        upsidePhysics.navigationCorrectionCount += 1;
        upsidePhysics.navigationCorrectionReasons["invalid-cell"] =
            (upsidePhysics.navigationCorrectionReasons["invalid-cell"] || 0) + 1;
        return true;
    };

    var recoverUpsideCharacter = function (reason) {
        var safeLayer = validateUpsideLastSafeLayer(false);
        var fallback = safeLayer === null ? upsidePhysics.collisionSpawn : upsidePhysics.lastSafePosition;
        if (safeLayer === null) {
            var spawnLayer = findUpsideNavigationLayer(
                upsidePhysics.collisionSpawn.x,
                upsidePhysics.collisionSpawn.z,
                upsidePhysics.collisionSpawn.y - (upsidePhysics.player.height * 0.5),
                upsidePhysics.navigation.footTolerance
            );
            upsidePhysics.lastSafePosition.copy(upsidePhysics.collisionSpawn);
            upsidePhysics.lastSafeLayer = spawnLayer;
            upsidePhysics.lastSafeCell = upsideNavigationCell(
                upsidePhysics.collisionSpawn.x,
                upsidePhysics.collisionSpawn.z
            );
            upsidePhysics.lastSafeContactOffset = upsidePhysics.collisionSpawn.y -
                (upsidePhysics.player.height * 0.5) - spawnLayer;
        }
        upsidePhysics.lastSafeSampleId = -1;
        upsidePhysics.navigationHeight = safeLayer === null ? upsidePhysics.lastSafeLayer : safeLayer;
        warpUpsideCharacter(fallback);
        upsidePhysics.grounded = false;
        upsidePhysics.airborneTime = 0;
        upsidePhysics.recoveryCount += 1;
        upsidePhysics.recoveryReasons[reason] = (upsidePhysics.recoveryReasons[reason] || 0) + 1;
    };

    var syncUpsideCharacter = function (rawDt) {
        upsidePhysics.syncSampleId += 1;
        var position = getUpsideCharacterPosition(upsidePhysics.characterPosition);
        upsidePhysics.grounded = upsidePhysics.character.controller.onGround();
        var footHeight = position.y - (upsidePhysics.player.height * 0.5);
        var directLayer = upsidePhysics.grounded
            ? findUpsideNavigationLayer(
                position.x,
                position.z,
                footHeight,
                upsidePhysics.navigation.footTolerance
            )
            : null;
        var transitionLayer = upsidePhysics.grounded && directLayer === null
            ? findUpsideFootprintTransitionLayer(position.x, position.z, footHeight)
            : null;
        var navigationInside = insideUpsideNavigation(position.x, position.z);
        var recoveryReason = outsideUpsideSafetyBounds(position)
            ? "bounds"
            : !navigationInside
                ? "invalid-cell"
                : upsidePhysics.grounded && directLayer === null && transitionLayer === null
                    ? "ground-layer"
                    : null;

        if (recoveryReason !== null) {
            var corrected = recoveryReason === "invalid-cell" &&
                correctInvalidUpsideNavigationPosition(position, rawDt);
            if (!corrected) {
                recoverUpsideCharacter(recoveryReason);
            }
            getUpsideCharacterPosition(position);
        } else if (upsidePhysics.grounded) {
            if (directLayer !== null) {
                upsidePhysics.navigationHeight = directLayer;
                getUpsideCharacterVelocity(upsidePhysics.characterVelocity);
                if (Math.abs(upsidePhysics.characterVelocity.y) < 1.4) {
                    upsidePhysics.lastSafePosition.copy(position);
                    upsidePhysics.lastSafeLayer = directLayer;
                    upsidePhysics.lastSafeCell = upsideNavigationCell(position.x, position.z);
                    upsidePhysics.lastSafeContactOffset = footHeight - directLayer;
                    upsidePhysics.lastSafeSampleId = upsidePhysics.syncSampleId;
                }
            }
            upsidePhysics.airborneTime = 0;
        } else {
            upsidePhysics.airborneTime += Math.max(0, rawDt);
            if (upsidePhysics.airborneTime > 2.8) {
                recoverUpsideCharacter("airborne-time");
                getUpsideCharacterPosition(position);
            }
        }

        upsidePhysics.diagnosticTeleportPending = false;
        cameraRig.setLocalPosition(
            position.x,
            position.y + upsidePhysics.player.eyeOffset,
            position.z
        );
        return position;
    };

    var resetUpsideCharacter = function () {
        if (!upsidePhysics.character || !upsidePhysics.collisionSpawn) {
            return;
        }
        var spawn = upsidePhysics.collisionSpawn;
        var spawnLayer = findUpsideNavigationLayer(
            spawn.x,
            spawn.z,
            spawn.y - (upsidePhysics.player.height * 0.5),
            upsidePhysics.navigation.footTolerance
        );
        if (spawnLayer === null) {
            throw new Error("The scene 1 collision spawn is not in the navigation mask.");
        }
        upsidePhysics.grounded = false;
        upsidePhysics.airborneTime = 0;
        upsidePhysics.lastSafePosition.copy(spawn);
        upsidePhysics.lastSafeLayer = spawnLayer;
        upsidePhysics.lastSafeCell = upsideNavigationCell(spawn.x, spawn.z);
        upsidePhysics.lastSafeContactOffset = spawn.y -
            (upsidePhysics.player.height * 0.5) - spawnLayer;
        upsidePhysics.lastSafeSampleId = -1;
        upsidePhysics.navigationHeight = spawnLayer;
        upsidePhysics.diagnosticTeleportPending = false;
        upsidePhysics.testVelocityActive = false;
        upsidePhysics.testVelocity.set(0, 0, 0);
        warpUpsideCharacter(spawn);
        cameraRig.setLocalPosition(spawn.x, spawn.y + upsidePhysics.player.eyeOffset, spawn.z);
    };

    var updateUpsideCharacter = function (rawDt, inputVelocityX, inputVelocityZ) {
        if (!upsidePhysics.character) {
            return false;
        }
        syncUpsideCharacter(rawDt);
        if (stage.current !== "upside") {
            upsidePhysics.moveVelocity.set(0, 0, 0);
        } else if (upsidePhysics.testVelocityActive) {
            upsidePhysics.moveVelocity.copy(upsidePhysics.testVelocity);
        } else {
            upsidePhysics.moveVelocity.set(inputVelocityX, 0, inputVelocityZ);
        }

        getUpsideCharacterPosition(upsidePhysics.characterPosition);
        var fixedStep = app.systems.rigidbody.fixedTimeStep;
        var simulationTime = upsideNavigationSimulationTime(rawDt);
        constrainUpsideVelocityToNavigation(upsidePhysics.characterPosition, simulationTime);
        upsidePhysics.character.walk.setValue(
            upsidePhysics.moveVelocity.x * fixedStep,
            0,
            upsidePhysics.moveVelocity.z * fixedStep
        );
        upsidePhysics.character.controller.setWalkDirection(upsidePhysics.character.walk);
        return true;
    };

    ensureUpsideCollisionLoaded = function (onReady) {
        if (upsidePhysics.loaded) {
            if (onReady) {
                onReady(null);
            }
            return;
        }
        if (upsidePhysics.loading) {
            if (onReady) {
                upsidePhysics.callbacks.push(onReady);
            }
            return;
        }

        upsidePhysics.loading = true;
        upsidePhysics.loadError = null;
        if (onReady) {
            upsidePhysics.callbacks.push(onReady);
        }

        var finishLoad = function (error) {
            upsidePhysics.loading = false;
            upsidePhysics.loadError = error || null;
            if (error) {
                destroyUpsideCharacter();
                if (upsidePhysics.collisionRoot) {
                    upsidePhysics.collisionRoot.destroy();
                }
                upsidePhysics.navigation = null;
                upsidePhysics.collisionAsset = null;
                upsidePhysics.collisionRoot = null;
                upsidePhysics.colliderEntity = null;
                upsidePhysics.collisionSpawn = null;
            }
            var callbacks = upsidePhysics.callbacks.slice();
            upsidePhysics.callbacks.length = 0;
            for (var callbackIndex = 0; callbackIndex < callbacks.length; callbackIndex += 1) {
                callbacks[callbackIndex](upsidePhysics.loadError);
            }
        };

        Promise.all([
            loadVerifiedStorageContainerAsset(
                upsidePhysics.collisionUrl,
                "Baked_sc0_staging_00.collision.glb",
                upsidePhysics.collisionSha256,
                "Scene 1 collision file"
            ),
            loadCollisionNavigationMask(upsidePhysics.navigationUrl, upsidePhysics, "Scene 1")
        ]).then(function (assets) {
            try {
                upsidePhysics.navigation = assets[1];
                if (upsidePhysics.navigation.connectedCells !== upsidePhysics.expectedNavigationCells) {
                    throw new Error("Scene 1 navigation connected-cell count is invalid.");
                }
                createUpsideCollisionEnvironment(assets[0]);
                upsidePhysics.collisionSpawn = findNearestUpsideNavigationPoint(
                    room.layout.spawn.position.x,
                    room.layout.spawn.position.z
                );
                activateUpsideCharacter();
                resetUpsideCharacter();
                upsidePhysics.loaded = true;
                room.meshColliders = [upsidePhysics.colliderEntity];
                room.obstacles = [];
                document.body.setAttribute("data-scene1-collision", "exact-bvh-capsule");
                document.body.setAttribute("data-scene1-collision-triangles", String(upsidePhysics.triangleCount));
                document.body.setAttribute("data-scene1-navigation-cells", String(upsidePhysics.navigation.connectedCells));
                document.body.setAttribute("data-scene1-mesh-colliders", String(upsidePhysics.triangleCount));
                document.body.setAttribute("data-scene1-total-obstacles", "exact-bvh");
                document.body.setAttribute(
                    "data-scene1-collision-spawn",
                    [
                        upsidePhysics.collisionSpawn.x.toFixed(6),
                        upsidePhysics.collisionSpawn.y.toFixed(6),
                        upsidePhysics.collisionSpawn.z.toFixed(6)
                    ].join(",")
                );
                if (window.__upsideRoomSceneDebug) {
                    window.__upsideRoomSceneDebug.collision = {
                        mesh: upsidePhysics.triangleCount,
                        total: "exact-bvh",
                        navigationCells: upsidePhysics.navigation.connectedCells,
                        controller: "btKinematicCharacterController"
                    };
                }
            } catch (buildError) {
                finishLoad(buildError);
                return;
            }
            finishLoad(null);
        }, finishLoad);
    };

    app.on("destroy", destroyUpsideCharacter);

    var isStorageColliderBodyReady = function () {
        return Boolean(
            storagePhysics.colliderEntity &&
            storagePhysics.colliderEntity.rigidbody &&
            storagePhysics.colliderEntity.rigidbody.body
        );
    };

    var getStorageCharacterPosition = function (target) {
        var origin = storagePhysics.character.ghost.getWorldTransform().getOrigin();
        return target.set(origin.x(), origin.y(), origin.z());
    };

    var getStorageCharacterVelocity = function (target) {
        var linear = storagePhysics.character.controller.getLinearVelocity();
        return target.set(linear.x(), linear.y(), linear.z());
    };

    var warpStorageCharacter = function (position) {
        var character = storagePhysics.character;
        if (!character) {
            return;
        }
        character.controller.reset(character.world);
        character.warp.setValue(position.x, position.y, position.z);
        character.controller.warp(character.warp);
        character.world.updateSingleAabb(character.ghost);
        character.walk.setValue(0, 0, 0);
        character.controller.setWalkDirection(character.walk);
        storagePhysics.moveVelocity.set(0, 0, 0);
    };

    var createStorageCharacter = function () {
        if (storagePhysics.character) {
            return storagePhysics.character;
        }
        if (upsidePhysics.character) {
            throw new Error("Cannot activate both room collision controllers at once.");
        }

        var spawn = storagePhysics.collisionSpawn;
        var config = storagePhysics.player;
        var world = app.systems.rigidbody.dynamicsWorld;
        var ghostPairCallback = new Ammo.btGhostPairCallback();
        world.getBroadphase().getOverlappingPairCache().setInternalGhostPairCallback(ghostPairCallback);
        var shape = new Ammo.btCapsuleShape(config.radius, config.height - (config.radius * 2));
        var ghost = new Ammo.btPairCachingGhostObject();
        var transform = new Ammo.btTransform();
        transform.setIdentity();
        var spawnVector = new Ammo.btVector3(spawn.x, spawn.y, spawn.z);
        transform.setOrigin(spawnVector);
        ghost.setWorldTransform(transform);
        ghost.setCollisionShape(shape);
        ghost.setCollisionFlags(ghost.getCollisionFlags() | STORAGE_CHARACTER_FLAG);
        ghost.forceActivationState(pc.BODYSTATE_DISABLE_DEACTIVATION);
        world.addCollisionObject(ghost, STORAGE_CHARACTER_GROUP, 1 | 2 | 4);

        var up = new Ammo.btVector3(0, 1, 0);
        var gravity = new Ammo.btVector3(0, -16.5, 0);
        var controller = new Ammo.btKinematicCharacterController(ghost, shape, config.stepHeight, up);
        controller.setUseGhostSweepTest(false);
        controller.setGravity(gravity);
        controller.setFallSpeed(30);
        controller.setJumpSpeed(5.1);
        controller.setMaxJumpHeight(1.15);
        controller.setMaxSlope(config.maxSlope * pc.math.DEG_TO_RAD);
        controller.setMaxPenetrationDepth(0.01);
        controller.setLinearDamping(0);

        var walk = new Ammo.btVector3(0, 0, 0);
        var warp = new Ammo.btVector3(spawn.x, spawn.y, spawn.z);
        storagePhysics.character = {
            world: world,
            ghostPairCallback: ghostPairCallback,
            shape: shape,
            ghost: ghost,
            transform: transform,
            spawn: spawnVector,
            up: up,
            gravity: gravity,
            controller: controller,
            walk: walk,
            warp: warp,
            actionActive: false
        };
        return storagePhysics.character;
    };

    var activateStorageCharacter = function () {
        var character = createStorageCharacter();
        if (!character.actionActive) {
            character.world.addAction(character.controller);
            character.actionActive = true;
        }
    };

    var destroyStorageCharacter = function () {
        var character = storagePhysics.character;
        if (!character) {
            return;
        }
        storagePhysics.character = null;
        if (character.actionActive) {
            character.world.removeAction(character.controller);
        }
        character.world.removeCollisionObject(character.ghost);
        character.world.getBroadphase().getOverlappingPairCache().setInternalGhostPairCallback(null);
        Ammo.destroy(character.controller);
        Ammo.destroy(character.ghost);
        Ammo.destroy(character.shape);
        Ammo.destroy(character.transform);
        Ammo.destroy(character.spawn);
        Ammo.destroy(character.up);
        Ammo.destroy(character.gravity);
        Ammo.destroy(character.walk);
        Ammo.destroy(character.warp);
        Ammo.destroy(character.ghostPairCallback);
    };

    app.on("destroy", destroyStorageCharacter);

    var findStorageFootprintTransitionLayer = function (x, z, footHeight) {
        var navigation = storagePhysics.navigation;
        var baseHeight = findStorageNavigationLayer(x, z, storagePhysics.navigationHeight, navigation.maxLayerDelta);
        if (baseHeight === null) {
            return null;
        }

        var radius = storagePhysics.player.radius + storagePhysics.player.skin;
        var radiusSq = radius * radius;
        var minX = Math.max(0, Math.floor((x - radius - navigation.originX) / navigation.cellSize));
        var maxX = Math.min(navigation.width - 1, Math.floor((x + radius - navigation.originX) / navigation.cellSize));
        var minZ = Math.max(0, Math.floor((z - radius - navigation.originZ) / navigation.cellSize));
        var maxZ = Math.min(navigation.height - 1, Math.floor((z + radius - navigation.originZ) / navigation.cellSize));
        var best = null;
        var bestHeightDelta = Infinity;
        var bestDistanceSq = Infinity;

        for (var iz = minZ; iz <= maxZ; iz += 1) {
            var cellMinZ = navigation.originZ + (iz * navigation.cellSize);
            var cellMaxZ = cellMinZ + navigation.cellSize;
            var dz = Math.max(cellMinZ - z, 0, z - cellMaxZ);
            for (var ix = minX; ix <= maxX; ix += 1) {
                var cellMinX = navigation.originX + (ix * navigation.cellSize);
                var cellMaxX = cellMinX + navigation.cellSize;
                var dx = Math.max(cellMinX - x, 0, x - cellMaxX);
                var distanceSq = (dx * dx) + (dz * dz);
                if (distanceSq > radiusSq) {
                    continue;
                }

                var cell = (iz * navigation.width) + ix;
                for (var index = navigation.offsets[cell]; index < navigation.offsets[cell + 1]; index += 1) {
                    var height = navigation.heights[index];
                    if (Math.abs(height - baseHeight) > navigation.maxLayerDelta) {
                        continue;
                    }
                    var transitionMin = Math.min(baseHeight, height) - navigation.footTolerance;
                    var transitionMax = Math.max(baseHeight, height) + navigation.footTolerance;
                    if (footHeight < transitionMin || footHeight > transitionMax) {
                        continue;
                    }
                    var heightDelta = Math.abs(height - footHeight);
                    if (heightDelta < bestHeightDelta ||
                        (heightDelta === bestHeightDelta && distanceSq < bestDistanceSq)) {
                        best = height;
                        bestHeightDelta = heightDelta;
                        bestDistanceSq = distanceSq;
                    }
                }
            }
        }
        return best;
    };

    var storageSegmentNavigationHeight = function (x0, z0, x1, z1, startHeight) {
        var navigation = storagePhysics.navigation;
        var distance = Math.hypot(x1 - x0, z1 - z0);
        var samples = Math.max(1, Math.ceil(distance / (navigation.cellSize * 0.5)));
        var height = startHeight;
        for (var index = 1; index <= samples; index += 1) {
            var t = index / samples;
            var nextHeight = findStorageNavigationLayer(
                lerp(x0, x1, t),
                lerp(z0, z1, t),
                height,
                navigation.maxLayerDelta
            );
            if (nextHeight === null) {
                return null;
            }
            height = nextHeight;
        }
        return height;
    };

    var storageNavigationSimulationTime = function (rawDt) {
        var fixedStep = app.systems.rigidbody.fixedTimeStep;
        return Math.min(
            Math.max(0, rawDt) + fixedStep,
            fixedStep * app.systems.rigidbody.maxSubSteps
        );
    };

    var constrainStorageVelocityToNavigation = function (position, simulationTime) {
        var navigation = storagePhysics.navigation;
        var velocity = storagePhysics.moveVelocity;
        var footHeight = position.y - (storagePhysics.player.height * 0.5);
        var startHeight = storagePhysics.grounded
            ? findStorageNavigationLayer(position.x, position.z, footHeight, navigation.footTolerance)
            : findStorageNavigationLayer(position.x, position.z, storagePhysics.navigationHeight, navigation.maxLayerDelta);
        if (storagePhysics.grounded && startHeight === null) {
            startHeight = findStorageNavigationLayer(
                position.x,
                position.z,
                storagePhysics.navigationHeight,
                navigation.maxLayerDelta
            );
        }
        if (startHeight === null) {
            velocity.x = 0;
            velocity.z = 0;
            return;
        }

        var targetX = position.x + (velocity.x * simulationTime);
        var targetZ = position.z + (velocity.z * simulationTime);
        var fullHeight = storageSegmentNavigationHeight(position.x, position.z, targetX, targetZ, startHeight);
        if (fullHeight !== null) {
            storagePhysics.navigationHeight = fullHeight;
            return;
        }

        var xHeight = storageSegmentNavigationHeight(position.x, position.z, targetX, position.z, startHeight);
        var zHeight = storageSegmentNavigationHeight(position.x, position.z, position.x, targetZ, startHeight);
        var allowX = xHeight !== null;
        var allowZ = zHeight !== null;
        if (!allowX) {
            velocity.x = 0;
        }
        if (!allowZ) {
            velocity.z = 0;
        }
        if (allowX && allowZ) {
            if (Math.abs(velocity.x) >= Math.abs(velocity.z)) {
                velocity.z = 0;
                storagePhysics.navigationHeight = xHeight;
            } else {
                velocity.x = 0;
                storagePhysics.navigationHeight = zHeight;
            }
        } else if (allowX) {
            storagePhysics.navigationHeight = xHeight;
        } else if (allowZ) {
            storagePhysics.navigationHeight = zHeight;
        }
    };

    var outsideStorageSafetyBounds = function (position) {
        var min = storagePhysics.bounds.min;
        var max = storagePhysics.bounds.max;
        var margin = 0.42;
        return position.x < min.x - margin || position.x > max.x + margin ||
            position.z < min.z - margin || position.z > max.z + margin ||
            position.y < min.y - 0.8 || position.y > max.y + 0.9;
    };

    var findStrictStorageNavigationLayer = function (x, y, z) {
        if (!insideStorageNavigation(x, z)) {
            return null;
        }
        var position = storagePhysics.characterPosition.set(x, y, z);
        if (outsideStorageSafetyBounds(position)) {
            return null;
        }
        return findStorageNavigationLayer(
            x,
            z,
            y - (storagePhysics.player.height * 0.5),
            storagePhysics.navigation.footTolerance
        );
    };

    var validateStorageLastSafeLayer = function (requireFreshSample) {
        var safe = storagePhysics.lastSafePosition;
        if (!Number.isFinite(safe.x) || !Number.isFinite(safe.y) || !Number.isFinite(safe.z) ||
            !Number.isFinite(storagePhysics.lastSafeLayer) ||
            (requireFreshSample && storagePhysics.lastSafeSampleId !== storagePhysics.syncSampleId - 1) ||
            outsideStorageSafetyBounds(safe) ||
            storageNavigationCell(safe.x, safe.z) !== storagePhysics.lastSafeCell ||
            Math.abs(safe.y - (storagePhysics.player.height * 0.5) - storagePhysics.lastSafeLayer) >
                storagePhysics.navigation.footTolerance) {
            return null;
        }
        return findStorageNavigationLayer(safe.x, safe.z, storagePhysics.lastSafeLayer, 0);
    };

    var correctInvalidStorageNavigationPosition = function (position, rawDt) {
        if (storagePhysics.diagnosticTeleportPending || !storagePhysics.grounded) {
            return false;
        }
        var safeLayer = validateStorageLastSafeLayer(true);
        if (safeLayer === null) {
            return false;
        }

        var safe = storagePhysics.lastSafePosition;
        var dx = position.x - safe.x;
        var dz = position.z - safe.z;
        var distance = Math.hypot(dx, dz);
        var speed = Math.hypot(storagePhysics.moveVelocity.x, storagePhysics.moveVelocity.z);
        var reachableDistance = (speed * storageNavigationSimulationTime(rawDt)) + STORAGE_NAVIGATION_CORRECTION_GUARD;
        if (!Number.isFinite(distance) || !Number.isFinite(reachableDistance) ||
            distance <= 0 || distance > reachableDistance) {
            return false;
        }

        var navigation = storagePhysics.navigation;
        var samples = Math.max(1, Math.ceil(distance / (navigation.cellSize * 0.25)));
        var validT = 0;
        var invalidT = 1;
        var validLayer = safeLayer;
        for (var index = 1; index <= samples; index += 1) {
            var t = index / samples;
            var layer = findStorageNavigationLayer(
                safe.x + (dx * t),
                safe.z + (dz * t),
                validLayer,
                navigation.maxLayerDelta
            );
            if (layer === null) {
                invalidT = t;
                break;
            }
            validT = t;
            validLayer = layer;
        }
        if (validT >= 1) {
            return false;
        }

        for (var iteration = 0; iteration < 16; iteration += 1) {
            var midpoint = (validT + invalidT) * 0.5;
            var midpointLayer = findStorageNavigationLayer(
                safe.x + (dx * midpoint),
                safe.z + (dz * midpoint),
                validLayer,
                navigation.maxLayerDelta
            );
            if (midpointLayer !== null) {
                validT = midpoint;
                validLayer = midpointLayer;
            } else {
                invalidT = midpoint;
            }
        }

        validT = Math.max(0, validT - (STORAGE_NAVIGATION_CORRECTION_INSET / distance));
        validLayer = findStorageNavigationLayer(
            safe.x + (dx * validT),
            safe.z + (dz * validT),
            validLayer,
            navigation.maxLayerDelta
        );
        if (validLayer === null) {
            return false;
        }

        var corrected = storagePhysics.correctionPosition.set(
            safe.x + (dx * validT),
            validLayer + (storagePhysics.player.height * 0.5) + storagePhysics.lastSafeContactOffset,
            safe.z + (dz * validT)
        );
        var projectedLayer = findStrictStorageNavigationLayer(corrected.x, corrected.y, corrected.z);
        if (projectedLayer === null || projectedLayer !== validLayer) {
            return false;
        }

        storagePhysics.navigationHeight = projectedLayer;
        storagePhysics.lastSafePosition.copy(corrected);
        storagePhysics.lastSafeLayer = projectedLayer;
        storagePhysics.lastSafeCell = storageNavigationCell(corrected.x, corrected.z);
        storagePhysics.lastSafeSampleId = storagePhysics.syncSampleId;
        warpStorageCharacter(corrected);
        storagePhysics.grounded = false;
        storagePhysics.airborneTime = 0;
        storagePhysics.navigationCorrectionCount += 1;
        storagePhysics.navigationCorrectionReasons["invalid-cell"] =
            (storagePhysics.navigationCorrectionReasons["invalid-cell"] || 0) + 1;
        return true;
    };

    var recoverStorageCharacter = function (reason) {
        var safeLayer = validateStorageLastSafeLayer(false);
        var fallback = safeLayer === null ? storagePhysics.collisionSpawn : storagePhysics.lastSafePosition;
        if (safeLayer === null) {
            var spawnLayer = findStorageNavigationLayer(
                storagePhysics.collisionSpawn.x,
                storagePhysics.collisionSpawn.z,
                storagePhysics.collisionSpawn.y - (storagePhysics.player.height * 0.5),
                storagePhysics.navigation.footTolerance
            );
            storagePhysics.lastSafePosition.copy(storagePhysics.collisionSpawn);
            storagePhysics.lastSafeLayer = spawnLayer;
            storagePhysics.lastSafeCell = storageNavigationCell(storagePhysics.collisionSpawn.x, storagePhysics.collisionSpawn.z);
            storagePhysics.lastSafeContactOffset = storagePhysics.collisionSpawn.y -
                (storagePhysics.player.height * 0.5) - spawnLayer;
        }
        storagePhysics.lastSafeSampleId = -1;
        storagePhysics.navigationHeight = safeLayer === null ? storagePhysics.lastSafeLayer : safeLayer;
        warpStorageCharacter(fallback);
        storagePhysics.grounded = false;
        storagePhysics.airborneTime = 0;
        storagePhysics.recoveryCount += 1;
        storagePhysics.recoveryReasons[reason] = (storagePhysics.recoveryReasons[reason] || 0) + 1;
    };

    var syncStorageCharacter = function (rawDt) {
        storagePhysics.syncSampleId += 1;
        var position = getStorageCharacterPosition(storagePhysics.characterPosition);
        storagePhysics.grounded = storagePhysics.character.controller.onGround();
        var footHeight = position.y - (storagePhysics.player.height * 0.5);
        var directLayer = storagePhysics.grounded
            ? findStorageNavigationLayer(
                position.x,
                position.z,
                footHeight,
                storagePhysics.navigation.footTolerance
            )
            : null;
        var transitionLayer = storagePhysics.grounded && directLayer === null
            ? findStorageFootprintTransitionLayer(position.x, position.z, footHeight)
            : null;
        var navigationInside = insideStorageNavigation(position.x, position.z);
        var recoveryReason = outsideStorageSafetyBounds(position)
            ? "bounds"
            : !navigationInside
                ? "invalid-cell"
                : storagePhysics.grounded && directLayer === null && transitionLayer === null
                    ? "ground-layer"
                    : null;

        if (recoveryReason !== null) {
            var corrected = recoveryReason === "invalid-cell" &&
                correctInvalidStorageNavigationPosition(position, rawDt);
            if (!corrected) {
                recoverStorageCharacter(recoveryReason);
            }
            getStorageCharacterPosition(position);
        } else if (storagePhysics.grounded) {
            if (directLayer !== null) {
                storagePhysics.navigationHeight = directLayer;
                getStorageCharacterVelocity(storagePhysics.characterVelocity);
                if (Math.abs(storagePhysics.characterVelocity.y) < 1.4) {
                    storagePhysics.lastSafePosition.copy(position);
                    storagePhysics.lastSafeLayer = directLayer;
                    storagePhysics.lastSafeCell = storageNavigationCell(position.x, position.z);
                    storagePhysics.lastSafeContactOffset = footHeight - directLayer;
                    storagePhysics.lastSafeSampleId = storagePhysics.syncSampleId;
                }
            }
            storagePhysics.airborneTime = 0;
        } else {
            storagePhysics.airborneTime += Math.max(0, rawDt);
            if (storagePhysics.airborneTime > 2.8) {
                recoverStorageCharacter("airborne-time");
                getStorageCharacterPosition(position);
            }
        }

        storagePhysics.diagnosticTeleportPending = false;
        cameraRig.setLocalPosition(
            position.x,
            position.y + storagePhysics.player.eyeOffset,
            position.z
        );
        return position;
    };

    var resetStorageCharacter = function () {
        if (!storagePhysics.character || !storagePhysics.collisionSpawn) {
            return;
        }

        var spawn = storagePhysics.collisionSpawn;
        var spawnLayer = findStorageNavigationLayer(
            spawn.x,
            spawn.z,
            spawn.y - (storagePhysics.player.height * 0.5),
            storagePhysics.navigation.footTolerance
        );
        if (spawnLayer === null) {
            throw new Error("The storage collision spawn is not in the navigation mask.");
        }

        storagePhysics.grounded = false;
        storagePhysics.airborneTime = 0;
        storagePhysics.lastSafePosition.copy(spawn);
        storagePhysics.lastSafeLayer = spawnLayer;
        storagePhysics.lastSafeCell = storageNavigationCell(spawn.x, spawn.z);
        storagePhysics.lastSafeContactOffset = spawn.y - (storagePhysics.player.height * 0.5) - spawnLayer;
        storagePhysics.lastSafeSampleId = -1;
        storagePhysics.navigationHeight = spawnLayer;
        storagePhysics.diagnosticTeleportPending = false;
        storagePhysics.testVelocityActive = false;
        storagePhysics.testVelocity.set(0, 0, 0);
        warpStorageCharacter(spawn);
        cameraRig.setLocalPosition(spawn.x, spawn.y + storagePhysics.player.eyeOffset, spawn.z);
    };

    var updateStorageCharacter = function (rawDt, inputVelocityX, inputVelocityZ) {
        if (!storagePhysics.character) {
            return false;
        }

        syncStorageCharacter(rawDt);
        var canMove = stage.current === "storage" && !storage.failed;
        if (!canMove) {
            storagePhysics.moveVelocity.set(0, 0, 0);
        } else if (storagePhysics.testVelocityActive) {
            storagePhysics.moveVelocity.copy(storagePhysics.testVelocity);
        } else {
            storagePhysics.moveVelocity.set(inputVelocityX, 0, inputVelocityZ);
        }

        getStorageCharacterPosition(storagePhysics.characterPosition);
        constrainStorageVelocityToNavigation(
            storagePhysics.characterPosition,
            storageNavigationSimulationTime(rawDt)
        );
        var fixedStep = app.systems.rigidbody.fixedTimeStep;
        storagePhysics.character.walk.setValue(
            storagePhysics.moveVelocity.x * fixedStep,
            0,
            storagePhysics.moveVelocity.z * fixedStep
        );
        storagePhysics.character.controller.setWalkDirection(storagePhysics.character.walk);
        return true;
    };

    var syncStorageClues = function () {
        for (var clueIndex = 0; clueIndex < storage.clues.length; clueIndex += 1) {
            var clue = storage.clues[clueIndex];
            var shouldBeActive = clueIndex === storage.activeClueIndex && !clue.found && storage.purifiedCount < storage.nodes.length;
            setClueState(clue, shouldBeActive);
        }
    };

    var getBeamMetrics = function (point) {
        var origin = camera.getPosition();
        var forward = camera.forward.clone().normalize();
        var toPoint = point.clone().sub(origin);
        var axialDistance = toPoint.dot(forward);

        if (axialDistance <= 0) {
            return null;
        }

        var radialVector = toPoint.sub(forward.mulScalar(axialDistance));
        return {
            axialDistance: axialDistance,
            radialDistance: radialVector.length()
        };
    };

    var revealStorageNode = function (node) {
        if (!node || node.revealed) {
            return;
        }

        setNodeRevealState(node, true);
        showMessage(node.revealMessage || "有东西在暗处醒来了。", 4.2);
        refreshUi();
    };

    var updateStorageClueSearch = function (dt, time) {
        syncStorageClues();

        for (var clueIndex = 0; clueIndex < storage.clues.length; clueIndex += 1) {
            var clue = storage.clues[clueIndex];
            var pulse = 0.42 + (Math.sin((time * 1.8) + clue.pulseOffset) * 0.08);
            var focusGlow = clue.active ? clue.focus : 0;

            clue.pinMaterial.opacity = clue.active ? 0.58 + (focusGlow * 0.2) : 0.18;
            clue.pinMaterial.gloss = clue.active ? 0.7 : 0.3;
            clue.pinMaterial.update();

            clue.moteMaterial.opacity = clue.active ? 0.12 + (pulse * 0.12) + (focusGlow * 0.18) : 0.04;
            clue.moteMaterial.emissiveIntensity = clue.active ? 0.08 + (focusGlow * 0.6) : 0.03;
            clue.moteMaterial.update();
        }

        var activeClue = storage.clues[storage.activeClueIndex];
        if (!activeClue || activeClue.found) {
            return;
        }

        var metrics = getBeamMetrics(activeClue.point);
        if (!metrics || metrics.axialDistance > activeClue.range) {
            activeClue.focus = Math.max(0, activeClue.focus - (dt * 0.9));
            return;
        }

        var allowedRadius = activeClue.beamRadius + (metrics.axialDistance * 0.028);
        if (metrics.radialDistance > allowedRadius) {
            activeClue.focus = Math.max(0, activeClue.focus - (dt * 0.9));
            return;
        }

        var beamStrength = 1 - (metrics.radialDistance / allowedRadius);
        activeClue.focus = clamp(activeClue.focus + (dt * (0.55 + (beamStrength * 1.8))), 0, 1);

        if (activeClue.focus >= 1) {
            activeClue.found = true;
            activeClue.entity.enabled = false;
            showMessage(activeClue.message, 3.8);
            revealStorageNode(getStorageNodeById(activeClue.linkedNodeId));
            refreshUi();
        }
    };

    var ensureStorageLoaded = function (onReady) {
        if (storage.loaded) {
            if (onReady) {
                onReady(null);
            }
            return;
        }

        if (storage.loading) {
            if (onReady) {
                storage.callbacks.push(onReady);
            }
            return;
        }

        storage.loading = true;
        storage.loadError = null;
        if (onReady) {
            storage.callbacks.push(onReady);
        }

        var finishLoad = function (error) {
            storage.loading = false;
            storage.loadError = error || null;

            var callbacks = storage.callbacks.slice();
            storage.callbacks.length = 0;
            for (var callbackIndex = 0; callbackIndex < callbacks.length; callbackIndex += 1) {
                try {
                    callbacks[callbackIndex](storage.loadError);
                } catch (callbackError) {
                    window.setTimeout(function () {
                        fatal(callbackError);
                    }, 0);
                }
            }
        };

        var finalizeScene = function (sceneEntity, asset, collisionAsset, navigation) {
            storage.root = createGroup("storage-room", app.root);
            storage.root.enabled = false;
            storage.root.addChild(sceneEntity);
            storage.asset = asset || null;

            visitEntityTree(sceneEntity, function (node) {
                if (node.render && node.render.meshInstances && node.render.meshInstances.length) {
                    for (var meshIndex = 0; meshIndex < node.render.meshInstances.length; meshIndex += 1) {
                        rememberStorageMaterial(node.render.meshInstances[meshIndex].material);
                    }
                }
            });

            storagePhysics.navigation = navigation;
            createStorageCollisionEnvironment(collisionAsset);
            storagePhysics.collisionSpawn = findNearestStorageNavigationPoint(storage.spawn.x, storage.spawn.z);

            storage.wallColliders = [];
            storage.obstacles = [];
            document.body.setAttribute("data-storage-collision", "exact-bvh-capsule");
            document.body.setAttribute("data-storage-collision-triangles", String(storagePhysics.triangleCount));
            document.body.setAttribute("data-storage-navigation-cells", String(navigation.connectedCells));
            document.body.setAttribute(
                "data-storage-collision-spawn",
                [
                    storagePhysics.collisionSpawn.x.toFixed(6),
                    storagePhysics.collisionSpawn.y.toFixed(6),
                    storagePhysics.collisionSpawn.z.toFixed(6)
                ].join(",")
            );
            document.body.setAttribute("data-storage-mesh-colliders", String(storagePhysics.triangleCount));
            document.body.setAttribute("data-storage-total-obstacles", "exact-bvh");

            buildStorageGameplay();
            storage.loaded = true;
        };

        var sourceUrl = getStorageAssetUrl();
        Promise.all([
            loadStorageContainerAsset(sourceUrl, "Baked_sc1_staging_01.playcanvas.glb"),
            loadVerifiedStorageContainerAsset(
                storagePhysics.collisionUrl,
                "Baked_sc1_staging_01.collision.glb",
                storagePhysics.collisionSha256,
                "Storage collision file"
            ),
            loadStorageNavigationMask(storagePhysics.navigationUrl)
        ]).then(function (assets) {
            try {
                var asset = assets[0];
                var sceneEntity = asset.resource.instantiateRenderEntity ? asset.resource.instantiateRenderEntity() : asset.resource.instantiateModelEntity();
                finalizeScene(sceneEntity, asset, assets[1], assets[2]);
            } catch (instantiateError) {
                finishLoad(instantiateError);
                return;
            }
            finishLoad(null);
        }, finishLoad);
    };

    var resetStorageChallenge = function (keepMessage) {
        storage.timer = storage.timerLimit;
        storage.purifiedCount = 0;
        storage.activeClueIndex = 0;
        storage.keyCollected = false;
        storage.failed = false;
        storage.targetBrightness = 0;
        storage.brightness = 0;
        storage.danger = 0;
        storage.flashlightSway = 0;

        for (var nodeIndex = 0; nodeIndex < storage.nodes.length; nodeIndex += 1) {
            var node = storage.nodes[nodeIndex];
            setNodePurifiedStyle(node, false);
            setNodeRevealState(node, false);
        }

        for (var clueIndex = 0; clueIndex < storage.clues.length; clueIndex += 1) {
            var clue = storage.clues[clueIndex];
            clue.found = false;
            clue.focus = 0;
        }

        syncStorageClues();

        for (var pollutionIndex = 0; pollutionIndex < storage.pollutionZones.length; pollutionIndex += 1) {
            storage.pollutionZones[pollutionIndex].active = true;
        }

        if (storage.finalKey) {
            storage.finalKey.collected = false;
            storage.finalKey.entity.enabled = false;
        }

        game.currentTarget = null;
        setPrompt("", false);

        player.yaw = 142;
        player.pitch = -7;
        snapCameraLook();
        if (storage.active && storagePhysics.character) {
            resetStorageCharacter();
        } else {
            cameraRig.setLocalPosition(storage.spawn.x, room.floorY + 1.62, storage.spawn.z);
        }

        if (!keepMessage) {
            showMessage("储藏室重新收紧了黑暗。三分钟，从头再来。", 4.2);
        }

        refreshUi();
    };

    var failStorageChallenge = function () {
        if (storage.failed) {
            return;
        }

        storage.failed = true;
        storage.timer = 0;
        storage.targetBrightness = 0;
        storage.danger = 1;
        game.currentTarget = null;
        game.activeMessage = "";
        game.activeMessageTimer = 0;
        setPrompt("", false);
        refreshUi();
    };

    var restartStorageChallenge = function () {
        resetStorageChallenge(true);
        showMessage("梦又回到了开头。跟着手电，再试一次。", 4.2);
        refreshUi();
    };

    var activateStorageRoom = function () {
        if (!storage.loaded || !storage.root) {
            return;
        }

        destroyUpsideCharacter();
        if (upsidePhysics.collisionRoot) {
            upsidePhysics.collisionRoot.enabled = false;
        }

        if (room.container) {
            room.container.enabled = false;
        }

        if (room.mirrorCamera) {
            room.mirrorCamera.enabled = false;
        }

        storage.root.enabled = true;
        storage.active = true;
        room.bounds = storage.bounds;
        room.obstacles = storage.obstacles;
        room.floorY = storage.floorY;
        activateStorageCharacter();

        mode.target = 1;
        mode.current = 1;

        resetStorageChallenge(true);
        showMessage("向日葵完整之后，四周像灰一样散开了。你落进了储藏室的中心。", 4.8);
        refreshUi();
    };

    var restoreUpsideRoomAfterStorageError = function (error) {
        console.error(error);
        storage.active = false;
        if (storage.root) {
            storage.root.enabled = false;
        }
        destroyStorageCharacter();

        if (upsidePhysics.collisionRoot) {
            upsidePhysics.collisionRoot.enabled = true;
        }

        var snapshot = stage.upsideRoomSnapshot;
        if (snapshot) {
            if (room.container) {
                room.container.enabled = snapshot.containerEnabled;
            }
            if (room.mirrorCamera) {
                room.mirrorCamera.enabled = snapshot.mirrorCameraEnabled;
            }
            room.bounds = snapshot.bounds;
            room.obstacles = snapshot.obstacles;
            room.floorY = snapshot.floorY;
            mode.target = snapshot.modeTarget;
            mode.current = snapshot.modeCurrent;
            player.yaw = snapshot.playerYaw;
            player.pitch = snapshot.playerPitch;
            cameraRig.setLocalPosition(snapshot.cameraPosition);
            snapCameraLook();

            if (upsidePhysics.loaded) {
                var restoredCenter = snapshot.upsideCharacterPosition || upsidePhysics.collisionSpawn;
                var restoredLayer = findUpsideNavigationLayer(
                    restoredCenter.x,
                    restoredCenter.z,
                    restoredCenter.y - (upsidePhysics.player.height * 0.5),
                    upsidePhysics.navigation.footTolerance
                );
                if (restoredLayer === null) {
                    restoredCenter = upsidePhysics.collisionSpawn;
                    restoredLayer = findUpsideNavigationLayer(
                        restoredCenter.x,
                        restoredCenter.z,
                        restoredCenter.y - (upsidePhysics.player.height * 0.5),
                        upsidePhysics.navigation.footTolerance
                    );
                }
                activateUpsideCharacter(restoredCenter);
                upsidePhysics.lastSafePosition.copy(restoredCenter);
                upsidePhysics.lastSafeLayer = restoredLayer;
                upsidePhysics.lastSafeCell = upsideNavigationCell(restoredCenter.x, restoredCenter.z);
                upsidePhysics.lastSafeContactOffset = restoredCenter.y -
                    (upsidePhysics.player.height * 0.5) - restoredLayer;
                upsidePhysics.lastSafeSampleId = -1;
                upsidePhysics.navigationHeight = restoredLayer;
                upsidePhysics.grounded = false;
                upsidePhysics.airborneTime = 0;
                upsidePhysics.diagnosticTeleportPending = false;
                upsidePhysics.testVelocityActive = false;
                upsidePhysics.testVelocity.set(0, 0, 0);
            }
        }

        stage.current = "upside";
        stage.transitionPhase = "idle";
        stage.transitionElapsed = 0;
        stage.fade = 0;
        stage.fadeDirection = 0;
        stage.switchedRoom = false;
        stage.transitionQueued = false;
        stage.transitionCameraVector = null;
        stage.upsideRoomSnapshot = null;
        if (room.container) {
            room.container.setLocalEulerAngles(180, 0, 0);
        }
        game.currentTarget = null;
        setPrompt("", false);
        if (fadeOverlay) {
            fadeOverlay.style.opacity = "0";
            fadeOverlay.classList.remove("fade-overlay--white");
            fadeOverlay.classList.add("fade-overlay--hidden");
        }
        if (transitionMessage) {
            transitionMessage.textContent = "";
        }
        showMessage("储藏室暂时没有显形，房间把你留在了原处。", 4.5);
        refreshUi();
    };

    var getUpsideRoomFlipAngle = function (progress) {
        var t = clamp(progress, 0, 1);
        var eased = t * t * (3 - (2 * t));
        return lerp(180, 0, eased);
    };

    var rotateAroundX = function (point, degrees) {
        var radians = degrees * pc.math.DEG_TO_RAD;
        var cos = Math.cos(radians);
        var sin = Math.sin(radians);
        return vec3(
            point.x,
            (point.y * cos) - (point.z * sin),
            (point.y * sin) + (point.z * cos)
        );
    };

    var setUpsideRoomFlipProgress = function (progress) {
        var angle = getUpsideRoomFlipAngle(progress);

        if (room.container) {
            room.container.setLocalEulerAngles(angle, 0, 0);
        }

        if (stage.transitionCameraVector) {
            var pivot = vec3(0, room.flipHeight * 0.5, 0);
            var cameraOffset = rotateAroundX(stage.transitionCameraVector, angle);
            cameraRig.setLocalPosition(
                pivot.x + cameraOffset.x,
                pivot.y + cameraOffset.y,
                pivot.z + cameraOffset.z
            );
        }
    };

    var showTransitionWhiteScreen = function (visible) {
        if (!fadeOverlay) {
            return;
        }

        fadeOverlay.classList.toggle("fade-overlay--white", visible);
        fadeOverlay.classList.toggle("fade-overlay--hidden", !visible);
        if (!visible) {
            fadeOverlay.style.opacity = "0";
        }
        if (transitionMessage) {
            transitionMessage.textContent = visible
                ? "当三次错误被看见，向日葵终于记起太阳。\n可太阳背后，还有一间没有窗的屋子。"
                : "";
        }
    };

    var startStorageTransition = function () {
        if (stage.current !== "upside") {
            return;
        }

        stage.upsideRoomSnapshot = {
            containerEnabled: room.container ? room.container.enabled : false,
            mirrorCameraEnabled: room.mirrorCamera ? room.mirrorCamera.enabled : false,
            bounds: room.bounds,
            obstacles: room.obstacles,
            floorY: room.floorY,
            modeTarget: mode.target,
            modeCurrent: mode.current,
            playerYaw: player.yaw,
            playerPitch: player.pitch,
            cameraPosition: cameraRig.getLocalPosition().clone(),
            upsideCharacterPosition: upsidePhysics.character
                ? getUpsideCharacterPosition(upsidePhysics.characterPosition).clone()
                : null
        };
        stage.transitionQueued = false;
        stage.current = "transition";
        stage.transitionPhase = "flip";
        stage.transitionElapsed = 0;
        stage.fade = 0;
        stage.fadeDirection = 0;
        stage.switchedRoom = false;
        stage.transitionCameraVector = rotateAroundX(
            cameraRig.getLocalPosition().clone().sub(vec3(0, room.flipHeight * 0.5, 0)),
            -180
        );
        if (upsidePhysics.character) {
            upsidePhysics.character.walk.setValue(0, 0, 0);
            upsidePhysics.character.controller.setWalkDirection(upsidePhysics.character.walk);
            upsidePhysics.moveVelocity.set(0, 0, 0);
        }
        game.currentTarget = null;
        setPrompt("", false);
        setUpsideRoomFlipProgress(0);
        showTransitionWhiteScreen(false);
        refreshUi();
    };

    var purifyStorageNode = function (node) {
        if (!node || node.purified || !node.revealed) {
            return;
        }

        setNodePurifiedStyle(node, true);
        storage.purifiedCount += 1;
        game.currentTarget = null;
        setPrompt("", false);

        if (storage.purifiedCount >= storage.nodes.length) {
            storage.targetBrightness = 1;
            for (var i = 0; i < storage.pollutionZones.length; i += 1) {
                storage.pollutionZones[i].active = false;
            }
            if (storage.finalKey) {
                storage.finalKey.entity.enabled = true;
            }
            showMessage("三个净化节点都亮了。储藏室终于肯把光还给你，最终钥匙出现在房间中心。", 5.2);
        } else {
            storage.activeClueIndex = Math.min(storage.activeClueIndex + 1, storage.clues.length - 1);
            syncStorageClues();
            showMessage(node.message, 3.6);
        }

        refreshUi();
    };

    var collectStorageKey = function () {
        if (!storage.finalKey || storage.keyCollected || !storage.finalKey.entity.enabled) {
            return;
        }

        storage.keyCollected = true;
        storage.finalKey.collected = true;
        storage.finalKey.entity.enabled = false;
        storage.targetBrightness = 1;
        game.currentTarget = null;
        setPrompt("", false);
        showMessage("日照钥匙落进你的掌心。储藏室第一次像清晨一样安静。", 5.6);
        refreshUi();
        window.dispatchEvent(new CustomEvent("upside-room-key-collected", {
            detail: { keyId: "sun-key" }
        }));
    };

    var findStorageTarget = function () {
        var bestScore = -999;
        var bestTarget = null;

        for (var nodeIndex = 0; nodeIndex < storage.nodes.length; nodeIndex += 1) {
            var node = storage.nodes[nodeIndex];
            if (node.purified || !node.revealed || !node.entity.enabled) {
                continue;
            }

            var nodeMetrics = getBeamMetrics(node.point);
            if (!nodeMetrics || nodeMetrics.axialDistance > node.range) {
                continue;
            }

            var nodeBeamRadius = node.beamRadius + (nodeMetrics.axialDistance * 0.045);
            if (nodeMetrics.radialDistance > nodeBeamRadius) {
                continue;
            }

            var nodeScore = (1 - (nodeMetrics.radialDistance / nodeBeamRadius)) + ((node.range - nodeMetrics.axialDistance) * 0.02);
            if (nodeScore > bestScore) {
                bestScore = nodeScore;
                bestTarget = {
                    type: "node",
                    ref: node
                };
            }
        }

        if (storage.finalKey && storage.finalKey.entity.enabled && !storage.keyCollected) {
            var keyMetrics = getBeamMetrics(storage.finalKey.point);
            if (keyMetrics && keyMetrics.axialDistance <= storage.finalKey.range) {
                var keyBeamRadius = 0.24 + (keyMetrics.axialDistance * 0.04);
                if (keyMetrics.radialDistance <= keyBeamRadius) {
                    var keyScore = (1 - (keyMetrics.radialDistance / keyBeamRadius)) + ((storage.finalKey.range - keyMetrics.axialDistance) * 0.02);
                    if (keyScore > bestScore) {
                        bestTarget = {
                            type: "key",
                            ref: storage.finalKey
                        };
                    }
                }
            }
        }

        return bestTarget;
    };

    var updateStorageInteraction = function () {
        game.currentTarget = null;

        if (!storage.active || stage.current !== "storage" || storage.failed) {
            setPrompt("", false);
            return;
        }

        var activeClue = storage.clues[storage.activeClueIndex];
        if (activeClue && !activeClue.found) {
            var clueMetrics = getBeamMetrics(activeClue.point);
            if (clueMetrics && clueMetrics.axialDistance <= activeClue.range) {
                var clueBeamRadius = activeClue.beamRadius + (clueMetrics.axialDistance * 0.03);
                if (clueMetrics.radialDistance <= clueBeamRadius * 1.45) {
                    setPrompt("把手电稳在光痕上，它会慢慢显影。\n" + activeClue.hint, true);
                } else {
                    setPrompt(activeClue.hint, true);
                }
            } else {
                setPrompt(activeClue.hint, true);
            }
        }

        var target = findStorageTarget();
        if (!target) {
            return;
        }

        game.currentTarget = target.ref;
        var promptText = "[E] " + target.ref.label;
        if (target.ref.description) {
            promptText += "\n" + target.ref.description;
        }
        setPrompt(promptText, true);

        if (app.keyboard.wasPressed(pc.KEY_E)) {
            if (target.type === "node") {
                purifyStorageNode(target.ref);
            } else {
                collectStorageKey();
            }
        }
    };

    var updateStageFlow = function (dt, time) {
        if (stage.transitionQueued && stage.current === "upside") {
            stage.transitionDelay = Math.max(0, stage.transitionDelay - dt);
            if (stage.transitionDelay === 0) {
                startStorageTransition();
            }
        }

        if (stage.current === "transition") {
            if (stage.transitionPhase === "flip") {
                stage.transitionElapsed = Math.min(stage.flipDuration, stage.transitionElapsed + dt);
                setUpsideRoomFlipProgress(stage.transitionElapsed / stage.flipDuration);

                if (stage.transitionElapsed >= stage.flipDuration) {
                    stage.transitionPhase = "white";
                    stage.transitionElapsed = 0;
                    stage.fade = 1;
                    showTransitionWhiteScreen(true);
                    refreshUi();
                }
            } else if (stage.transitionPhase === "white") {
                stage.transitionElapsed = Math.min(stage.whiteHoldDuration, stage.transitionElapsed + dt);
                stage.fade = 1;

                if (stage.transitionElapsed >= stage.whiteHoldDuration && !stage.switchedRoom) {
                    stage.transitionPhase = "loading";
                    ensureStorageLoaded(function (error) {
                        if (stage.current !== "transition") {
                            return;
                        }

                        if (error) {
                            restoreUpsideRoomAfterStorageError(error);
                            return;
                        }

                        try {
                            stage.switchedRoom = true;
                            activateStorageRoom();
                        } catch (activationError) {
                            restoreUpsideRoomAfterStorageError(activationError);
                            return;
                        }

                        stage.current = "storage";
                        stage.transitionPhase = "idle";
                        stage.transitionElapsed = 0;
                        stage.fade = 0;
                        stage.fadeDirection = 0;
                        stage.transitionCameraVector = null;
                        stage.upsideRoomSnapshot = null;
                        showTransitionWhiteScreen(false);
                        refreshUi();
                        showStorageRoomIntro();
                    });
                }
            } else if (stage.transitionPhase === "loading") {
                stage.fade = 1;
            }
        }

        if (updatePauseGate()) {
            return;
        }

        if (storage.active) {
            storage.brightness += (storage.targetBrightness - storage.brightness) * Math.min(1, dt * 1.6);
            updateStorageClueSearch(dt, time);

            var playerPosition = cameraRig.getLocalPosition();
            var pollutionPressure = 0;

            for (var pollutionIndex = 0; pollutionIndex < storage.pollutionZones.length; pollutionIndex += 1) {
                var zone = storage.pollutionZones[pollutionIndex];
                var radiusTarget = zone.active ? zone.baseRadius + (Math.sin((time * zone.speed) + zone.pulseOffset) * zone.expand) : 0.02;
                zone.radius += (radiusTarget - zone.radius) * Math.min(1, dt * 3.5);

                zone.shell.setLocalScale(zone.radius * 1.9, 0.42 + (zone.radius * 0.18), zone.radius * 1.9);
                zone.ring.setLocalScale(zone.radius * 2.1, 0.05, zone.radius * 2.1);

                var pollutionGlow = zone.active ? 1 - (storage.brightness * 0.72) : 0;
                zone.mistMaterial.opacity = zone.active ? (0.16 + (Math.sin((time * zone.speed * 1.8) + zone.pulseOffset) * 0.03)) * pollutionGlow : 0.02;
                zone.mistMaterial.emissiveIntensity = zone.active ? 0.28 + (pollutionGlow * 0.24) : 0.04;
                zone.mistMaterial.update();
                zone.ringMaterial.opacity = zone.active ? 0.22 * pollutionGlow : 0.02;
                zone.ringMaterial.emissiveIntensity = zone.active ? 0.42 + (pollutionGlow * 0.24) : 0.06;
                zone.ringMaterial.update();

                zone.entity.enabled = zone.radius > 0.04;

                if (!zone.active || storage.purifiedCount >= storage.nodes.length) {
                    continue;
                }

                var dx = playerPosition.x - zone.center.x;
                var dz = playerPosition.z - zone.center.z;
                var distance = Math.sqrt((dx * dx) + (dz * dz));
                if (distance < zone.radius) {
                    pollutionPressure = Math.max(pollutionPressure, 1 - (distance / zone.radius));
                }
            }

            for (var nodeVisualIndex = 0; nodeVisualIndex < storage.nodes.length; nodeVisualIndex += 1) {
                var nodeVisual = storage.nodes[nodeVisualIndex];
                if (!nodeVisual.revealed && !nodeVisual.purified) {
                    continue;
                }
                var pulse = 0.72 + (Math.sin((time * 2.4) + nodeVisual.pulseOffset) * 0.18);
                nodeVisual.coreMaterial.emissiveIntensity = nodeVisual.purified ? 0.18 + (pulse * 0.06) : 0.34 + (pulse * 0.18);
                nodeVisual.coreMaterial.update();
                nodeVisual.auraMaterial.opacity = nodeVisual.purified ? 0.08 : 0.1 + (pulse * 0.05);
                nodeVisual.auraMaterial.emissiveIntensity = nodeVisual.purified ? 0.14 : 0.24 + (pulse * 0.12);
                nodeVisual.auraMaterial.update();
            }

            if (storage.finalKey) {
                storage.finalKey.entity.setLocalEulerAngles(0, (time * 34) % 360, 0);
                storage.finalKey.auraMaterial.opacity = storage.finalKey.entity.enabled ? 0.12 + (Math.sin(time * 2.8) * 0.03) : 0.02;
                storage.finalKey.auraMaterial.emissiveIntensity = storage.finalKey.entity.enabled ? 0.28 + (Math.sin(time * 2.8) * 0.08) : 0.04;
                storage.finalKey.auraMaterial.update();
            }

            if (storage.purifiedCount < storage.nodes.length && !storage.keyCollected && stage.current === "storage") {
                storage.timer = Math.max(0, storage.timer - (dt * (1 + (pollutionPressure * 1.9))));
                if (storage.timer === 0) {
                    failStorageChallenge();
                }
            }

            storage.danger = pollutionPressure > 0 ? clamp(storage.danger + (dt * 2.5), 0, 1) : clamp(storage.danger - (dt * 1.8), 0, 1);

            if (storageTimer) {
                storageTimer.textContent = formatStorageTime(storage.timer);
            }
        }
    };

    updateObjective = function () {
        if (stage.current === "upside" || (stage.current === "transition" && !stage.switchedRoom)) {
            objective.textContent = "异常物件 " + game.foundCount + " / 3";
            return;
        }

        if (storage.keyCollected) {
            objective.textContent = "最终钥匙 1 / 1";
            return;
        }

        if (storage.finalKey && storage.finalKey.entity.enabled) {
            objective.textContent = "最终钥匙 0 / 1";
            return;
        }

        objective.textContent = "净化节点 " + storage.purifiedCount + " / 3";
    };

    getBaseHint = function () {
        if (stage.current === "transition") {
            return stage.transitionPhase === "flip"
                ? "倒置房间正在翻回原本的方向。"
                : "向日葵终于记起太阳。";
        }

        if (stage.current === "storage") {
            if (storage.keyCollected) {
                return "最终钥匙已经到手。储藏室终于像清晨一样，不再继续做梦。";
            }

            if (storage.finalKey && storage.finalKey.entity.enabled) {
                return "净化完成。去房间中心拾起最终钥匙。";
            }

            if (storage.timer <= 30) {
                return "污染快要追上你了。顺着手电的亮斑，去找最后的净化节点。";
            }

            return "跟着手电看清路径，找到 3 个净化节点，别让扩散污染把时间吞掉。";
        }

        if (!room.loaded) {
            return "房间正在稳定下来……";
        }

        if (game.foundCount >= 3) {
            return "当三次错误被看见，向日葵会替你打开出口。";
        }

        if (mode.target === 0) {
            return "白昼替世界整理好表情。";
        }

        if (game.foundCount === 0) {
            return "黑暗才肯承认，哪里多留下了一样东西。";
        }

        if (game.foundCount === 1) {
            return "向日葵已经找回一角，剩下的错位正在慢慢松动。";
        }

        return "再看一处，照片就会完整。";
    };

    refreshHint = function () {
        hint.textContent = game.activeMessageTimer > 0 ? game.activeMessage : getBaseHint();
    };

    refreshUi = function () {
        var isUpsideRoom = stage.current === "upside" || (stage.current === "transition" && !stage.switchedRoom);
        var showStorageHud = storage.active || (stage.current === "transition" && stage.switchedRoom);

        eyebrow.textContent = isUpsideRoom ? "第二重梦 · 记忆" : "第三重梦 · 恐惧";
        title.textContent = isUpsideRoom ? "倒置房间" : "储藏室";
        copy.textContent = isUpsideRoom
            ? "白昼会整理表象，阴影才承认哪里多出了一件东西。"
            : "跟随手电的光，找到并净化三道仍在扩散的噩梦。";

        modePill.textContent = isUpsideRoom ? mode.names[mode.target] : (storage.keyCollected ? "钥匙已得" : "储藏室");
        toggleButton.textContent = "切换明暗";
        toggleButton.classList.toggle("toggle--hidden", !isUpsideRoom);

        document.body.classList.toggle("shadow-mode", isUpsideRoom && mode.target === 1);
        document.body.classList.toggle("storage-mode", !isUpsideRoom);

        if (storageHud) {
            storageHud.classList.toggle("storage-hud--hidden", !showStorageHud);
        }
        if (storagePoem) {
            storagePoem.innerHTML = "储藏室是光的茧，手电是破茧的针。<br>污染不是脏，是未散的噩梦。";
        }
        if (storageTimer) {
            storageTimer.textContent = formatStorageTime(storage.timer);
        }
        if (storageStatus) {
            storageStatus.textContent = storage.keyCollected
                ? "最终钥匙 已获得"
                : (storage.finalKey && storage.finalKey.entity.enabled ? "最终钥匙 已出现" : ("净化节点 " + storage.purifiedCount + " / 3"));
        }

        updateObjective();
        refreshHint();
    };

    toggleMode = function () {
        if (isGameShellPaused() || pauseState.waitForRelease || stage.current !== "upside") {
            return;
        }
        mode.target = mode.target === 0 ? 1 : 0;
        refreshUi();
    };

    collectAnomaly = function (anomaly) {
        baseCollectAnomaly(anomaly);

        if (stage.current === "upside" && game.foundCount >= 3 && !stage.transitionQueued) {
            stage.transitionQueued = true;
            stage.transitionDelay = 1.6;
            showMessage("当三次错误被看见，向日葵替你把房间剥成了另一层梦。", 4.8);
            refreshUi();
        }
    };

    moveWithCollision = function (position, dx, dz) {
        if (stage.current === "transition") {
            return {
                x: position.x,
                z: position.z
            };
        }
        return baseMoveWithCollision(position, dx, dz);
    };

    syncMirrorCamera = function () {
        if (stage.current !== "upside") {
            return;
        }
        baseSyncMirrorCamera();
    };

    updateModeLook = function (t, time) {
        if (storage.active || (stage.current === "transition" && stage.switchedRoom)) {
            var darkAmbient = rgb(12, 14, 20);
            var brightAmbient = rgb(206, 210, 204);
            lerpColor(app.scene.ambientLight, darkAmbient, brightAmbient, storage.brightness);
            app.scene.exposure = lerp(0.42, 0.96, storage.brightness);

            sunLight.light.intensity = lerp(0.01, 0.76, storage.brightness);
            lerpColor(sunLight.light.color, rgb(134, 146, 174), rgb(255, 238, 214), storage.brightness);
            coolFillLight.light.intensity = lerp(0.04, 0.26, storage.brightness);
            lampLight.light.intensity = lerp(0.02, 0.18, storage.brightness);
            flashlight.light.intensity = lerp(2.8, 0.48, storage.brightness);

            for (var materialIndex = 0; materialIndex < storage.materials.length; materialIndex += 1) {
                var storageMaterial = storage.materials[materialIndex];
                var storageBase = storageMaterial._storageBaseDiffuse || storageMaterial.diffuse;
                var darkFactor = lerp(0.12, 1, storage.brightness);
                storageMaterial.diffuse.set(
                    storageBase.r * darkFactor,
                    storageBase.g * darkFactor,
                    storageBase.b * darkFactor
                );
                storageMaterial.update();
            }

            if (dangerOverlay) {
                dangerOverlay.style.opacity = (0.08 + (storage.danger * 0.4)).toFixed(3);
            }
            if (fadeOverlay) {
                fadeOverlay.style.opacity = stage.fade.toFixed(3);
                fadeOverlay.classList.toggle("fade-overlay--hidden", stage.fade <= 0.01);
            }
            return;
        }

        flashlight.light.intensity = 0;
        if (dangerOverlay) {
            dangerOverlay.style.opacity = "0";
        }
        if (fadeOverlay) {
            fadeOverlay.style.opacity = stage.fade.toFixed(3);
            fadeOverlay.classList.toggle("fade-overlay--hidden", stage.fade <= 0.01);
        }

        updateUpsideRoomLook(t, time);
    };

    updateAnomalyPrompt = function () {
        if (storage.active || stage.current === "transition") {
            updateStorageInteraction();
            return;
        }
        updateUpsideRoomPrompt();
    };

    revealStorageNode = function (node) {
        if (!node || node.revealed) {
            return;
        }
        setNodeRevealState(node, true);
        refreshUi();
    };

    updateStorageClueSearch = function (dt, time) {
        syncStorageClues();

        for (var clueIndex = 0; clueIndex < storage.clues.length; clueIndex += 1) {
            var clue = storage.clues[clueIndex];
            var pulse = 0.4 + (Math.sin((time * 1.9) + clue.pulseOffset) * 0.08);
            var focusGlow = clue.active ? clue.focus : 0;

            clue.pinMaterial.opacity = clue.active ? 0.42 + (focusGlow * 0.26) : 0.1;
            clue.pinMaterial.gloss = clue.active ? 0.68 : 0.26;
            clue.pinMaterial.update();

            clue.moteMaterial.opacity = clue.active ? 0.1 + (pulse * 0.1) + (focusGlow * 0.2) : 0.03;
            clue.moteMaterial.emissiveIntensity = clue.active ? 0.06 + (focusGlow * 0.72) : 0.02;
            clue.moteMaterial.update();
        }

        var activeClue = storage.clues[storage.activeClueIndex];
        if (!activeClue || activeClue.found) {
            return;
        }

        var metrics = getBeamMetrics(activeClue.point);
        if (!metrics || metrics.axialDistance > activeClue.range) {
            activeClue.focus = Math.max(0, activeClue.focus - (dt * 0.85));
            return;
        }

        var allowedRadius = activeClue.beamRadius + (metrics.axialDistance * 0.032);
        if (metrics.radialDistance > allowedRadius) {
            activeClue.focus = Math.max(0, activeClue.focus - (dt * 0.85));
            return;
        }

        var beamStrength = 1 - (metrics.radialDistance / allowedRadius);
        activeClue.focus = clamp(activeClue.focus + (dt * (0.6 + (beamStrength * 2))), 0, 1);

        if (activeClue.focus >= 1) {
            activeClue.found = true;
            activeClue.entity.enabled = false;
            revealStorageNode(getStorageNodeById(activeClue.linkedNodeId));
            showMessage(activeClue.message, 4.1);
            refreshUi();
        }
    };

    updateStorageInteraction = function () {
        game.currentTarget = null;

        if (!storage.active || stage.current !== "storage") {
            setPrompt("", false);
            return;
        }

        var activeClue = storage.clues[storage.activeClueIndex];
        var target = findStorageTarget();

        if (target) {
            game.currentTarget = target.ref;
            var promptText = "[E] " + target.ref.label;
            if (target.ref.description) {
                promptText += "\n" + target.ref.description;
            }
            setPrompt(promptText, true);

            if (app.keyboard.wasPressed(pc.KEY_E)) {
                if (target.type === "node") {
                    purifyStorageNode(target.ref);
                } else {
                    collectStorageKey();
                }
            }
            return;
        }

        if (activeClue && !activeClue.found) {
            var clueMetrics = getBeamMetrics(activeClue.point);
            if (clueMetrics && clueMetrics.axialDistance <= activeClue.range) {
                var clueBeamRadius = activeClue.beamRadius + (clueMetrics.axialDistance * 0.032);
                if (clueMetrics.radialDistance <= clueBeamRadius * 1.4) {
                    setPrompt("把手电稳在这道光痕上，它会慢慢显影。\n" + activeClue.hint, true);
                    return;
                }
            }
            setPrompt(activeClue.hint, true);
            return;
        }

        setPrompt("", false);
    };

    updateObjective = function () {
        if (stage.current === "upside" || (stage.current === "transition" && !stage.switchedRoom)) {
            objective.textContent = "异常物件 " + game.foundCount + " / 3";
            return;
        }

        if (storage.keyCollected) {
            objective.textContent = "最终钥匙 1 / 1";
            return;
        }

        if (storage.finalKey && storage.finalKey.entity.enabled) {
            objective.textContent = "最终钥匙 0 / 1";
            return;
        }

        var activeClue = storage.clues[storage.activeClueIndex];
        if (activeClue && !activeClue.found) {
            objective.textContent = "光痕 " + (storage.activeClueIndex + 1) + " / 3";
            return;
        }

        objective.textContent = "净化节点 " + storage.purifiedCount + " / 3";
    };

    getBaseHint = function () {
        if (stage.current === "transition") {
            return stage.transitionPhase === "flip"
                ? "倒置房间正在翻回原本的方向。"
                : "向日葵终于记起太阳。";
        }

        if (stage.current === "storage") {
            if (storage.keyCollected) {
                return "最终钥匙已经到手。储藏室终于像清晨一样安静，不再继续做梦。";
            }

            if (storage.finalKey && storage.finalKey.entity.enabled) {
                return "三枚节点都被净化了。去房间中心拿起最终钥匙。";
            }

            if (storage.timer <= 30) {
                return "污染快追上你了。别站在红色蔓延里，顺着手电尽快完成最后一步。";
            }

            var activeClue = storage.clues[storage.activeClueIndex];
            if (activeClue && !activeClue.found) {
                return "房间只是昏暗，不是全黑。先用手电沿着柜边、墙缝和门侧慢慢扫，把这道光痕照出来。";
            }

            return "节点已经醒来。靠近后按 E 净化它，再去追下一道藏起来的光。";
        }

        if (!room.loaded) {
            return "房间正在稳定下来……";
        }

        if (game.foundCount >= 3) {
            return "当三次错误被看见，向日葵会替你打开出口。";
        }

        if (mode.target === 0) {
            return "白昼替世界整理好表情。";
        }

        if (game.foundCount === 0) {
            return "黑暗才肯承认，哪里多留下了一样东西。";
        }

        if (game.foundCount === 1) {
            return "向日葵已经找回一角，剩下的错位正在慢慢松动。";
        }

        return "再看一处，照片就会完整。";
    };

    refreshUi = function () {
        var isUpsideRoom = stage.current === "upside" || (stage.current === "transition" && !stage.switchedRoom);
        var showStorageHud = storage.active || (stage.current === "transition" && stage.switchedRoom);
        var activeClue = storage.clues[storage.activeClueIndex];

        eyebrow.textContent = isUpsideRoom ? "第二重梦 · 记忆" : "第三重梦 · 恐惧";
        title.textContent = isUpsideRoom ? "倒置房间" : "储藏室";
        copy.textContent = isUpsideRoom
            ? "白昼会整理表象，阴影才承认哪里多出了一件东西。"
            : "跟随手电的光，找到并净化三道仍在扩散的噩梦。";

        modePill.textContent = isUpsideRoom ? mode.names[mode.target] : (storage.keyCollected ? "钥匙已得" : "储藏室");
        toggleButton.textContent = "切换明暗";
        toggleButton.classList.toggle("toggle--hidden", !isUpsideRoom);

        document.body.classList.toggle("shadow-mode", isUpsideRoom && mode.target === 1);
        document.body.classList.toggle("storage-mode", !isUpsideRoom);

        if (storageHud) {
            storageHud.classList.toggle("storage-hud--hidden", !showStorageHud);
        }
        if (storagePoem) {
            storagePoem.innerHTML = "储藏室是光的茧，手电是破茧的针。<br>污染不是脏，是未散的噩梦。";
        }
        if (storageTimer) {
            storageTimer.textContent = formatStorageTime(storage.timer);
        }
        if (storageStatus) {
            if (storage.keyCollected) {
                storageStatus.textContent = "最终钥匙 已获得";
            } else if (storage.finalKey && storage.finalKey.entity.enabled) {
                storageStatus.textContent = "最终钥匙 已出现";
            } else if (activeClue && !activeClue.found) {
                storageStatus.textContent = "追踪 " + activeClue.label;
            } else {
                storageStatus.textContent = "净化节点 " + storage.purifiedCount + " / 3";
            }
        }

        updateObjective();
        refreshHint();
    };

    updateModeLook = function (t, time) {
        if (storage.active || (stage.current === "transition" && stage.switchedRoom)) {
            var darkAmbient = rgb(38, 42, 50);
            var brightAmbient = rgb(206, 210, 204);
            var retireFlashlight = storage.targetBrightness >= 0.99;
            var flashlightFade = retireFlashlight
                ? clamp((0.96 - storage.brightness) / 0.18, 0, 1)
                : 1;
            lerpColor(app.scene.ambientLight, darkAmbient, brightAmbient, storage.brightness);
            app.scene.exposure = lerp(0.74, 0.98, storage.brightness);

            sunLight.light.intensity = lerp(0.08, 0.76, storage.brightness);
            lerpColor(sunLight.light.color, rgb(128, 136, 154), rgb(255, 238, 214), storage.brightness);
            coolFillLight.light.intensity = lerp(0.12, 0.26, storage.brightness);
            lampLight.light.intensity = lerp(0.05, 0.18, storage.brightness);

            flashlight.light.innerConeAngle = 12;
            flashlight.light.outerConeAngle = 22;
            flashlight.light.range = lerp(13.5, 9.5, storage.brightness);
            flashlight.light.intensity = lerp(5.4, 0.56, storage.brightness) * flashlightFade;

            flashlightLensMaterial.emissiveIntensity = lerp(0.28, 0.12, storage.brightness) * flashlightFade;
            flashlightLensMaterial.update();
            if (flashlightFade <= 0.001) {
                flashlightView.enabled = false;
            }

            for (var materialIndex = 0; materialIndex < storage.materials.length; materialIndex += 1) {
                var storageMaterial = storage.materials[materialIndex];
                var storageBase = storageMaterial._storageBaseDiffuse || storageMaterial.diffuse;
                var darkFactor = lerp(0.34, 1, storage.brightness);
                storageMaterial.diffuse.set(
                    storageBase.r * darkFactor,
                    storageBase.g * darkFactor,
                    storageBase.b * darkFactor
                );
                storageMaterial.update();
            }

            if (dangerOverlay) {
                dangerOverlay.style.opacity = (0.04 + (storage.danger * 0.32)).toFixed(3);
            }
            if (fadeOverlay) {
                fadeOverlay.style.opacity = stage.fade.toFixed(3);
                fadeOverlay.classList.toggle("fade-overlay--hidden", stage.fade <= 0.01);
            }
            return;
        }

        flashlight.light.intensity = 0;
        flashlightView.enabled = false;
        flashlightLensMaterial.emissiveIntensity = 0.08;
        flashlightLensMaterial.update();

        if (dangerOverlay) {
            dangerOverlay.style.opacity = "0";
        }
        if (fadeOverlay) {
            fadeOverlay.style.opacity = stage.fade.toFixed(3);
            fadeOverlay.classList.toggle("fade-overlay--hidden", stage.fade <= 0.01);
        }

        updateUpsideRoomLook(t, time);
    };

    revealStorageNode = function (node) {
        if (!node || node.revealed) {
            return;
        }

        setNodeRevealState(node, true);
        showMessage(node.revealMessage || "有东西在暗处醒来了。", 4.2);
        refreshUi();
    };

    updateStorageClueSearch = function (dt, time) {
        syncStorageClues();

        for (var clueIndex = 0; clueIndex < storage.clues.length; clueIndex += 1) {
            var clue = storage.clues[clueIndex];
            var pulse = 0.42 + (Math.sin((time * 1.8) + clue.pulseOffset) * 0.08);
            var focusGlow = clue.active ? clue.focus : 0;

            clue.pinMaterial.opacity = clue.active ? 0.58 + (focusGlow * 0.2) : 0.18;
            clue.pinMaterial.gloss = clue.active ? 0.7 : 0.3;
            clue.pinMaterial.update();

            clue.moteMaterial.opacity = clue.active ? 0.12 + (pulse * 0.12) + (focusGlow * 0.18) : 0.04;
            clue.moteMaterial.emissiveIntensity = clue.active ? 0.08 + (focusGlow * 0.6) : 0.03;
            clue.moteMaterial.update();
        }

        var activeClue = storage.clues[storage.activeClueIndex];
        if (!activeClue || activeClue.found) {
            return;
        }

        var metrics = getBeamMetrics(activeClue.point);
        if (!metrics || metrics.axialDistance > activeClue.range) {
            activeClue.focus = Math.max(0, activeClue.focus - (dt * 0.9));
            return;
        }

        var allowedRadius = activeClue.beamRadius + (metrics.axialDistance * 0.028);
        if (metrics.radialDistance > allowedRadius) {
            activeClue.focus = Math.max(0, activeClue.focus - (dt * 0.9));
            return;
        }

        var beamStrength = 1 - (metrics.radialDistance / allowedRadius);
        activeClue.focus = clamp(activeClue.focus + (dt * (0.55 + (beamStrength * 1.8))), 0, 1);

        if (activeClue.focus >= 1) {
            activeClue.found = true;
            activeClue.entity.enabled = false;
            showMessage(activeClue.message, 3.8);
            revealStorageNode(getStorageNodeById(activeClue.linkedNodeId));
            refreshUi();
        }
    };

    updateStorageInteraction = function () {
        game.currentTarget = null;

        if (!storage.active || stage.current !== "storage" || storage.failed) {
            setPrompt("", false);
            return;
        }

        var activeClue = storage.clues[storage.activeClueIndex];
        if (activeClue && !activeClue.found) {
            var clueMetrics = getBeamMetrics(activeClue.point);
            if (clueMetrics && clueMetrics.axialDistance <= activeClue.range) {
                var clueBeamRadius = activeClue.beamRadius + (clueMetrics.axialDistance * 0.03);
                if (clueMetrics.radialDistance <= clueBeamRadius * 1.45) {
                    setPrompt("把手电稳在光痕上，它会慢慢显形。\n" + activeClue.hint, true);
                } else {
                    setPrompt(activeClue.hint, true);
                }
            } else {
                setPrompt(activeClue.hint, true);
            }
        }

        var target = findStorageTarget();
        if (!target) {
            return;
        }

        game.currentTarget = target.ref;
        var promptText = "[E] " + target.ref.label;
        if (target.ref.description) {
            promptText += "\n" + target.ref.description;
        }
        setPrompt(promptText, true);

        if (app.keyboard.wasPressed(pc.KEY_E)) {
            if (target.type === "node") {
                purifyStorageNode(target.ref);
            } else {
                collectStorageKey();
            }
        }
    };

    var storageRefreshUiBase = refreshUi;
    refreshUi = function () {
        storageRefreshUiBase();

        document.body.classList.toggle("dream-loop", storage.failed);

        if (failureOverlay) {
            failureOverlay.classList.toggle("failure-overlay--hidden", !storage.failed);
        }

        if (storage.failed) {
            objective.textContent = "梦的循环";
        }
    };

    var storageUpdateModeLookBase = updateModeLook;
    updateModeLook = function (t, time) {
        if (storage.failed) {
            app.scene.ambientLight.set(0.01, 0.0, 0.0);
            app.scene.exposure = 0.08;
            sunLight.light.intensity = 0;
            coolFillLight.light.intensity = 0;
            lampLight.light.intensity = 0;
            flashlight.light.intensity = 0;
            flashlightView.enabled = false;
            flashlightLensMaterial.emissiveIntensity = 0;
            flashlightLensMaterial.update();

            for (var materialIndex = 0; materialIndex < storage.materials.length; materialIndex += 1) {
                var storageMaterial = storage.materials[materialIndex];
                var storageBase = storageMaterial._storageBaseDiffuse || storageMaterial.diffuse;
                storageMaterial.diffuse.set(
                    storageBase.r * 0.06,
                    storageBase.g * 0.02,
                    storageBase.b * 0.02
                );
                storageMaterial.update();
            }

            if (dangerOverlay) {
                dangerOverlay.style.opacity = "0.92";
            }
            if (fadeOverlay) {
                fadeOverlay.style.opacity = "0.98";
                fadeOverlay.classList.remove("fade-overlay--hidden");
            }
            return;
        }

        storageUpdateModeLookBase(t, time);
    };

    var storageMoveWithCollisionBase = moveWithCollision;
    moveWithCollision = function (position, dx, dz) {
        if (storage.failed) {
            return {
                x: position.x,
                z: position.z
            };
        }
        return storageMoveWithCollisionBase(position, dx, dz);
    };

    refreshUi();
    ensureStorageLoaded();

    var time = 0;
    app.on("update", function (dt) {
        if (updatePauseGate()) {
            return;
        }
        time += dt;

        if (app.keyboard.wasPressed(pc.KEY_Q)) {
            toggleMode();
        }

        if (game.activeMessageTimer > 0) {
            game.activeMessageTimer = Math.max(0, game.activeMessageTimer - dt);
            if (game.activeMessageTimer === 0) {
                refreshHint();
            }
        }

        if (storage.failed && app.keyboard.wasPressed(pc.KEY_R)) {
            restartStorageChallenge();
        }

        updateStageFlow(dt, time);
        if (updatePauseGate()) {
            return;
        }

        var yawRad = pc.math.DEG_TO_RAD * player.yaw;
        var forwardX = -Math.sin(yawRad);
        var forwardZ = -Math.cos(yawRad);
        var rightX = Math.cos(yawRad);
        var rightZ = -Math.sin(yawRad);

        var moveX = 0;
        var moveZ = 0;
        if (app.keyboard.isPressed(pc.KEY_W)) {
            moveX += forwardX;
            moveZ += forwardZ;
        }
        if (app.keyboard.isPressed(pc.KEY_S)) {
            moveX -= forwardX;
            moveZ -= forwardZ;
        }
        if (app.keyboard.isPressed(pc.KEY_D)) {
            moveX += rightX;
            moveZ += rightZ;
        }
        if (app.keyboard.isPressed(pc.KEY_A)) {
            moveX -= rightX;
            moveZ -= rightZ;
        }

        if (stage.current === "transition") {
            moveX = 0;
            moveZ = 0;
        }

        if (moveX !== 0 || moveZ !== 0) {
            var moveLength = Math.sqrt((moveX * moveX) + (moveZ * moveZ));
            moveX /= moveLength;
            moveZ /= moveLength;
        }

        var movementAmount = (moveX !== 0 || moveZ !== 0) ? 1 : 0;

        var speed = player.speed * (app.keyboard.isPressed(pc.KEY_SHIFT) ? player.sprint : 1);
        if (stage.current === "transition") {
            // The flip timeline owns cameraRig until the next room has been activated.
        } else if (storage.active && storagePhysics.character) {
            updateStorageCharacter(dt, moveX * speed, moveZ * speed);
        } else if (upsidePhysics.character) {
            updateUpsideCharacter(dt, moveX * speed, moveZ * speed);
        } else if (!room.loaded) {
            // Keep the original spawn stable until its exact collision profile is ready.
        } else {
            var currentPosition = cameraRig.getLocalPosition();
            var moved = moveWithCollision(currentPosition, moveX * speed * dt, moveZ * speed * dt);
            currentPosition.x = moved.x;
            currentPosition.z = moved.z;
            currentPosition.y = room.floorY + 1.62;
            cameraRig.setLocalPosition(currentPosition);
        }

        updateCameraLook(dt);
        updateFlashlightView(dt, time, movementAmount);

        mode.current += (mode.target - mode.current) * Math.min(1, dt * 2.5);

        updateModeLook(mode.current, time);
        syncMirrorCamera();
        updateAnomalyPrompt();
    });

    window.__upsideRoomDebug = {
        toggleMode: toggleMode,
        restartStorageChallenge: function () {
            if (stage.current !== "storage" || !storage.active) {
                return false;
            }
            restartStorageChallenge();
            return true;
        },
        collectById: function (id) {
            for (var i = 0; i < game.anomalies.length; i += 1) {
                if (game.anomalies[i].id === id) {
                    collectAnomaly(game.anomalies[i]);
                    return true;
                }
            }
            return false;
        },
        resetUpsideCollision: function () {
            if (!upsidePhysics.character) {
                return false;
            }
            resetUpsideCharacter();
            return true;
        },
        teleportUpside: function (x, y, z) {
            if (!upsidePhysics.character) {
                return false;
            }
            upsidePhysics.diagnosticTeleportPending = true;
            upsidePhysics.correctionPosition.set(x, y, z);
            warpUpsideCharacter(upsidePhysics.correctionPosition);
            return true;
        },
        setUpsideVelocity: function (x, y, z) {
            upsidePhysics.testVelocity.set(x, y || 0, z);
            upsidePhysics.testVelocityActive = upsidePhysics.testVelocity.lengthSq() > 0.0001;
            if (!upsidePhysics.testVelocityActive) {
                upsidePhysics.moveVelocity.set(0, 0, 0);
            }
            return upsidePhysics.testVelocityActive;
        },
        upsideNavigationContains: function (x, z, centerY) {
            if (!upsidePhysics.navigation || !insideUpsideNavigation(x, z)) {
                return false;
            }
            if (centerY === undefined) {
                return true;
            }
            return findUpsideNavigationLayer(
                x,
                z,
                centerY - (upsidePhysics.player.height * 0.5),
                upsidePhysics.navigation.footTolerance
            ) !== null;
        },
        getUpsideCollisionState: function () {
            var resourcesReady = Boolean(upsidePhysics.navigation && upsidePhysics.colliderEntity);
            var bodyReady = isUpsideColliderBodyReady();
            if (!upsidePhysics.character) {
                return {
                    ready: resourcesReady && bodyReady,
                    resourcesReady: resourcesReady,
                    bodyReady: bodyReady,
                    controllerActive: false,
                    active: false,
                    position: null,
                    velocity: null
                };
            }
            var position = getUpsideCharacterPosition(upsidePhysics.characterPosition);
            var velocity = getUpsideCharacterVelocity(upsidePhysics.characterVelocity);
            var footHeight = position.y - (upsidePhysics.player.height * 0.5);
            var directLayer = upsidePhysics.grounded
                ? findUpsideNavigationLayer(
                    position.x,
                    position.z,
                    footHeight,
                    upsidePhysics.navigation.footTolerance
                )
                : null;
            var transitionLayer = upsidePhysics.grounded && directLayer === null
                ? findUpsideFootprintTransitionLayer(position.x, position.z, footHeight)
                : null;
            return {
                ready: resourcesReady && bodyReady && upsidePhysics.character.actionActive,
                resourcesReady: resourcesReady,
                bodyReady: bodyReady,
                controllerActive: upsidePhysics.character.actionActive,
                active: stage.current === "upside",
                grounded: upsidePhysics.grounded,
                position: [position.x, position.y, position.z],
                cameraPosition: [
                    cameraRig.getLocalPosition().x,
                    cameraRig.getLocalPosition().y,
                    cameraRig.getLocalPosition().z
                ],
                velocity: [velocity.x, velocity.y, velocity.z],
                navigationInside: insideUpsideNavigation(position.x, position.z) &&
                    !outsideUpsideSafetyBounds(position) &&
                    (!upsidePhysics.grounded || directLayer !== null || transitionLayer !== null),
                navigationHeight: upsidePhysics.navigationHeight,
                navigationCells: upsidePhysics.navigation.connectedCells,
                recoveryCount: upsidePhysics.recoveryCount,
                recoveryReasons: Object.assign({}, upsidePhysics.recoveryReasons),
                navigationCorrectionCount: upsidePhysics.navigationCorrectionCount,
                navigationCorrectionReasons: Object.assign({}, upsidePhysics.navigationCorrectionReasons),
                collisionSpawn: [
                    upsidePhysics.collisionSpawn.x,
                    upsidePhysics.collisionSpawn.y,
                    upsidePhysics.collisionSpawn.z
                ],
                controller: "btKinematicCharacterController",
                colliderBody: bodyReady,
                fixedTimeStep: app.systems.rigidbody.fixedTimeStep,
                maxSubSteps: app.systems.rigidbody.maxSubSteps
            };
        },
        resetStorageCollision: function () {
            if (!storagePhysics.character) {
                return false;
            }
            resetStorageCharacter();
            return true;
        },
        teleportStorage: function (x, y, z) {
            if (!storagePhysics.character) {
                return false;
            }
            storagePhysics.diagnosticTeleportPending = true;
            storagePhysics.correctionPosition.set(x, y, z);
            warpStorageCharacter(storagePhysics.correctionPosition);
            return true;
        },
        setStorageVelocity: function (x, y, z) {
            storagePhysics.testVelocity.set(x, y || 0, z);
            storagePhysics.testVelocityActive = storagePhysics.testVelocity.lengthSq() > 0.0001;
            if (!storagePhysics.testVelocityActive) {
                storagePhysics.moveVelocity.set(0, 0, 0);
            }
            return storagePhysics.testVelocityActive;
        },
        storageNavigationContains: function (x, z, centerY) {
            if (!storagePhysics.navigation || !insideStorageNavigation(x, z)) {
                return false;
            }
            if (centerY === undefined) {
                return true;
            }
            return findStorageNavigationLayer(
                x,
                z,
                centerY - (storagePhysics.player.height * 0.5),
                storagePhysics.navigation.footTolerance
            ) !== null;
        },
        getStorageCollisionState: function () {
            var resourcesReady = Boolean(storagePhysics.navigation && storagePhysics.colliderEntity);
            var bodyReady = isStorageColliderBodyReady();
            if (!storagePhysics.character) {
                return {
                    ready: resourcesReady && bodyReady,
                    resourcesReady: resourcesReady,
                    bodyReady: bodyReady,
                    controllerActive: false,
                    active: false,
                    position: null,
                    velocity: null
                };
            }

            var position = getStorageCharacterPosition(storagePhysics.characterPosition);
            var velocity = getStorageCharacterVelocity(storagePhysics.characterVelocity);
            var footHeight = position.y - (storagePhysics.player.height * 0.5);
            var directLayer = storagePhysics.grounded
                ? findStorageNavigationLayer(
                    position.x,
                    position.z,
                    footHeight,
                    storagePhysics.navigation.footTolerance
                )
                : null;
            var transitionLayer = storagePhysics.grounded && directLayer === null
                ? findStorageFootprintTransitionLayer(position.x, position.z, footHeight)
                : null;
            return {
                ready: resourcesReady && bodyReady && (!storage.active || storagePhysics.character.actionActive),
                resourcesReady: resourcesReady,
                bodyReady: bodyReady,
                controllerActive: storagePhysics.character.actionActive,
                active: storage.active,
                grounded: storagePhysics.grounded,
                position: [position.x, position.y, position.z],
                cameraPosition: [
                    cameraRig.getLocalPosition().x,
                    cameraRig.getLocalPosition().y,
                    cameraRig.getLocalPosition().z
                ],
                velocity: [velocity.x, velocity.y, velocity.z],
                navigationInside: insideStorageNavigation(position.x, position.z) &&
                    !outsideStorageSafetyBounds(position) &&
                    (!storagePhysics.grounded || directLayer !== null || transitionLayer !== null),
                navigationHeight: storagePhysics.navigationHeight,
                navigationCells: storagePhysics.navigation.connectedCells,
                navigationLayers: storagePhysics.navigation.connectedLayers,
                recoveryCount: storagePhysics.recoveryCount,
                recoveryReasons: Object.assign({}, storagePhysics.recoveryReasons),
                navigationCorrectionCount: storagePhysics.navigationCorrectionCount,
                navigationCorrectionReasons: Object.assign({}, storagePhysics.navigationCorrectionReasons),
                collisionSpawn: [
                    storagePhysics.collisionSpawn.x,
                    storagePhysics.collisionSpawn.y,
                    storagePhysics.collisionSpawn.z
                ],
                controller: "btKinematicCharacterController",
                colliderBody: bodyReady,
                fixedTimeStep: app.systems.rigidbody.fixedTimeStep,
                maxSubSteps: app.systems.rigidbody.maxSubSteps
            };
        },
        getState: function () {
            return {
                stage: stage.current,
                loaded: room.loaded,
                modeTarget: mode.target,
                modeCurrent: mode.current,
                foundCount: game.foundCount,
                storageLoaded: storage.loaded,
                storageActive: storage.active,
                storageTimer: storage.timer,
                storagePurified: storage.purifiedCount,
                storageKeyCollected: storage.keyCollected,
                collision: {
                    activeRoomObstacles: room.obstacles ? room.obstacles.length : 0,
                    scene1Mesh: room.meshColliders ? room.meshColliders.length : 0,
                    scene1ExactTriangles: isUpsideColliderBodyReady() ? upsidePhysics.triangleCount : 0,
                    scene1NavigationCells: upsidePhysics.navigation ? upsidePhysics.navigation.connectedCells : 0,
                    scene1Controller: Boolean(upsidePhysics.character),
                    storageMesh: isStorageColliderBodyReady() ? storagePhysics.triangleCount : 0,
                    storageTotal: isStorageColliderBodyReady() ? "exact-bvh" : 0,
                    storageNavigationCells: storagePhysics.navigation ? storagePhysics.navigation.connectedCells : 0,
                    storageController: Boolean(storagePhysics.character),
                    controllerCount: Number(Boolean(upsidePhysics.character)) +
                        Number(Boolean(storagePhysics.character)),
                    scene1Asset: document.body.getAttribute("data-scene1-asset"),
                    scene1Debug: window.__upsideRoomSceneDebug || null
                },
                anomalies: game.anomalies.map(function (anomaly) {
                    return {
                        id: anomaly.id,
                        found: anomaly.found,
                        enabled: anomaly.entity.enabled
                    };
                })
            };
        }
    };
}());
