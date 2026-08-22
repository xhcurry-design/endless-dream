#!/usr/bin/env python3
"""Inspect floor-level capsule clearance in a generated room voxel asset.

This is a lightweight regression/diagnostic companion to
``generate_room_collision.py``.  It does not modify collision data.
"""

from __future__ import annotations

import argparse
import json
import math
from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw


SOLID_LEAF_MARKER = 0xFF000000
LEAF_SIZE = 4


def decode_occupancy(meta: dict, raw: bytes) -> np.ndarray:
    node_count = int(meta["nodeCount"])
    leaf_count = int(meta["leafDataCount"])
    words = np.frombuffer(raw, dtype="<u4", count=node_count + leaf_count)
    if words.size != node_count + leaf_count:
        raise ValueError("voxel binary is shorter than metadata declares")
    nodes = words[:node_count]
    leaf_data = words[node_count:]
    bounds = meta["gridBounds"]
    resolution = float(meta["voxelResolution"])
    dims = np.rint(
        (np.asarray(bounds["max"]) - np.asarray(bounds["min"])) / resolution
    ).astype(int)
    occupancy = np.zeros(tuple(dims), dtype=bool)
    root_size = (1 << int(meta["treeDepth"])) * LEAF_SIZE

    def visit(node_index: int, ox: int, oy: int, oz: int, size: int) -> None:
        word = int(nodes[node_index])
        if word == SOLID_LEAF_MARKER:
            occupancy[
                ox : min(ox + size, dims[0]),
                oy : min(oy + size, dims[1]),
                oz : min(oz + size, dims[2]),
            ] = True
            return
        child_mask = word >> 24
        if child_mask == 0:
            pair = word & 0xFFFFFF
            lo = int(leaf_data[pair * 2])
            hi = int(leaf_data[pair * 2 + 1])
            for bit in range(64):
                bits = lo if bit < 32 else hi
                shift = bit if bit < 32 else bit - 32
                if not ((bits >> shift) & 1):
                    continue
                x = ox + (bit & 3)
                y = oy + ((bit >> 2) & 3)
                z = oz + ((bit >> 4) & 3)
                if x < dims[0] and y < dims[1] and z < dims[2]:
                    occupancy[x, y, z] = True
            return

        half = size // 2
        first_child = word & 0xFFFFFF
        rank = 0
        for octant in range(8):
            if not (child_mask & (1 << octant)):
                continue
            visit(
                first_child + rank,
                ox + (octant & 1) * half,
                oy + ((octant >> 1) & 1) * half,
                oz + ((octant >> 2) & 1) * half,
                half,
            )
            rank += 1

    visit(0, 0, 0, 0, root_size)
    return occupancy


def world_index(value: float, minimum: float, resolution: float) -> int:
    return math.floor((value - minimum) / resolution)


def floor_clearance_mask(
    occupancy: np.ndarray,
    grid_min: np.ndarray,
    resolution: float,
    foot_y: float,
    radius: float,
    height: float,
    clearance_corridors: list[dict] | None = None,
) -> tuple[np.ndarray, np.ndarray]:
    inset = min(resolution * 0.6, height * 0.02)
    y0 = max(0, world_index(foot_y + inset, grid_min[1], resolution))
    y1 = min(
        occupancy.shape[1] - 1,
        world_index(foot_y + height - inset, grid_min[1], resolution),
    )
    blocked_columns = occupancy[:, y0 : y1 + 1, :].any(axis=1)

    sample_bottom = foot_y + inset
    sample_top = foot_y + height - inset
    x_coords = grid_min[0] + (np.arange(occupancy.shape[0]) + 0.5) * resolution
    z_coords = grid_min[2] + (np.arange(occupancy.shape[2]) + 0.5) * resolution
    xx, zz = np.meshgrid(x_coords, z_coords, indexing="ij")
    for corridor in clearance_corridors or []:
        points = np.asarray(corridor.get("points", []), dtype=float)
        corridor_radius = float(corridor.get("radius", 0))
        if (
            points.ndim != 2
            or points.shape[0] < 2
            or points.shape[1] < 2
            or not np.isfinite(points[:, :2]).all()
            or not math.isfinite(corridor_radius)
            or corridor_radius <= 0
            or sample_bottom < float(corridor.get("minY", math.inf))
            or sample_top > float(corridor.get("maxY", -math.inf))
        ):
            continue
        carved = np.zeros_like(blocked_columns)
        for start, end in zip(points[:-1, :2], points[1:, :2], strict=True):
            dx, dz = end - start
            length_sq = dx * dx + dz * dz
            if length_sq > 0:
                t = np.clip(((xx - start[0]) * dx + (zz - start[1]) * dz) / length_sq, 0, 1)
            else:
                t = np.zeros_like(xx)
            distance_sq = (xx - (start[0] + dx * t)) ** 2 + (zz - (start[1] + dz * t)) ** 2
            carved |= distance_sq <= corridor_radius * corridor_radius
        blocked_columns[carved] = False

    support_y0 = max(0, world_index(foot_y - resolution * 2.5, grid_min[1], resolution))
    support_y1 = min(
        occupancy.shape[1] - 1,
        world_index(foot_y + inset * 0.5, grid_min[1], resolution),
    )
    support = occupancy[:, support_y0 : support_y1 + 1, :].any(axis=1)

    radius_cells = int(math.ceil(radius / resolution))
    expanded = np.zeros_like(blocked_columns)
    for dx in range(-radius_cells, radius_cells + 1):
        for dz in range(-radius_cells, radius_cells + 1):
            if math.hypot(dx * resolution, dz * resolution) > radius + resolution * 0.5:
                continue
            src_x0 = max(0, -dx)
            src_x1 = min(blocked_columns.shape[0], blocked_columns.shape[0] - dx)
            src_z0 = max(0, -dz)
            src_z1 = min(blocked_columns.shape[1], blocked_columns.shape[1] - dz)
            expanded[
                src_x0 + dx : src_x1 + dx,
                src_z0 + dz : src_z1 + dz,
            ] |= blocked_columns[src_x0:src_x1, src_z0:src_z1]
    return ~expanded & support, blocked_columns


def component_from(mask: np.ndarray, start: tuple[int, int]) -> np.ndarray:
    reached = np.zeros_like(mask)
    if not mask[start]:
        return reached
    queue = deque([start])
    reached[start] = True
    while queue:
        x, z = queue.popleft()
        for nx, nz in ((x - 1, z), (x + 1, z), (x, z - 1), (x, z + 1)):
            if (
                0 <= nx < mask.shape[0]
                and 0 <= nz < mask.shape[1]
                and mask[nx, nz]
                and not reached[nx, nz]
            ):
                reached[nx, nz] = True
                queue.append((nx, nz))
    return reached


def save_map(
    path: Path,
    walkable: np.ndarray,
    reached: np.ndarray,
    blocked: np.ndarray,
    spawn: tuple[int, int],
    scale: int = 5,
) -> None:
    rgb = np.full((*walkable.shape, 3), (238, 238, 234), dtype=np.uint8)
    rgb[blocked] = (50, 54, 58)
    rgb[walkable] = (151, 195, 163)
    rgb[reached] = (42, 142, 91)
    image = Image.fromarray(np.transpose(rgb, (1, 0, 2))[::-1], "RGB")
    image = image.resize((image.width * scale, image.height * scale), Image.Resampling.NEAREST)
    draw = ImageDraw.Draw(image)
    sx = int((spawn[0] + 0.5) * scale)
    sz = int((walkable.shape[1] - spawn[1] - 0.5) * scale)
    marker = max(4, scale * 2)
    draw.ellipse((sx - marker, sz - marker, sx + marker, sz + marker), fill=(246, 190, 42))
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("voxel_json", type=Path)
    parser.add_argument("--foot-y", type=float, default=-0.55)
    parser.add_argument("--radius", type=float, default=0.18)
    parser.add_argument("--height", type=float, default=1.40)
    parser.add_argument("--spawn", type=float, nargs=2, default=(-1.757, -1.097), metavar=("X", "Z"))
    parser.add_argument("--target", type=float, nargs=2, metavar=("X", "Z"))
    parser.add_argument("--map-output", type=Path)
    args = parser.parse_args()

    meta = json.loads(args.voxel_json.read_text(encoding="utf-8"))
    bin_path = args.voxel_json.with_name(args.voxel_json.name.replace(".voxel.json", ".voxel.bin"))
    occupancy = decode_occupancy(meta, bin_path.read_bytes())
    grid_min = np.asarray(meta["gridBounds"]["min"], dtype=float)
    resolution = float(meta["voxelResolution"])
    walkable, blocked = floor_clearance_mask(
        occupancy,
        grid_min,
        resolution,
        args.foot_y,
        args.radius,
        args.height,
        meta.get("navigation", {}).get("clearanceCorridors", []),
    )
    spawn = (
        world_index(args.spawn[0], grid_min[0], resolution),
        world_index(args.spawn[1], grid_min[2], resolution),
    )
    reached = component_from(walkable, spawn)
    coords = np.argwhere(reached)
    if coords.size:
        x_bounds = grid_min[0] + np.array([coords[:, 0].min(), coords[:, 0].max() + 1]) * resolution
        z_bounds = grid_min[2] + np.array([coords[:, 1].min(), coords[:, 1].max() + 1]) * resolution
        print(
            f"spawn component: {len(coords)} cells; "
            f"X[{x_bounds[0]:.3f}, {x_bounds[1]:.3f}] "
            f"Z[{z_bounds[0]:.3f}, {z_bounds[1]:.3f}]"
        )
    else:
        print("spawn component: unavailable (spawn cell is not walkable)")
    print(f"floor-level walkable cells: {int(walkable.sum())}")
    target_reached = True
    if args.target:
        target = (
            world_index(args.target[0], grid_min[0], resolution),
            world_index(args.target[1], grid_min[2], resolution),
        )
        target_in_bounds = (
            0 <= target[0] < reached.shape[0]
            and 0 <= target[1] < reached.shape[1]
        )
        target_reached = target_in_bounds and bool(reached[target])
        print(
            f"target ({args.target[0]:.3f}, {args.target[1]:.3f}): "
            f"{'reachable' if target_reached else 'UNREACHABLE'}"
        )
    if args.map_output:
        save_map(args.map_output, walkable, reached, blocked, spawn)
        print(f"wrote map: {args.map_output}")
    return 0 if target_reached else 1


if __name__ == "__main__":
    raise SystemExit(main())
