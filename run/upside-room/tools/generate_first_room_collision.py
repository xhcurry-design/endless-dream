from __future__ import annotations

import argparse
import base64
from collections import deque
import hashlib
import io
import json
import platform
from pathlib import Path
import struct

import numpy as np
import rtree
import scipy
from scipy import ndimage
import trimesh


JSON_CHUNK = 0x4E4F534A
BIN_CHUNK = 0x004E4942
UINT16_COMPONENT = 5123
FLOAT_COMPONENT = 5126
ELEMENT_ARRAY_BUFFER = 34963
ARRAY_BUFFER = 34962

NAVIGATION_NODES = ("frl_apartment_ceiling",)

# The photo wall and mirror are PlayCanvas primitives created after the baked
# room is instantiated, so they do not exist in the ReplicaCAD source GLB.
# Keep deterministic collision proxies for their complete solid visual bounds
# in this builder so Ammo and the navigation mask consume the same geometry.
PHOTO_ROOT_LOCAL_POSITION = np.asarray((-2.28, 1.76, 0.22), dtype=np.float64)
PHOTO_ASSEMBLY_LOCAL_BOUNDS = np.asarray(
    ((-0.97, -0.59, -0.05), (0.97, 0.59, 0.088)),
    dtype=np.float64,
)
MIRROR_LAYOUT_MAX_X_INSET = 0.26
MIRROR_LAYOUT_CENTER_Z_OFFSET = -0.42
MIRROR_ROOT_Y = 1.62
MIRROR_FRAME_LOCAL_BOUNDS = np.asarray(
    ((-0.08, -1.04, -0.65), (0.08, 1.04, 0.65)),
    dtype=np.float64,
)
MIRROR_GLASS_STACK_LOCAL_BOUNDS = np.asarray(
    ((-0.55, -0.93, -0.02), (0.55, 0.93, 0.045)),
    dtype=np.float64,
)

# This is the exact transform used by the first room after the source shell is
# centered and flipped. Baking it here lets Ammo consume an identity transform.
WORLD_X_CENTER = 0.9672019277327584
WORLD_SOURCE_MAX_Y = 3.0594984802795864
WORLD_Z_CENTER = 1.7042481847957798
WORLD_TRANSFORM = np.asarray(
    (
        (1.0, 0.0, 0.0, -WORLD_X_CENTER),
        (0.0, -1.0, 0.0, WORLD_SOURCE_MAX_Y),
        (0.0, 0.0, -1.0, WORLD_Z_CENTER),
        (0.0, 0.0, 0.0, 1.0),
    ),
    dtype=np.float64,
)


def sha256_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def load_scene(source: Path) -> trimesh.Scene:
    scene = trimesh.load(source, force="scene", process=False)
    if not scene.graph.nodes_geometry:
        raise RuntimeError("The GLB contains no triangle geometry.")
    return scene


def validate_first_room_alignment(scene: trimesh.Scene) -> None:
    bounds = np.asarray(scene.bounds, dtype=np.float64)
    alignment = np.asarray(
        (
            (bounds[0, 0] + bounds[1, 0]) * 0.5,
            bounds[1, 1],
            (bounds[0, 2] + bounds[1, 2]) * 0.5,
        )
    )
    expected = np.asarray(
        (WORLD_X_CENTER, WORLD_SOURCE_MAX_Y, WORLD_Z_CENTER),
        dtype=np.float64,
    )
    if not np.allclose(alignment, expected, rtol=0.0, atol=1e-7):
        raise RuntimeError(
            "Source bounds no longer match the baked first-room world transform."
        )


def world_meshes(scene: trimesh.Scene) -> list[tuple[str, trimesh.Trimesh]]:
    parts: list[tuple[str, trimesh.Trimesh]] = []
    for node_name in scene.graph.nodes_geometry:
        transform, geometry_name = scene.graph[node_name]
        part = scene.geometry[geometry_name].copy()
        part.apply_transform(transform)
        parts.append((node_name, part))
    return parts


def optimize_collision_mesh(
    parts: list[tuple[str, trimesh.Trimesh]],
) -> tuple[trimesh.Trimesh, np.ndarray, dict[str, int]]:
    merged = trimesh.util.concatenate([part for _, part in parts])
    navigation_support_faces = np.concatenate(
        [
            np.full(len(part.faces), node_name in NAVIGATION_NODES, dtype=bool)
            for node_name, part in parts
        ]
    )
    source_vertices = int(len(merged.vertices))
    source_triangles = int(len(merged.faces))

    positions = np.asarray(merged.vertices, dtype=np.float32)
    if not np.isfinite(positions).all():
        raise RuntimeError("The source contains non-finite vertex positions.")

    # Weld only exact values after the final float32 conversion. No point moves.
    unique_positions, inverse = np.unique(positions, axis=0, return_inverse=True)
    exact_unique_positions = int(len(unique_positions))
    remapped_faces = inverse[np.asarray(merged.faces, dtype=np.int64)]
    collision = trimesh.Trimesh(
        vertices=unique_positions,
        faces=remapped_faces,
        process=False,
    )

    nondegenerate = collision.nondegenerate_faces(height=1e-8)
    removed_degenerate = int((~nondegenerate).sum())
    collision.update_faces(nondegenerate)
    navigation_support_faces = navigation_support_faces[nondegenerate]

    unique = collision.unique_faces()
    removed_duplicate = int((~unique).sum())
    collision.update_faces(unique)
    navigation_support_faces = navigation_support_faces[unique]

    before_unreferenced = int(len(collision.vertices))
    collision.remove_unreferenced_vertices()
    removed_unreferenced = before_unreferenced - int(len(collision.vertices))
    collision.visual = trimesh.visual.ColorVisuals(mesh=collision)
    collision.vertices = np.asarray(collision.vertices, dtype=np.float32)

    if len(collision.vertices) > np.iinfo(np.uint16).max + 1:
        raise RuntimeError(
            f"Collision mesh has {len(collision.vertices)} vertices; UINT16 supports 65536."
        )
    if int(navigation_support_faces.sum()) != 12:
        raise RuntimeError(
            "Expected exactly 12 first-room ceiling support triangles after cleanup."
        )

    stats = {
        "source_vertices": source_vertices,
        "source_triangles": source_triangles,
        "exact_unique_position_vertices": exact_unique_positions,
        "welded_vertices": source_vertices - exact_unique_positions,
        "removed_degenerate_triangles": removed_degenerate,
        "removed_duplicate_triangles": removed_duplicate,
        "removed_unreferenced_vertices": removed_unreferenced,
        "navigation_support_triangles": int(navigation_support_faces.sum()),
    }
    return collision, navigation_support_faces, stats


def apply_first_room_world_transform(
    mesh: trimesh.Trimesh,
    *,
    quantize_float32: bool,
) -> trimesh.Trimesh:
    mesh.apply_transform(WORLD_TRANSFORM)
    if quantize_float32:
        # GLB positions are float32. Quantize before validation so the exported
        # mesh and the mesh used to build its metadata are byte-for-byte equal.
        mesh.vertices = np.asarray(mesh.vertices, dtype=np.float32).astype(np.float64)
    return mesh


def box_from_bounds(
    bounds: np.ndarray,
    transform: np.ndarray,
) -> trimesh.Trimesh:
    bounds = np.asarray(bounds, dtype=np.float64)
    if bounds.shape != (2, 3) or np.any(bounds[1] <= bounds[0]):
        raise RuntimeError("Semantic collision proxy bounds are invalid.")
    center = (bounds[0] + bounds[1]) * 0.5
    extents = bounds[1] - bounds[0]
    local = trimesh.transformations.translation_matrix(center)
    proxy = trimesh.creation.box(extents=extents, transform=transform @ local)
    proxy.visual = trimesh.visual.ColorVisuals(mesh=proxy)
    return proxy


def append_semantic_collision_proxies(
    collision: trimesh.Trimesh,
    navigation_support_faces: np.ndarray,
) -> tuple[trimesh.Trimesh, np.ndarray, dict[str, object]]:
    """Append solid runtime-built props missing from the source GLB."""
    source_bounds = np.asarray(collision.bounds, dtype=np.float64).copy()

    # room.root is rotated 180 degrees around X and positioned so its local
    # y maps to 3.2 - y. The final photo wall is rotated 90 degrees around Y.
    photo_root_world = np.asarray(
        (
            PHOTO_ROOT_LOCAL_POSITION[0],
            3.2 - PHOTO_ROOT_LOCAL_POSITION[1],
            -PHOTO_ROOT_LOCAL_POSITION[2],
        ),
        dtype=np.float64,
    )
    photo_rotation = trimesh.transformations.rotation_matrix(
        np.pi,
        (1.0, 0.0, 0.0),
    ) @ trimesh.transformations.rotation_matrix(
        np.pi / 2.0,
        (0.0, 1.0, 0.0),
    )
    photo_transform = (
        trimesh.transformations.translation_matrix(photo_root_world)
        @ photo_rotation
    )

    mirror_root_world = np.asarray(
        (
            source_bounds[1, 0] - MIRROR_LAYOUT_MAX_X_INSET,
            MIRROR_ROOT_Y,
            ((source_bounds[0, 2] + source_bounds[1, 2]) * 0.5)
            + MIRROR_LAYOUT_CENTER_Z_OFFSET,
        ),
        dtype=np.float64,
    )
    mirror_transform = trimesh.transformations.translation_matrix(mirror_root_world)
    mirror_transform = mirror_transform @ trimesh.transformations.rotation_matrix(
        -np.pi / 2.0,
        (0.0, 1.0, 0.0),
    )

    proxy_specs = (
        ("runtime_photo_wall", PHOTO_ASSEMBLY_LOCAL_BOUNDS, photo_transform),
        ("runtime_mirror_frame", MIRROR_FRAME_LOCAL_BOUNDS, mirror_transform),
        (
            "runtime_mirror_glass_stack",
            MIRROR_GLASS_STACK_LOCAL_BOUNDS,
            mirror_transform,
        ),
    )
    proxies = [box_from_bounds(bounds, transform) for _, bounds, transform in proxy_specs]
    proxy_vertices = sum(len(proxy.vertices) for proxy in proxies)
    proxy_triangles = sum(len(proxy.faces) for proxy in proxies)

    combined = trimesh.util.concatenate([collision, *proxies])
    combined.visual = trimesh.visual.ColorVisuals(mesh=combined)
    combined.vertices = np.asarray(combined.vertices, dtype=np.float32).astype(np.float64)
    support = np.concatenate(
        (
            np.asarray(navigation_support_faces, dtype=bool),
            np.zeros(proxy_triangles, dtype=bool),
        )
    )
    if len(support) != len(combined.faces):
        raise RuntimeError("Semantic collision proxy provenance is invalid.")
    if not combined.nondegenerate_faces(height=1e-8).all():
        raise RuntimeError("Semantic collision proxies introduced a degenerate face.")
    if len(combined.vertices) > np.iinfo(np.uint16).max + 1:
        raise RuntimeError("Semantic collision proxies exceed UINT16 vertex capacity.")

    proxy_bounds = {
        name: np.asarray(proxy.bounds).round(6).tolist()
        for (name, _, _), proxy in zip(proxy_specs, proxies, strict=True)
    }
    return combined, support, {
        "semantic_collision_proxy_names": [name for name, _, _ in proxy_specs],
        "semantic_collision_proxy_count": len(proxies),
        "semantic_collision_proxy_vertices": proxy_vertices,
        "semantic_collision_proxy_triangles": proxy_triangles,
        "semantic_collision_proxy_bounds": proxy_bounds,
    }


def pad4(payload: bytes, padding: bytes) -> bytes:
    return payload + padding * ((-len(payload)) % 4)


def collision_glb_bytes(mesh: trimesh.Trimesh) -> bytes:
    positions = np.ascontiguousarray(mesh.vertices, dtype="<f4")
    faces = np.asarray(mesh.faces, dtype=np.int64)
    if faces.min() < 0 or faces.max() > np.iinfo(np.uint16).max:
        raise RuntimeError("Collision indices do not fit in UINT16.")
    indices = np.ascontiguousarray(faces.reshape(-1), dtype="<u2")

    index_bytes = indices.tobytes()
    aligned_indices = pad4(index_bytes, b"\x00")
    position_offset = len(aligned_indices)
    binary = pad4(aligned_indices + positions.tobytes(), b"\x00")

    document = {
        "scene": 0,
        "scenes": [{"nodes": [0]}],
        "asset": {
            "version": "2.0",
            "generator": "playcanvas-upside-first-room-collision-builder",
        },
        "accessors": [
            {
                "bufferView": 0,
                "componentType": UINT16_COMPONENT,
                "count": int(indices.size),
                "type": "SCALAR",
                "min": [int(indices.min())],
                "max": [int(indices.max())],
            },
            {
                "bufferView": 1,
                "componentType": FLOAT_COMPONENT,
                "count": int(len(positions)),
                "type": "VEC3",
                "min": positions.min(axis=0).astype(float).tolist(),
                "max": positions.max(axis=0).astype(float).tolist(),
            },
        ],
        "bufferViews": [
            {
                "buffer": 0,
                "byteOffset": 0,
                "byteLength": len(index_bytes),
                "target": ELEMENT_ARRAY_BUFFER,
            },
            {
                "buffer": 0,
                "byteOffset": position_offset,
                "byteLength": int(positions.nbytes),
                "target": ARRAY_BUFFER,
            },
        ],
        "buffers": [{"byteLength": len(binary)}],
        "meshes": [
            {
                "name": "RoomCollision",
                "primitives": [
                    {
                        "attributes": {"POSITION": 1},
                        "indices": 0,
                        "mode": 4,
                    }
                ],
            }
        ],
        "nodes": [{"name": "RoomCollision", "mesh": 0}],
    }

    json_bytes = pad4(
        json.dumps(document, ensure_ascii=True, separators=(",", ":")).encode("utf-8"),
        b" ",
    )
    total_length = 12 + 8 + len(json_bytes) + 8 + len(binary)
    return b"".join(
        (
            struct.pack("<4sII", b"glTF", 2, total_length),
            struct.pack("<II", len(json_bytes), JSON_CHUNK),
            json_bytes,
            struct.pack("<II", len(binary), BIN_CHUNK),
            binary,
        )
    )


def read_glb_json(payload: bytes) -> dict[str, object]:
    magic, version, total_length = struct.unpack_from("<4sII", payload, 0)
    if magic != b"glTF" or version != 2 or total_length != len(payload):
        raise RuntimeError("Invalid GLB header.")
    chunk_length, chunk_type = struct.unpack_from("<II", payload, 12)
    if chunk_type != JSON_CHUNK:
        raise RuntimeError("The first GLB chunk is not JSON.")
    return json.loads(payload[20 : 20 + chunk_length])


def export_collision(mesh: trimesh.Trimesh, destination: Path) -> bytes:
    payload = collision_glb_bytes(mesh)
    document = read_glb_json(payload)
    if document["accessors"][0]["componentType"] != UINT16_COMPONENT:
        raise RuntimeError("Collision GLB did not encode UINT16 indices.")
    loaded = trimesh.load(
        io.BytesIO(payload),
        file_type="glb",
        force="mesh",
        process=False,
    )
    if not np.array_equal(np.asarray(loaded.vertices), np.asarray(mesh.vertices)):
        raise RuntimeError("Collision GLB changed vertex coordinates during export.")
    if not np.array_equal(np.asarray(loaded.faces), np.asarray(mesh.faces)):
        raise RuntimeError("Collision GLB changed triangle indices during export.")
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(payload)
    return payload


def navigation_mesh(
    scene: trimesh.Scene,
) -> tuple[trimesh.Trimesh, np.ndarray]:
    parts: list[trimesh.Trimesh] = []
    face_sources: list[np.ndarray] = []
    available = set(scene.graph.nodes_geometry)
    missing = [name for name in NAVIGATION_NODES if name not in available]
    if missing:
        raise RuntimeError(f"Missing navigation surface nodes: {', '.join(missing)}")

    for source_id, node_name in enumerate(NAVIGATION_NODES):
        transform, geometry_name = scene.graph[node_name]
        part = scene.geometry[geometry_name].copy()
        part.apply_transform(transform)
        apply_first_room_world_transform(part, quantize_float32=False)
        parts.append(part)
        face_sources.append(np.full(len(part.faces), source_id, dtype=np.int8))
    return trimesh.util.concatenate(parts), np.concatenate(face_sources)


def collect_height_layers(
    mesh: trimesh.Trimesh,
    face_sources: np.ndarray,
    origin: np.ndarray,
    width: int,
    height: int,
    cell_size: float,
    max_slope_degrees: float,
    layer_cluster: float,
) -> tuple[list[list[float]], list[list[int]]]:
    ix, iz = np.meshgrid(np.arange(width), np.arange(height), indexing="xy")
    ray_count = width * height
    origins = np.column_stack(
        (
            origin[0] + (ix.ravel() + 0.5) * cell_size,
            np.full(ray_count, float(mesh.bounds[1, 1]) + 0.5),
            origin[1] + (iz.ravel() + 0.5) * cell_size,
        )
    )
    directions = np.tile((0.0, -1.0, 0.0), (ray_count, 1))
    locations, ray_ids, triangle_ids = mesh.ray.intersects_location(
        origins,
        directions,
        multiple_hits=True,
    )

    slope_cosine = float(np.cos(np.deg2rad(max_slope_degrees)))
    walkable = mesh.face_normals[triangle_ids, 1] >= slope_cosine
    locations = locations[walkable]
    ray_ids = ray_ids[walkable]
    triangle_ids = triangle_ids[walkable]
    source_ids = face_sources[triangle_ids]

    layers: list[list[float]] = [[] for _ in range(ray_count)]
    layer_sources: list[list[int]] = [[] for _ in range(ray_count)]
    order = np.lexsort((locations[:, 1], ray_ids))
    for item in order:
        ray_id = int(ray_ids[item])
        y = float(locations[item, 1])
        source_bit = 1 << int(source_ids[item])
        if not layers[ray_id] or y - layers[ray_id][-1] > layer_cluster:
            layers[ray_id].append(y)
            layer_sources[ray_id].append(source_bit)
        else:
            layers[ray_id][-1] = max(layers[ray_id][-1], y)
            layer_sources[ray_id][-1] |= source_bit
    return layers, layer_sources


def filter_vertical_clearance(
    collision: trimesh.Trimesh,
    layers: list[list[float]],
    origin: np.ndarray,
    width: int,
    cell_size: float,
    capsule_height: float,
    clearance_margin: float,
    surface_epsilon: float,
) -> tuple[set[tuple[int, int]], dict[str, int | float]]:
    """Reject layers blocked inside the capsule's vertical standing segment."""
    required_clearance = capsule_height + clearance_margin
    if required_clearance <= 0.0:
        raise RuntimeError("Navigation vertical clearance must be positive.")
    if surface_epsilon <= 0.0 or surface_epsilon >= required_clearance:
        raise RuntimeError("Navigation clearance surface epsilon is invalid.")

    records = [
        (cell, layer_id)
        for cell, cell_layers in enumerate(layers)
        for layer_id in range(len(cell_layers))
    ]
    if not records:
        raise RuntimeError("Navigation surface sampling produced no height layers.")

    cells = np.fromiter((cell for cell, _ in records), dtype=np.int64)
    foot_heights = np.fromiter(
        (layers[cell][layer_id] for cell, layer_id in records),
        dtype=np.float64,
    )
    ray_origins = np.column_stack(
        (
            origin[0] + (cells % width + 0.5) * cell_size,
            foot_heights + surface_epsilon,
            origin[1] + (cells // width + 0.5) * cell_size,
        )
    )
    ray_directions = np.tile((0.0, 1.0, 0.0), (len(records), 1))

    # Trimesh ray tests are double-sided, so back-facing ceiling triangles count.
    locations, ray_ids, _ = collision.ray.intersects_location(
        ray_origins,
        ray_directions,
        multiple_hits=True,
    )
    nearest = np.full(len(records), np.inf, dtype=np.float64)
    if len(ray_ids):
        distances = locations[:, 1] - foot_heights[ray_ids]
        if np.any(distances < surface_epsilon - 1e-7):
            raise RuntimeError("Vertical-clearance ray returned a hit behind its origin.")
        np.minimum.at(nearest, ray_ids, distances)

    blocked = nearest <= required_clearance + 1e-9
    allowed = {
        record for record_id, record in enumerate(records) if not blocked[record_id]
    }
    tested_cells = len({cell for cell, _ in records})
    passed_cells = len({cell for cell, _ in allowed})
    finite = np.isfinite(nearest)
    return allowed, {
        "clearance_tested_cells": tested_cells,
        "clearance_tested_layers": len(records),
        "clearance_passed_cells": passed_cells,
        "clearance_passed_layers": len(allowed),
        "clearance_fully_rejected_cells": tested_cells - passed_cells,
        "clearance_rejected_layers": int(blocked.sum()),
        "clearance_open_upward_layers": int((~finite).sum()),
        "clearance_nearest_blocker_min_m": round(float(nearest[finite].min()), 6)
        if finite.any()
        else 0.0,
    }


def disk_offsets(radius: float, cell_size: float) -> tuple[tuple[int, int], ...]:
    cells = int(np.ceil(radius / cell_size))
    return tuple(
        (dx, dz)
        for dz in range(-cells, cells + 1)
        for dx in range(-cells, cells + 1)
        if (dx * cell_size) ** 2 + (dz * cell_size) ** 2
        <= radius**2 + 1e-12
    )


def select_spawn_layer(
    layers: list[list[float]],
    width: int,
    height: int,
    origin: np.ndarray,
    cell_size: float,
    spawn: np.ndarray,
    capsule_height: float,
    allowed: set[tuple[int, int]] | None = None,
) -> tuple[tuple[int, int], int, int, float]:
    spawn_ix = int(np.floor((spawn[0] - origin[0]) / cell_size))
    spawn_iz = int(np.floor((spawn[2] - origin[1]) / cell_size))
    if not (0 <= spawn_ix < width and 0 <= spawn_iz < height):
        raise RuntimeError("Spawn lies outside the navigation grid.")

    spawn_cell = spawn_iz * width + spawn_ix
    if not layers[spawn_cell]:
        raise RuntimeError("Spawn has no walkable height layer.")
    expected_foot_y = float(spawn[1] - capsule_height * 0.5)
    candidates = [
        layer_id
        for layer_id in range(len(layers[spawn_cell]))
        if allowed is None or (spawn_cell, layer_id) in allowed
    ]
    if not candidates:
        raise RuntimeError("Spawn was removed by layer-aware navigation erosion.")
    spawn_layer = min(
        candidates,
        key=lambda layer_id: abs(layers[spawn_cell][layer_id] - expected_foot_y),
    )
    return (
        (spawn_cell, spawn_layer),
        spawn_ix,
        spawn_iz,
        float(layers[spawn_cell][spawn_layer]),
    )


def flood_layer_graph(
    layers: list[list[float]],
    width: int,
    height: int,
    start: tuple[int, int],
    max_rise: float,
    allowed: set[tuple[int, int]] | None = None,
) -> set[tuple[int, int]]:
    if allowed is not None and start not in allowed:
        return set()

    visited: set[tuple[int, int]] = {start}
    queue: deque[tuple[int, int]] = deque([start])
    while queue:
        cell, layer_id = queue.popleft()
        ix = cell % width
        iz = cell // width
        current_height = layers[cell][layer_id]
        for nx, nz in ((ix - 1, iz), (ix + 1, iz), (ix, iz - 1), (ix, iz + 1)):
            if nx < 0 or nz < 0 or nx >= width or nz >= height:
                continue
            neighbor = nz * width + nx
            for neighbor_layer, neighbor_height in enumerate(layers[neighbor]):
                key = (neighbor, neighbor_layer)
                if key in visited or (allowed is not None and key not in allowed):
                    continue
                if abs(neighbor_height - current_height) <= max_rise + 1e-9:
                    visited.add(key)
                    queue.append(key)
    return visited


def erode_layer_component(
    layers: list[list[float]],
    component: set[tuple[int, int]],
    width: int,
    height: int,
    radius: float,
    cell_size: float,
    max_rise: float,
) -> set[tuple[int, int]]:
    """Keep a layer only when its local height-connected disk has full support."""
    offsets = disk_offsets(radius, cell_size)
    radius_cells = max(max(abs(dx), abs(dz)) for dx, dz in offsets)
    radius_squared = (radius / cell_size) ** 2 + 1e-9
    layers_by_cell: list[list[int]] = [[] for _ in range(width * height)]
    for cell, layer_id in component:
        layers_by_cell[cell].append(layer_id)
    for layer_ids in layers_by_cell:
        layer_ids.sort()

    survivors: set[tuple[int, int]] = set()
    for start in sorted(component):
        cell, layer_id = start
        center_x = cell % width
        center_z = cell // width
        if (
            center_x < radius_cells
            or center_z < radius_cells
            or center_x + radius_cells >= width
            or center_z + radius_cells >= height
        ):
            continue

        target_cells: list[int] = []
        complete = True
        for dx, dz in offsets:
            target = (center_z + dz) * width + center_x + dx
            if not layers_by_cell[target]:
                complete = False
                break
            target_cells.append(target)
        if not complete:
            continue

        seen: set[tuple[int, int]] = {start}
        covered = {cell}
        queue: deque[tuple[int, int]] = deque([start])
        while queue and len(covered) < len(target_cells):
            current_cell, current_layer = queue.popleft()
            current_x = current_cell % width
            current_z = current_cell // width
            current_height = layers[current_cell][current_layer]
            for nx, nz in (
                (current_x - 1, current_z),
                (current_x + 1, current_z),
                (current_x, current_z - 1),
                (current_x, current_z + 1),
            ):
                dx = nx - center_x
                dz = nz - center_z
                if dx * dx + dz * dz > radius_squared:
                    continue
                neighbor = nz * width + nx
                for neighbor_layer in layers_by_cell[neighbor]:
                    key = (neighbor, neighbor_layer)
                    if key in seen:
                        continue
                    if (
                        abs(layers[neighbor][neighbor_layer] - current_height)
                        <= max_rise + 1e-9
                    ):
                        seen.add(key)
                        covered.add(neighbor)
                        queue.append(key)
        if len(covered) == len(target_cells):
            survivors.add(start)
    return survivors


def collision_without_navigation_support(
    collision: trimesh.Trimesh,
    navigation_support_faces: np.ndarray,
) -> trimesh.Trimesh:
    support = np.asarray(navigation_support_faces, dtype=bool)
    if len(support) != len(collision.faces):
        raise RuntimeError("Navigation support face provenance no longer matches collision.")
    obstacles = collision.copy()
    obstacles.update_faces(~support)
    obstacles.remove_unreferenced_vertices()
    if len(collision.faces) - len(obstacles.faces) != int(support.sum()):
        raise RuntimeError("Obstacle mesh did not remove exactly the support faces.")
    return obstacles


def capped_point_mesh_distances(
    mesh: trimesh.Trimesh,
    points: np.ndarray,
    threshold: float,
    query_tolerance: float,
) -> tuple[np.ndarray, int, int, str]:
    """Return exact sub-threshold distances and cap certified-safe values."""
    points = np.asarray(points, dtype=np.float64)
    query_radius = threshold + query_tolerance
    bounds = np.column_stack((points - query_radius, points + query_radius))
    tree = mesh.triangles_tree
    try:
        hit_ids, hit_counts = tree.intersection_v(
            bounds[:, :3],
            bounds[:, 3:],
        )
        query_backend = "rtree_intersection_v"
    except (AttributeError, NameError):
        candidates = [list(tree.intersection(bound)) for bound in bounds]
        hit_counts = np.fromiter(
            (len(candidate) for candidate in candidates),
            dtype=np.int64,
            count=len(candidates),
        )
        hit_ids = (
            np.concatenate(candidates)
            if int(hit_counts.sum())
            else np.empty(0, dtype=np.int64)
        )
        query_backend = "rtree_scalar_intersection_fallback"
    hit_ids = np.asarray(hit_ids, dtype=np.int64)
    hit_counts = np.asarray(hit_counts, dtype=np.int64)
    if len(hit_counts) != len(points) or int(hit_counts.sum()) != len(hit_ids):
        raise RuntimeError("Obstacle R-tree query returned an invalid candidate layout.")

    # A triangle with point distance below threshold must intersect this cube.
    # Values initialized to threshold are certified lower bounds, not claimed
    # exact distances, for samples whose true nearest point lies farther away.
    capped = np.full(len(points), threshold, dtype=np.float64)
    if len(hit_ids):
        point_ids = np.repeat(np.arange(len(points), dtype=np.int64), hit_counts)
        triangles = mesh.triangles.view(np.ndarray)[hit_ids]
        closest = trimesh.triangles.closest_point(triangles, points[point_ids])
        distances = np.linalg.norm(points[point_ids] - closest, axis=1)
        np.minimum.at(capped, point_ids, distances)
    return capped, len(hit_ids), int((hit_counts == 0).sum()), query_backend


def filter_capsule_axis_clearance(
    collision: trimesh.Trimesh,
    navigation_support_faces: np.ndarray,
    layers: list[list[float]],
    candidates: set[tuple[int, int]],
    origin: np.ndarray,
    width: int,
    cell_size: float,
    capsule_height: float,
    capsule_radius: float,
    capsule_skin: float,
    ground_contact_offset: float,
    axis_sample_step: float,
    center_clearance_threshold: float,
    numerical_epsilon: float,
    chunk_layers: int,
) -> tuple[
    set[tuple[int, int]],
    dict[tuple[int, int], float],
    dict[str, object],
    dict[str, int | float],
]:
    if capsule_radius <= 0.0 or capsule_skin < 0.0:
        raise RuntimeError("Capsule radius and skin must be non-negative.")
    if capsule_height <= capsule_radius * 2.0:
        raise RuntimeError("Capsule height must exceed its diameter.")
    if ground_contact_offset < 0.0:
        raise RuntimeError("Ground contact offset cannot be negative.")
    if axis_sample_step <= 0.0 or axis_sample_step > 0.01:
        raise RuntimeError("Capsule axis sampling must use a step in (0, 0.01] m.")
    if numerical_epsilon < 0.0:
        raise RuntimeError("Capsule clearance numerical epsilon cannot be negative.")
    if chunk_layers <= 0:
        raise RuntimeError("Capsule clearance chunk size must be positive.")
    if not candidates:
        raise RuntimeError("Capsule clearance received no navigation layers.")

    capsule_cylinder_height = capsule_height - capsule_radius * 2.0
    grounded_capsule_center_height = capsule_height * 0.5 - ground_contact_offset
    axis_half_length = capsule_cylinder_height * 0.5
    axis_min_offset = grounded_capsule_center_height - axis_half_length
    axis_max_offset = grounded_capsule_center_height + axis_half_length
    if axis_min_offset < 0.0:
        raise RuntimeError("Grounded capsule axis extends below its navigation foot layer.")
    axis_span = axis_max_offset - axis_min_offset
    axis_segments = max(1, int(np.ceil(axis_span / axis_sample_step)))
    actual_sample_step = axis_span / axis_segments
    axis_offsets = np.linspace(
        axis_min_offset,
        axis_max_offset,
        axis_segments + 1,
        dtype=np.float64,
    )
    cell_corner_guard = float(np.hypot(cell_size * 0.5, cell_size * 0.5))
    axis_guard = actual_sample_step * 0.5
    combined_guard = float(np.hypot(cell_corner_guard, axis_guard))
    required_clearance = capsule_radius + capsule_skin
    minimum_center_threshold = required_clearance + combined_guard + numerical_epsilon
    if center_clearance_threshold + 1e-12 < minimum_center_threshold:
        raise RuntimeError(
            "Center clearance threshold does not cover the cell corner and axis guards."
        )

    obstacles = collision_without_navigation_support(
        collision,
        navigation_support_faces,
    )
    candidate_query_tolerance = max(numerical_epsilon, 1e-8)
    ordered = sorted(candidates)
    minimum_distances: dict[tuple[int, int], float] = {}
    retained: set[tuple[int, int]] = set()
    candidate_triangle_pairs = 0
    maximum_chunk_candidate_pairs = 0
    axis_points_without_candidates = 0
    candidate_query_backend: str | None = None

    for start in range(0, len(ordered), chunk_layers):
        records = ordered[start : start + chunk_layers]
        cells = np.fromiter((cell for cell, _ in records), dtype=np.int64)
        foot_heights = np.fromiter(
            (layers[cell][layer_id] for cell, layer_id in records),
            dtype=np.float64,
        )
        points = np.empty((len(records), len(axis_offsets), 3), dtype=np.float64)
        points[:, :, 0] = (
            origin[0] + (cells % width + 0.5) * cell_size
        )[:, None]
        points[:, :, 1] = foot_heights[:, None] + axis_offsets[None, :]
        points[:, :, 2] = (
            origin[1] + (cells // width + 0.5) * cell_size
        )[:, None]
        (
            distances,
            candidate_pairs,
            no_candidate_points,
            chunk_query_backend,
        ) = capped_point_mesh_distances(
            obstacles,
            points.reshape((-1, 3)),
            center_clearance_threshold,
            candidate_query_tolerance,
        )
        if candidate_query_backend is None:
            candidate_query_backend = chunk_query_backend
        elif candidate_query_backend != chunk_query_backend:
            raise RuntimeError("Obstacle R-tree backend changed during generation.")
        candidate_triangle_pairs += candidate_pairs
        maximum_chunk_candidate_pairs = max(
            maximum_chunk_candidate_pairs,
            candidate_pairs,
        )
        axis_points_without_candidates += no_candidate_points
        if len(distances) != points.shape[0] * points.shape[1]:
            raise RuntimeError("Capsule clearance query returned an invalid result count.")
        if not np.isfinite(distances).all():
            raise RuntimeError("Capsule clearance query returned a non-finite distance.")
        chunk_minimum = distances.reshape(points.shape[:2]).min(axis=1)
        for record, distance in zip(records, chunk_minimum, strict=True):
            value = float(distance)
            minimum_distances[record] = value
            if value >= center_clearance_threshold:
                retained.add(record)

    rejected = candidates - retained
    if not retained:
        raise RuntimeError("Capsule clearance rejected every navigation layer.")
    retained_distances = np.fromiter(
        (minimum_distances[record] for record in retained),
        dtype=np.float64,
    )
    rejected_distances = np.fromiter(
        (minimum_distances[record] for record in rejected),
        dtype=np.float64,
    )
    parameters: dict[str, object] = {
        "capsule_axis_clearance_model": (
            "threshold_aabb_candidates_exact_point_triangle_distance_with_"
            "capped_lower_bounds_and_1_lipschitz_guard"
        ),
        "capsule_axis_obstacle_model": (
            "full_collision_except_source_frl_apartment_ceiling_support_triangles"
        ),
        "capsule_axis_obstacle_triangles": int(len(obstacles.faces)),
        "capsule_axis_excluded_support_triangles": int(
            np.asarray(navigation_support_faces, dtype=bool).sum()
        ),
        "capsule_radius_m": capsule_radius,
        "capsule_skin_m": capsule_skin,
        "capsule_cylinder_height_m": capsule_cylinder_height,
        "ground_contact_offset_m": ground_contact_offset,
        "grounded_capsule_center_height_m": grounded_capsule_center_height,
        "grounded_capsule_center_offset_from_nominal_m": -ground_contact_offset,
        "grounded_capsule_bottom_offset_m": (
            grounded_capsule_center_height - capsule_height * 0.5
        ),
        "grounded_capsule_top_offset_m": (
            grounded_capsule_center_height + capsule_height * 0.5
        ),
        "capsule_axis_min_offset_m": axis_min_offset,
        "capsule_axis_max_offset_m": axis_max_offset,
        "capsule_required_continuous_clearance_m": required_clearance,
        "capsule_axis_sample_step_max_m": axis_sample_step,
        "capsule_axis_sample_step_actual_m": actual_sample_step,
        "capsule_axis_sample_count": len(axis_offsets),
        "capsule_cell_corner_guard_m": cell_corner_guard,
        "capsule_axis_half_step_guard_m": axis_guard,
        "capsule_combined_lipschitz_guard_m": combined_guard,
        "capsule_center_clearance_minimum_m": minimum_center_threshold,
        "capsule_center_clearance_threshold_m": center_clearance_threshold,
        "capsule_clearance_numerical_epsilon_m": numerical_epsilon,
        "capsule_candidate_query_tolerance_m": candidate_query_tolerance,
        "capsule_candidate_query_radius_m": (
            center_clearance_threshold + candidate_query_tolerance
        ),
        "capsule_candidate_query_backend": candidate_query_backend,
        "capsule_distance_value_semantics": (
            "exact below threshold; otherwise a certified lower bound capped at threshold"
        ),
    }
    stats: dict[str, int | float] = {
        "capsule_clearance_tested_cells": len({cell for cell, _ in candidates}),
        "capsule_clearance_tested_layers": len(candidates),
        "capsule_clearance_tested_axis_points": len(candidates) * len(axis_offsets),
        "capsule_clearance_candidate_triangle_pairs": candidate_triangle_pairs,
        "capsule_clearance_max_chunk_candidate_pairs": (
            maximum_chunk_candidate_pairs
        ),
        "capsule_clearance_axis_points_without_candidates": (
            axis_points_without_candidates
        ),
        "capsule_clearance_passed_cells": len({cell for cell, _ in retained}),
        "capsule_clearance_passed_layers": len(retained),
        "capsule_clearance_rejected_cells": len({cell for cell, _ in rejected}),
        "capsule_clearance_rejected_layers": len(rejected),
        "capsule_clearance_center_axis_capped_min_m": round(
            min(minimum_distances.values()),
            9,
        ),
        "capsule_clearance_retained_center_axis_certified_lower_bound_m": round(
            float(retained_distances.min()), 9
        ),
        "capsule_clearance_retained_continuous_certified_lower_bound_m": round(
            float(retained_distances.min()) - combined_guard,
            9,
        ),
        "capsule_clearance_rejected_exact_max_m": round(
            float(rejected_distances.max()), 9
        )
        if len(rejected_distances)
        else 0.0,
    }
    return retained, minimum_distances, parameters, stats


def encode_uint4(values: np.ndarray) -> bytes:
    if values.min(initial=0) < 0 or values.max(initial=0) > 15:
        raise RuntimeError("Navigation layer count does not fit UINT4.")
    padded = np.pad(values.astype(np.uint8), (0, len(values) % 2))
    return (padded[0::2] | (padded[1::2] << 4)).tobytes()


def decode_uint4(payload: bytes, count: int) -> np.ndarray:
    packed = np.frombuffer(payload, dtype=np.uint8)
    values = np.empty(len(packed) * 2, dtype=np.uint8)
    values[0::2] = packed & 0x0F
    values[1::2] = packed >> 4
    return values[:count]


def serialize_layers(
    layers: list[list[float]],
    component: set[tuple[int, int]],
    cell_count: int,
    height_scale: float,
) -> tuple[np.ndarray, bytes, bytes, int]:
    layer_ids_by_cell: list[list[int]] = [[] for _ in range(cell_count)]
    for cell, layer_id in component:
        layer_ids_by_cell[cell].append(layer_id)

    counts = np.zeros(cell_count, dtype=np.uint8)
    heights: list[float] = []
    for cell, layer_ids in enumerate(layer_ids_by_cell):
        layer_ids.sort(key=lambda layer_id: layers[cell][layer_id])
        if len(layer_ids) > 15:
            raise RuntimeError(f"Cell {cell} has more than 15 navigation layers.")
        counts[cell] = len(layer_ids)
        heights.extend(layers[cell][layer_id] for layer_id in layer_ids)

    quantized = np.rint(np.asarray(heights) / height_scale).astype(np.int64)
    if quantized.min(initial=0) < np.iinfo(np.int16).min or quantized.max(
        initial=0
    ) > np.iinfo(np.int16).max:
        raise RuntimeError("Navigation foot heights do not fit INT16.")
    count_bytes = encode_uint4(counts)
    height_bytes = np.ascontiguousarray(quantized, dtype="<i2").tobytes()
    if not np.array_equal(decode_uint4(count_bytes, cell_count), counts):
        raise RuntimeError("Navigation UINT4 layer-count round trip failed.")
    if int(counts.sum()) != len(quantized):
        raise RuntimeError("Navigation layer counts do not match height records.")
    return counts, count_bytes, height_bytes, int(counts.max(initial=0))


def encode_navigation_mask(
    scene: trimesh.Scene,
    collision: trimesh.Trimesh,
    navigation_support_faces: np.ndarray,
    destination: Path,
    *,
    cell_size: float,
    max_slope_degrees: float,
    layer_cluster: float,
    max_rise: float,
    erosion_radius: float,
    spawn: np.ndarray,
    capsule_height: float,
    capsule_radius: float,
    capsule_skin: float,
    ground_contact_offset: float,
    clearance_margin: float,
    clearance_surface_epsilon: float,
    capsule_axis_sample_step: float,
    capsule_center_clearance_threshold: float,
    capsule_clearance_numerical_epsilon: float,
    capsule_clearance_chunk_layers: int,
) -> tuple[dict[str, object], dict[str, object], bytes]:
    support_required_radius = capsule_radius + capsule_skin
    support_cell_corner_guard = float(
        np.hypot(cell_size * 0.5, cell_size * 0.5)
    )
    support_center_erosion_minimum = (
        support_required_radius
        + support_cell_corner_guard
        + capsule_clearance_numerical_epsilon
    )
    if erosion_radius + 1e-12 < support_center_erosion_minimum:
        raise RuntimeError(
            "Support erosion does not cover the capsule and cell-corner guard."
        )
    surface, face_sources = navigation_mesh(scene)
    collision_bounds = np.asarray(collision.bounds, dtype=np.float64)
    origin = collision_bounds[0, (0, 2)]
    width = int(np.ceil((collision_bounds[1, 0] - origin[0]) / cell_size))
    height = int(np.ceil((collision_bounds[1, 2] - origin[1]) / cell_size))

    layers, layer_sources = collect_height_layers(
        surface,
        face_sources,
        origin,
        width,
        height,
        cell_size,
        max_slope_degrees,
        layer_cluster,
    )
    support = np.asarray([bool(item) for item in layers], dtype=bool).reshape(
        height, width
    )
    clearance_layers, clearance_stats = filter_vertical_clearance(
        collision,
        layers,
        origin,
        width,
        cell_size,
        capsule_height,
        clearance_margin,
        clearance_surface_epsilon,
    )
    spawn_node, spawn_ix, spawn_iz, spawn_ground = select_spawn_layer(
        layers,
        width,
        height,
        origin,
        cell_size,
        spawn,
        capsule_height - ground_contact_offset * 2.0,
        allowed=clearance_layers,
    )
    preconnected = flood_layer_graph(
        layers,
        width,
        height,
        spawn_node,
        max_rise,
        allowed=clearance_layers,
    )
    eroded_layers = erode_layer_component(
        layers,
        preconnected,
        width,
        height,
        erosion_radius,
        cell_size,
        max_rise,
    )
    (
        capsule_clearance_layers,
        capsule_minimum_distances,
        capsule_clearance_parameters,
        capsule_clearance_stats,
    ) = filter_capsule_axis_clearance(
        collision,
        navigation_support_faces,
        layers,
        eroded_layers,
        origin,
        width,
        cell_size,
        capsule_height,
        capsule_radius,
        capsule_skin,
        ground_contact_offset,
        capsule_axis_sample_step,
        capsule_center_clearance_threshold,
        capsule_clearance_numerical_epsilon,
        capsule_clearance_chunk_layers,
    )
    eroded_spawn, spawn_ix, spawn_iz, spawn_ground = select_spawn_layer(
        layers,
        width,
        height,
        origin,
        cell_size,
        spawn,
        capsule_height - ground_contact_offset * 2.0,
        allowed=capsule_clearance_layers,
    )
    connected_layers = flood_layer_graph(
        layers,
        width,
        height,
        eroded_spawn,
        max_rise,
        allowed=capsule_clearance_layers,
    )

    connected_cells_set = {cell for cell, _ in connected_layers}
    boundary_layers = {
        (cell, layer_id)
        for cell, layer_id in connected_layers
        if any(
            nx < 0
            or nz < 0
            or nx >= width
            or nz >= height
            or nz * width + nx not in connected_cells_set
            for nx, nz in (
                (cell % width - 1, cell // width),
                (cell % width + 1, cell // width),
                (cell % width, cell // width - 1),
                (cell % width, cell // width + 1),
            )
        )
    }
    final_minimum_distance = min(
        capsule_minimum_distances[record] for record in connected_layers
    )
    boundary_minimum_distance = min(
        capsule_minimum_distances[record] for record in boundary_layers
    )
    combined_guard = float(
        capsule_clearance_parameters["capsule_combined_lipschitz_guard_m"]
    )
    required_continuous_clearance = capsule_radius + capsule_skin
    boundary_continuous_lower_bound = boundary_minimum_distance - combined_guard
    if (
        boundary_continuous_lower_bound + capsule_clearance_numerical_epsilon
        < required_continuous_clearance
    ):
        raise RuntimeError("Final navigation boundary failed capsule clearance proof.")

    height_scale = 0.001
    counts, count_bytes, height_bytes, max_layers_per_cell = serialize_layers(
        layers,
        connected_layers,
        width * height,
        height_scale,
    )
    connected = counts.reshape(height, width) > 0

    packed_mask = np.packbits(connected.reshape(-1), bitorder="little").tobytes()
    mask_sha256 = sha256_bytes(packed_mask)
    connected_heights = np.asarray(
        [layers[cell][layer_id] for cell, layer_id in connected_layers],
        dtype=np.float64,
    )
    coarse_components = int(ndimage.label(connected)[1])
    sampled_layers = {
        (cell, layer_id)
        for cell, cell_layers in enumerate(layers)
        for layer_id in range(len(cell_layers))
    }
    stage_layers = {
        "sampled": sampled_layers,
        "clearance_passed": clearance_layers,
        "preconnected": preconnected,
        "eroded": eroded_layers,
        "capsule_clearance": capsule_clearance_layers,
        "connected": connected_layers,
    }
    source_layer_stats: dict[str, dict[str, int]] = {}
    for source_id, node_name in enumerate(NAVIGATION_NODES):
        source_bit = 1 << source_id
        node_stats: dict[str, int] = {}
        for stage_name, stage in stage_layers.items():
            attributed = {
                (cell, layer_id)
                for cell, layer_id in stage
                if layer_sources[cell][layer_id] & source_bit
            }
            node_stats[f"{stage_name}_layers"] = len(attributed)
            node_stats[f"{stage_name}_cells"] = len(
                {cell for cell, _ in attributed}
            )
        source_layer_stats[node_name] = node_stats

    connected_cells = int(connected.sum())
    eroded_cells = len({cell for cell, _ in eroded_layers})
    capsule_clearance_cells = len(
        {cell for cell, _ in capsule_clearance_layers}
    )
    grid_max = [
        float(origin[0] + width * cell_size),
        float(origin[1] + height * cell_size),
    ]
    parameters = {
        "max_slope_degrees": max_slope_degrees,
        "layer_cluster_m": layer_cluster,
        "max_rise_m": max_rise,
        "erosion_radius_m": erosion_radius,
        "support_required_radius_m": support_required_radius,
        "support_cell_corner_guard_m": support_cell_corner_guard,
        "support_center_erosion_minimum_m": support_center_erosion_minimum,
        "support_center_erosion_threshold_m": erosion_radius,
        "capsule_height_m": capsule_height,
        **capsule_clearance_parameters,
        "clearance_margin_m": clearance_margin,
        "required_vertical_clearance_m": capsule_height + clearance_margin,
        "clearance_surface_epsilon_m": clearance_surface_epsilon,
        "clearance_model": "double_sided_upward_segment_against_full_collision",
        "connectivity": 4,
        "height_model": "clustered_multi_layer",
        "erosion_model": (
            "local_height_connected_disk_coverage_with_cell_corner_guard"
        ),
        "floor_surface_model": "upside_down_source_ceiling",
        "surface_nodes": list(NAVIGATION_NODES),
        "world_transform": WORLD_TRANSFORM.astype(float).tolist(),
        "spawn": spawn.astype(float).tolist(),
    }
    stats = {
        "grid_cells": width * height,
        "support_cells": int(support.sum()),
        "support_layers": sum(len(item) for item in layers),
        **clearance_stats,
        "preconnected_cells": len({cell for cell, _ in preconnected}),
        "preconnected_layers": len(preconnected),
        "eroded_cells": eroded_cells,
        "eroded_layers": len(eroded_layers),
        **capsule_clearance_stats,
        "capsule_clearance_final_cells": connected_cells,
        "capsule_clearance_final_layers": len(connected_layers),
        "capsule_clearance_final_center_axis_certified_lower_bound_m": round(
            final_minimum_distance,
            9,
        ),
        "capsule_clearance_final_continuous_certified_lower_bound_m": round(
            final_minimum_distance - combined_guard,
            9,
        ),
        "capsule_clearance_final_boundary_cells": len(
            {cell for cell, _ in boundary_layers}
        ),
        "capsule_clearance_final_boundary_layers": len(boundary_layers),
        "capsule_clearance_final_boundary_center_axis_certified_lower_bound_m": round(
            boundary_minimum_distance,
            9,
        ),
        "capsule_clearance_final_boundary_continuous_certified_lower_bound_m": round(
            boundary_continuous_lower_bound,
            9,
        ),
        "coarse_connected_components": coarse_components,
        "connected_cells": connected_cells,
        "connected_layers": len(connected_layers),
        "connected_fraction_of_eroded_cells": round(
            connected_cells / max(1, eroded_cells), 8
        ),
        "connected_fraction_of_eroded_layers": round(
            len(connected_layers) / max(1, len(eroded_layers)), 8
        ),
        "connected_fraction_of_capsule_clearance_cells": round(
            connected_cells / max(1, capsule_clearance_cells), 8
        ),
        "connected_fraction_of_capsule_clearance_layers": round(
            len(connected_layers) / max(1, len(capsule_clearance_layers)), 8
        ),
        "connected_height_min": round(float(connected_heights.min()), 6),
        "connected_height_max": round(float(connected_heights.max()), 6),
        "spawn_cell": [spawn_ix, spawn_iz],
        "spawn_ground_height": round(spawn_ground, 6),
        "max_layers_per_cell": max_layers_per_cell,
        "source_layer_stats": source_layer_stats,
    }
    document: dict[str, object] = {
        "version": 2,
        "cell_size": cell_size,
        "origin": origin.astype(float).tolist(),
        "bounds": {"min": origin.astype(float).tolist(), "max": grid_max},
        "width": width,
        "height": height,
        "bit_order": "lsb0",
        "mask_base64": base64.b64encode(packed_mask).decode("ascii"),
        "connected_cells": connected_cells,
        "connected_layers": len(connected_layers),
        "mask_sha256": mask_sha256,
        "mask_semantics": "coarse cell presence; a foot-height layer match is required",
        "layers": {
            "cell_counts_encoding": "uint4_lsb0",
            "cell_counts_base64": base64.b64encode(count_bytes).decode("ascii"),
            "cell_counts_sha256": sha256_bytes(count_bytes),
            "foot_heights_encoding": "int16_le",
            "foot_height_scale": height_scale,
            "height_quantization_error_max_m": height_scale * 0.5,
            "foot_heights_base64": base64.b64encode(height_bytes).decode("ascii"),
            "foot_heights_sha256": sha256_bytes(height_bytes),
            "record_order": "cell_row_major_then_foot_height_ascending",
            "max_layers_per_cell": max_layers_per_cell,
        },
        "query": {
            "foot_y": "capsule_center_y - capsule_height_m / 2",
            "foot_tolerance_m": 0.08,
            "require_grounded": True,
            "require_layer_match": True,
            "neighbor_layer_delta_max_m": max_rise,
            "neighbor_comparison_epsilon_m": height_scale,
        },
        "parameters": parameters,
        "stats": stats,
    }
    payload = (
        json.dumps(document, ensure_ascii=True, separators=(",", ":")) + "\n"
    ).encode("utf-8")
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(payload)
    return document, stats, payload


def main() -> None:
    parser = argparse.ArgumentParser(
        description=(
            "Build the upside-down first room's world-space UINT16 collision "
            "GLB and spawn-connected 2.5D navigation mask in one pass."
        )
    )
    parser.add_argument("source", type=Path)
    parser.add_argument("destination", type=Path)
    parser.add_argument("--navigation", type=Path, required=True)
    parser.add_argument("--report", type=Path)
    parser.add_argument("--cell-size", type=float, default=0.04)
    parser.add_argument("--max-slope", type=float, default=48.0)
    parser.add_argument("--layer-cluster", type=float, default=0.03)
    parser.add_argument("--max-rise", type=float, default=0.225)
    parser.add_argument("--erosion-radius", type=float, default=0.34)
    parser.add_argument("--capsule-height", type=float, default=1.70)
    parser.add_argument("--capsule-radius", type=float, default=0.28)
    parser.add_argument("--capsule-skin", type=float, default=0.03)
    parser.add_argument("--ground-contact-offset", type=float, default=0.04)
    parser.add_argument("--clearance-margin", type=float, default=0.05)
    parser.add_argument("--clearance-surface-epsilon", type=float, default=0.002)
    parser.add_argument("--capsule-axis-sample-step", type=float, default=0.01)
    parser.add_argument(
        "--capsule-center-clearance-threshold",
        type=float,
        default=0.340001,
    )
    parser.add_argument("--capsule-clearance-numerical-epsilon", type=float, default=1e-6)
    parser.add_argument("--capsule-clearance-chunk-layers", type=int, default=64)
    parser.add_argument("--spawn", nargs=3, type=float, default=(-0.12, 0.81, 0.18))
    args = parser.parse_args()

    scene = load_scene(args.source)
    validate_first_room_alignment(scene)
    parts = world_meshes(scene)
    collision, navigation_support_faces, optimization = optimize_collision_mesh(parts)
    apply_first_room_world_transform(collision, quantize_float32=True)
    collision, navigation_support_faces, semantic_proxies = (
        append_semantic_collision_proxies(collision, navigation_support_faces)
    )
    collision_payload = export_collision(collision, args.destination)

    navigation_document, navigation_stats, navigation_payload = encode_navigation_mask(
        scene,
        collision,
        navigation_support_faces,
        args.navigation,
        cell_size=args.cell_size,
        max_slope_degrees=args.max_slope,
        layer_cluster=args.layer_cluster,
        max_rise=args.max_rise,
        erosion_radius=args.erosion_radius,
        spawn=np.asarray(args.spawn, dtype=np.float64),
        capsule_height=args.capsule_height,
        capsule_radius=args.capsule_radius,
        capsule_skin=args.capsule_skin,
        ground_contact_offset=args.ground_contact_offset,
        clearance_margin=args.clearance_margin,
        clearance_surface_epsilon=args.clearance_surface_epsilon,
        capsule_axis_sample_step=args.capsule_axis_sample_step,
        capsule_center_clearance_threshold=(
            args.capsule_center_clearance_threshold
        ),
        capsule_clearance_numerical_epsilon=(
            args.capsule_clearance_numerical_epsilon
        ),
        capsule_clearance_chunk_layers=args.capsule_clearance_chunk_layers,
    )

    bounds = np.asarray(collision.bounds)
    report = {
        "algorithm": (
            "exact source-space float32 weld, duplicate and degenerate face "
            "removal, first-room world-transform bake, and deterministic "
            "runtime-solid proxy append with UINT16 indices"
        ),
        "coordinate_space": "first_room_world",
        "world_transform": WORLD_TRANSFORM.astype(float).tolist(),
        "navigation_surface": NAVIGATION_NODES[0],
        "source": args.source.name,
        "source_bytes": args.source.stat().st_size,
        "source_sha256": sha256_bytes(args.source.read_bytes()),
        "source_nodes": len(parts),
        **optimization,
        **semantic_proxies,
        "collision_bytes": len(collision_payload),
        "collision_vertices": int(len(collision.vertices)),
        "collision_triangles": int(len(collision.faces)),
        "collision_index_component": "UNSIGNED_SHORT",
        "collision_index_component_type": UINT16_COMPONENT,
        "bounds_min": bounds[0].round(6).tolist(),
        "bounds_max": bounds[1].round(6).tolist(),
        "extents": np.asarray(collision.extents).round(6).tolist(),
        "watertight": bool(collision.is_watertight),
        "sha256": sha256_bytes(collision_payload),
        "tool_versions": {
            "python": platform.python_version(),
            "numpy": np.__version__,
            "trimesh": trimesh.__version__,
            "scipy": scipy.__version__,
            "rtree": rtree.__version__,
        },
        "navigation": {
            "file": args.navigation.name,
            "bytes": len(navigation_payload),
            "sha256": sha256_bytes(navigation_payload),
            "schema_version": navigation_document["version"],
            "mask_sha256": navigation_document["mask_sha256"],
            "cell_counts_sha256": navigation_document["layers"][
                "cell_counts_sha256"
            ],
            "foot_heights_sha256": navigation_document["layers"][
                "foot_heights_sha256"
            ],
            "cell_size": navigation_document["cell_size"],
            "origin": navigation_document["origin"],
            "width": navigation_document["width"],
            "height": navigation_document["height"],
            **navigation_stats,
        },
    }

    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(
            json.dumps(report, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
