#!/usr/bin/env python3
"""Build mapped collision assets for the accepted room collision package.

The source GLB and seven structural boxes are authored in the integration
package's world frame. The Gaussian PLY remains in its raw frame, while the
game displays that same raw data through a different entity transform. The
required collision mapping is therefore:

    package_world -> game_world = game_splat_trs @ inverse(raw_ply_to_world)

The voxel output uses the PlayCanvas splat-transform v1.1 sparse-octree layout
read by run/voxel-collision.js. An optional GLB output contains the same mapped
surface and structural guard boxes used to build that voxel data. No capsule
carve or navigable-space filtering is performed.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import math
import os
import sys
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

import numpy as np
import trimesh


PACKAGE_ROOT = "room3dgs_game_integration_r01/"
MANIFEST_ENTRY = PACKAGE_ROOT + "scene_manifest.json"
COLLISION_ENTRY = PACKAGE_ROOT + "assets/room_collision.glb"
SOLID_LEAF_MARKER = 0xFF000000
LEAF_SIZE = 4

# Current ROOM_GAME_CONFIG values in run/main_pro.html. CLI flags can override
# them when the visual registration is intentionally changed later.
DEFAULT_SPLAT_POSITION = (-0.2181476514, 0.1634744378, -0.2738597835)
DEFAULT_SPLAT_QUATERNION_XYZW = (
    0.0253960364,
    0.6724043042,
    0.7380295221,
    0.0503975948,
)
DEFAULT_SPLAT_SCALE = 1.0956230830


@dataclass(slots=True)
class TreeNode:
    kind: str
    children: dict[int, "TreeNode"] | None = None
    lo: int = 0
    hi: int = 0


@dataclass(slots=True)
class OctreeData:
    tree_depth: int
    num_interior_nodes: int
    num_mixed_leaves: int
    nodes: np.ndarray
    leaf_data: np.ndarray


def quaternion_matrix_xyzw(values: Iterable[float]) -> np.ndarray:
    x, y, z, w = (float(value) for value in values)
    norm = math.sqrt(x * x + y * y + z * z + w * w)
    if not math.isfinite(norm) or norm <= 0.0:
        raise ValueError("The game splat quaternion must be finite and nonzero")
    x, y, z, w = x / norm, y / norm, z / norm, w / norm
    return np.array(
        [
            [1.0 - 2.0 * (y * y + z * z), 2.0 * (x * y - z * w), 2.0 * (x * z + y * w), 0.0],
            [2.0 * (x * y + z * w), 1.0 - 2.0 * (x * x + z * z), 2.0 * (y * z - x * w), 0.0],
            [2.0 * (x * z - y * w), 2.0 * (y * z + x * w), 1.0 - 2.0 * (x * x + y * y), 0.0],
            [0.0, 0.0, 0.0, 1.0],
        ],
        dtype=np.float64,
    )


def game_splat_matrix(position: Iterable[float], quaternion: Iterable[float], scale: float) -> np.ndarray:
    if not math.isfinite(scale) or scale <= 0.0:
        raise ValueError("The game splat scale must be finite and positive")
    matrix = quaternion_matrix_xyzw(quaternion)
    matrix[:3, :3] *= scale
    matrix[:3, 3] = np.asarray(tuple(position), dtype=np.float64)
    return matrix


def transform_points(points: np.ndarray, matrix: np.ndarray) -> np.ndarray:
    return points @ matrix[:3, :3].T + matrix[:3, 3]


def read_package(archive_path: Path) -> tuple[dict, bytes]:
    with zipfile.ZipFile(archive_path) as archive:
        manifest = json.loads(archive.read(MANIFEST_ENTRY))
        collision_bytes = archive.read(COLLISION_ENTRY)

    expected_hash = manifest["collision"].get("sha256", "").lower()
    actual_hash = hashlib.sha256(collision_bytes).hexdigest()
    if expected_hash and actual_hash != expected_hash:
        raise ValueError(
            "room_collision.glb checksum mismatch: "
            f"expected {expected_hash}, got {actual_hash}"
        )

    boxes = manifest["collision"].get("structuralBoxColliders", [])
    if len(boxes) != 7:
        raise ValueError(f"Expected exactly 7 structural boxes, found {len(boxes)}")
    if manifest["collision"].get("coordinateSpace") != "world":
        raise ValueError("The source collision GLB is not declared in package world space")
    return manifest, collision_bytes


def load_collision_mesh(collision_bytes: bytes) -> trimesh.Trimesh:
    scene = trimesh.load(
        io.BytesIO(collision_bytes),
        file_type="glb",
        force="scene",
        process=False,
    )
    mesh = scene.to_geometry()
    if not isinstance(mesh, trimesh.Trimesh) or len(mesh.faces) == 0:
        raise ValueError("room_collision.glb did not contain a nonempty triangle mesh")
    return mesh


def build_mapped_geometry(
    source_mesh: trimesh.Trimesh,
    structural_boxes: list[dict],
    package_to_game: np.ndarray,
) -> tuple[trimesh.Trimesh, trimesh.Trimesh, list[trimesh.Trimesh]]:
    mapped_source = source_mesh.copy()
    mapped_source.apply_transform(package_to_game)

    mapped_boxes: list[trimesh.Trimesh] = []
    for box in structural_boxes:
        center = np.asarray(box["center"], dtype=np.float64)
        half_extents = np.asarray(box["halfExtents"], dtype=np.float64)
        if center.shape != (3,) or half_extents.shape != (3,) or np.any(half_extents <= 0.0):
            raise ValueError(f"Invalid structural box {box.get('id', '<unnamed>')}")
        box_mesh = trimesh.creation.box(extents=half_extents * 2.0)
        box_mesh.apply_translation(center)
        box_mesh.apply_transform(package_to_game)
        mapped_boxes.append(box_mesh)

    combined = trimesh.util.concatenate([mapped_source, *mapped_boxes])
    return combined, mapped_source, mapped_boxes


def aligned_grid_bounds(mesh: trimesh.Trimesh, pitch: float) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    block_size = LEAF_SIZE * pitch
    scene_min, scene_max = np.asarray(mesh.bounds, dtype=np.float64)
    grid_min = np.floor(scene_min / block_size) * block_size
    grid_max = np.ceil(scene_max / block_size) * block_size
    dims = np.rint((grid_max - grid_min) / pitch).astype(np.int64)
    if np.any(dims <= 0) or np.any(dims % LEAF_SIZE != 0):
        raise ValueError(f"Invalid aligned voxel dimensions: {dims.tolist()}")
    return grid_min, grid_max, dims


def voxelize_surface(
    mesh: trimesh.Trimesh,
    grid_min: np.ndarray,
    dims: np.ndarray,
    pitch: float,
) -> np.ndarray:
    # trimesh's subdivide voxelizer rounds samples onto a center lattice. Shift
    # that lattice so its centers exactly match the SVO cells.
    center_origin = grid_min + pitch * 0.5
    shifted = mesh.copy()
    shifted.apply_translation(-center_origin)
    voxel_grid = shifted.voxelized(
        pitch=pitch,
        method="subdivide",
        edge_factor=2.0,
        max_iter=12,
    )
    indices = np.rint(voxel_grid.points / pitch).astype(np.int64)
    valid = np.all((indices >= 0) & (indices < dims), axis=1)
    if not np.all(valid):
        invalid = int(np.count_nonzero(~valid))
        raise ValueError(f"Surface voxelization emitted {invalid} samples outside aligned bounds")
    return np.unique(indices, axis=0)


def filled_box_indices(
    structural_boxes: list[dict],
    package_to_game: np.ndarray,
    grid_min: np.ndarray,
    dims: np.ndarray,
    pitch: float,
) -> np.ndarray:
    # Fill cells whose centers lie inside each authored box. The surface pass
    # supplies conservative boundary coverage for boxes thinner than one voxel.
    grid_indices = np.indices(tuple(int(value) for value in dims), dtype=np.int32)
    grid_indices = np.moveaxis(grid_indices, 0, -1).reshape(-1, 3)
    game_centers = grid_min + (grid_indices.astype(np.float64) + 0.5) * pitch
    game_to_package = np.linalg.inv(package_to_game)
    package_centers = transform_points(game_centers, game_to_package)

    selected = np.zeros(len(grid_indices), dtype=bool)
    tolerance = pitch * 1e-8
    for box in structural_boxes:
        minimum = np.asarray(box["min"], dtype=np.float64) - tolerance
        maximum = np.asarray(box["max"], dtype=np.float64) + tolerance
        selected |= np.all(
            (package_centers >= minimum) & (package_centers <= maximum),
            axis=1,
        )
    return grid_indices[selected].astype(np.int64, copy=False)


def combine_occupancy(surface: np.ndarray, box_fill: np.ndarray) -> np.ndarray:
    if len(box_fill) == 0:
        return surface
    return np.unique(np.vstack((surface, box_fill)), axis=0)


def make_leaf_nodes(indices: np.ndarray) -> dict[tuple[int, int, int], TreeNode]:
    masks: dict[tuple[int, int, int], list[int]] = {}
    for ix, iy, iz in indices:
        key = (int(ix) >> 2, int(iy) >> 2, int(iz) >> 2)
        pair = masks.setdefault(key, [0, 0])
        bit = (int(ix) & 3) + ((int(iy) & 3) << 2) + ((int(iz) & 3) << 4)
        if bit < 32:
            pair[0] |= 1 << bit
        else:
            pair[1] |= 1 << (bit - 32)

    leaves: dict[tuple[int, int, int], TreeNode] = {}
    for key, (lo, hi) in masks.items():
        lo &= 0xFFFFFFFF
        hi &= 0xFFFFFFFF
        if lo == 0xFFFFFFFF and hi == 0xFFFFFFFF:
            leaves[key] = TreeNode("solid")
        else:
            leaves[key] = TreeNode("mixed", lo=lo, hi=hi)
    return leaves


def build_tree(indices: np.ndarray, dims: np.ndarray) -> tuple[TreeNode, int]:
    blocks_per_axis = dims // LEAF_SIZE
    tree_depth = max(1, math.ceil(math.log2(int(np.max(blocks_per_axis)))))
    current = make_leaf_nodes(indices)
    if not current:
        raise ValueError("Cannot encode an empty occupancy grid")

    for _ in range(tree_depth):
        groups: dict[tuple[int, int, int], dict[int, TreeNode]] = {}
        for (x, y, z), node in current.items():
            parent = (x >> 1, y >> 1, z >> 1)
            octant = (x & 1) | ((y & 1) << 1) | ((z & 1) << 2)
            groups.setdefault(parent, {})[octant] = node

        next_level: dict[tuple[int, int, int], TreeNode] = {}
        for parent, children in groups.items():
            if len(children) == 8 and all(child.kind == "solid" for child in children.values()):
                next_level[parent] = TreeNode("solid")
            else:
                next_level[parent] = TreeNode("interior", children=children)
        current = next_level

    root = current.get((0, 0, 0))
    if root is None or len(current) != 1:
        raise ValueError("Octree aggregation did not converge to one root")
    return root, tree_depth


def flatten_tree(root: TreeNode, tree_depth: int) -> OctreeData:
    nodes: list[int] = []
    leaf_data: list[int] = []
    num_interior = 0
    num_mixed = 0

    def append_node(node: TreeNode, next_wave: list[tuple[int, TreeNode]]) -> None:
        nonlocal num_interior, num_mixed
        if node.kind == "solid":
            nodes.append(SOLID_LEAF_MARKER)
        elif node.kind == "mixed":
            pair_index = len(leaf_data) // 2
            if pair_index > 0xFFFFFF:
                raise ValueError("Mixed-leaf data exceeds the SVO 24-bit offset limit")
            nodes.append(pair_index)
            leaf_data.extend((node.lo, node.hi))
            num_mixed += 1
        elif node.kind == "interior":
            position = len(nodes)
            nodes.append(0)
            next_wave.append((position, node))
            num_interior += 1
        else:
            raise ValueError(f"Unknown tree node kind: {node.kind}")

    wave: list[tuple[int, TreeNode]] = []
    append_node(root, wave)
    level = tree_depth
    while wave:
        next_wave: list[tuple[int, TreeNode]] = []
        for position, parent in wave:
            children = parent.children or {}
            child_start = len(nodes)
            if child_start > 0xFFFFFF:
                raise ValueError("Node data exceeds the SVO 24-bit offset limit")
            child_mask = 0
            for octant in range(8):
                child = children.get(octant)
                if child is None:
                    continue
                child_mask |= 1 << octant
                append_node(child, next_wave)
            nodes[position] = (child_mask << 24) | child_start
        wave = next_wave
        level -= 1

    if root.kind == "interior" and level != 0:
        raise ValueError(f"Tree flattening ended at unexpected level {level}")
    return OctreeData(
        tree_depth=tree_depth,
        num_interior_nodes=num_interior,
        num_mixed_leaves=num_mixed,
        nodes=np.asarray(nodes, dtype="<u4"),
        leaf_data=np.asarray(leaf_data, dtype="<u4"),
    )


def decode_voxel(ix: int, iy: int, iz: int, octree: OctreeData) -> bool:
    node_index = 0
    size = (1 << octree.tree_depth) * LEAF_SIZE
    ox = oy = oz = 0
    for _ in range(octree.tree_depth):
        word = int(octree.nodes[node_index])
        if word == SOLID_LEAF_MARKER:
            return True
        if word >> 24 == 0:
            break
        child_mask = word >> 24
        first_child = word & 0xFFFFFF
        half = size >> 1
        cx = int(ix - ox >= half)
        cy = int(iy - oy >= half)
        cz = int(iz - oz >= half)
        octant = cx | (cy << 1) | (cz << 2)
        if child_mask & (1 << octant) == 0:
            return False
        rank = (child_mask & ((1 << octant) - 1)).bit_count()
        node_index = first_child + rank
        ox += cx * half
        oy += cy * half
        oz += cz * half
        size = half

    word = int(octree.nodes[node_index])
    if word == SOLID_LEAF_MARKER:
        return True
    if word >> 24 != 0:
        raise ValueError("Decoder did not reach an SVO leaf")
    pair_index = word & 0xFFFFFF
    bit = (ix - ox) + ((iy - oy) << 2) + ((iz - oz) << 4)
    value = int(octree.leaf_data[pair_index * 2 + (1 if bit >= 32 else 0)])
    return bool((value >> (bit - 32 if bit >= 32 else bit)) & 1)


def verify_round_trip(indices: np.ndarray, dims: np.ndarray, octree: OctreeData) -> None:
    expected = np.zeros(tuple(int(value) for value in dims), dtype=bool)
    expected[indices[:, 0], indices[:, 1], indices[:, 2]] = True
    for iz in range(int(dims[2])):
        for iy in range(int(dims[1])):
            for ix in range(int(dims[0])):
                actual = decode_voxel(ix, iy, iz, octree)
                if actual != bool(expected[ix, iy, iz]):
                    raise ValueError(
                        "SVO round-trip mismatch at voxel "
                        f"({ix}, {iy}, {iz}): expected {expected[ix, iy, iz]}, got {actual}"
                    )


def normalized_output_paths(prefix: Path) -> tuple[Path, Path]:
    text = str(prefix)
    for suffix in (".voxel.json", ".voxel.bin"):
        if text.lower().endswith(suffix):
            text = text[: -len(suffix)]
            break
    return Path(text + ".voxel.json"), Path(text + ".voxel.bin")


def write_outputs(
    json_path: Path,
    bin_path: Path,
    metadata: dict,
    octree: OctreeData,
    force: bool,
    collision_path: Path | None = None,
    collision_bytes: bytes | None = None,
) -> None:
    outputs = [
        (json_path, (json.dumps(metadata, indent=2, ensure_ascii=True) + "\n").encode("ascii")),
        (
            bin_path,
            np.concatenate((octree.nodes, octree.leaf_data))
            .astype("<u4", copy=False)
            .tobytes(),
        ),
    ]
    if collision_path is not None:
        if collision_bytes is None:
            raise ValueError("collision_bytes is required with collision_path")
        outputs.append((collision_path, collision_bytes))

    existing = [path for path, _ in outputs if path.exists()]
    if existing and not force:
        names = ", ".join(str(path) for path in existing)
        raise FileExistsError(f"Refusing to overwrite existing output: {names}")
    for path, _ in outputs:
        path.parent.mkdir(parents=True, exist_ok=True)

    temp_outputs = [(path.with_name(path.name + ".tmp"), data) for path, data in outputs]
    try:
        for temp_path, data in temp_outputs:
            temp_path.write_bytes(data)
        for (path, _), (temp_path, _) in zip(outputs, temp_outputs, strict=True):
            os.replace(temp_path, path)
    finally:
        for temp_path, _ in temp_outputs:
            temp_path.unlink(missing_ok=True)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("package", type=Path, help="Path to room3dgs_game_integration_r01.zip")
    parser.add_argument(
        "--output-prefix",
        type=Path,
        required=True,
        help="Output basename; .voxel.json and .voxel.bin are appended",
    )
    parser.add_argument(
        "--collision-output",
        type=Path,
        help="Optional mapped GLB containing the same surface and guard boxes",
    )
    parser.add_argument("--voxel-size", type=float, default=0.05)
    parser.add_argument("--force", action="store_true", help="Allow replacing requested outputs")
    parser.add_argument(
        "--game-splat-position",
        type=float,
        nargs=3,
        metavar=("X", "Y", "Z"),
        default=DEFAULT_SPLAT_POSITION,
    )
    parser.add_argument(
        "--game-splat-quaternion",
        type=float,
        nargs=4,
        metavar=("X", "Y", "Z", "W"),
        default=DEFAULT_SPLAT_QUATERNION_XYZW,
    )
    parser.add_argument("--game-splat-scale", type=float, default=DEFAULT_SPLAT_SCALE)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if not math.isfinite(args.voxel_size) or args.voxel_size <= 0.0:
        raise ValueError("--voxel-size must be finite and positive")

    manifest, collision_bytes = read_package(args.package)
    raw_to_package = np.asarray(manifest["visual"]["rawPlyToWorld"], dtype=np.float64)
    if raw_to_package.shape != (4, 4):
        raise ValueError("visual.rawPlyToWorld must be a 4x4 matrix")
    raw_to_game = game_splat_matrix(
        args.game_splat_position,
        args.game_splat_quaternion,
        args.game_splat_scale,
    )
    package_to_game = raw_to_game @ np.linalg.inv(raw_to_package)
    linear = package_to_game[:3, :3]
    axis_scales = np.linalg.norm(linear, axis=0)
    if not np.allclose(axis_scales, axis_scales[0], rtol=1e-8, atol=1e-10):
        raise ValueError(f"Package-to-game mapping is not uniformly scaled: {axis_scales.tolist()}")
    gram = linear.T @ linear
    if not np.allclose(gram, np.eye(3) * axis_scales[0] ** 2, rtol=1e-8, atol=1e-10):
        raise ValueError("Package-to-game mapping contains shear or non-orthogonal axes")
    if np.linalg.det(linear) <= 0.0:
        raise ValueError("Package-to-game mapping unexpectedly reflects the collision geometry")

    source_mesh = load_collision_mesh(collision_bytes)
    boxes = manifest["collision"]["structuralBoxColliders"]
    combined, mapped_source, _mapped_boxes = build_mapped_geometry(
        source_mesh,
        boxes,
        package_to_game,
    )
    scene_bounds = np.asarray(combined.bounds, dtype=np.float64)
    grid_min, grid_max, dims = aligned_grid_bounds(combined, args.voxel_size)
    surface = voxelize_surface(combined, grid_min, dims, args.voxel_size)
    box_fill = filled_box_indices(boxes, package_to_game, grid_min, dims, args.voxel_size)
    occupancy = combine_occupancy(surface, box_fill)

    root, tree_depth = build_tree(occupancy, dims)
    octree = flatten_tree(root, tree_depth)
    verify_round_trip(occupancy, dims, octree)

    metadata = {
        "version": "1.1",
        "asset": {
            "generator": "generate_room_collision.py",
            "encodingReference": "splat-transform v3.3.0",
            "source": args.package.name,
            "sourceVisualSha256": manifest["visual"].get("sha256", ""),
            "sourceCollisionSha256": manifest["collision"].get("sha256", ""),
            "surfaceOccupancy": True,
            "capsuleCarve": False,
            "structuralBoxCount": len(boxes),
            "collisionIncludesStructuralBoxes": args.collision_output is not None,
            "gameSplatTransform": {
                "position": list(args.game_splat_position),
                "quaternionXyzw": list(args.game_splat_quaternion),
                "scale": args.game_splat_scale,
            },
            "packageToGame": package_to_game.tolist(),
        },
        "gridBounds": {"min": grid_min.tolist(), "max": grid_max.tolist()},
        "sceneBounds": {"min": scene_bounds[0].tolist(), "max": scene_bounds[1].tolist()},
        "voxelResolution": args.voxel_size,
        "leafSize": LEAF_SIZE,
        "treeDepth": octree.tree_depth,
        "numInteriorNodes": octree.num_interior_nodes,
        "numMixedLeaves": octree.num_mixed_leaves,
        "nodeCount": int(len(octree.nodes)),
        "leafDataCount": int(len(octree.leaf_data)),
    }

    json_path, bin_path = normalized_output_paths(args.output_prefix)
    mapped_collision_bytes = combined.export(file_type="glb") if args.collision_output else None
    write_outputs(
        json_path,
        bin_path,
        metadata,
        octree,
        args.force,
        args.collision_output,
        mapped_collision_bytes,
    )

    floor_y = -0.015
    bed_y = 0.600
    sill_y = 0.675
    vertical_factor = float(package_to_game[1, 1])
    print("package_world -> game_world:")
    print(np.array2string(package_to_game, precision=10, suppress_small=True))
    print(f"uniform scale: {axis_scales[0]:.10f}")
    print(f"mapped source GLB bounds: {mapped_source.bounds.tolist()}")
    print(f"grid bounds: {grid_min.tolist()} -> {grid_max.tolist()} ({dims.tolist()} voxels)")
    print(f"occupied voxels: {len(occupancy)} (surface {len(surface)}, box-center fill {len(box_fill)})")
    print(
        "nominal platform gaps above floor after mapping: "
        f"bed {(bed_y - floor_y) * vertical_factor:.4f} m, "
        f"window sill {(sill_y - floor_y) * vertical_factor:.4f} m"
    )
    print(
        "SVO: "
        f"depth {octree.tree_depth}, nodes {len(octree.nodes)}, "
        f"interiors {octree.num_interior_nodes}, mixed leaves {octree.num_mixed_leaves}"
    )
    print(f"round-trip verification: PASS ({int(np.prod(dims))} in-grid voxels checked)")
    print(f"wrote: {json_path}")
    print(f"wrote: {bin_path}")
    if args.collision_output:
        print(f"wrote: {args.collision_output}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (FileNotFoundError, KeyError, ValueError, zipfile.BadZipFile) as error:
        print(f"error: {error}", file=sys.stderr)
        raise SystemExit(2)
