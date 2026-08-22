# Asset Notes

This prototype now uses ReplicaCAD baked-lighting interiors for both playable rooms:

- Scene 1 upside-down study shell:
  - local file: `assets/replicacad/Baked_sc0_staging_00.uncompressed.glb`
- Scene 2 storage room shell:
  - local file: `assets/replicacad/Baked_sc1_staging_01.playcanvas.glb`
  - downloaded from: <https://huggingface.co/datasets/ai-habitat/ReplicaCAD_baked_lighting>
  - exact collision mesh: `assets/replicacad/Baked_sc1_staging_01.collision.glb`
  - layered navigation mask: `assets/replicacad/Baked_sc1_staging_01.navigation-mask.json`
  - render source SHA-256: `1734f0ddf49e302285acaeea30a94c62d9e00153e56e31c52b735208256af05c`
  - collision SHA-256: `9661433402bddb4f84e49bafca39fa0671f4e81842afae7a2116da5ca3ce11e2`
  - navigation SHA-256: `8116dc26ee02185d5053e4f22febee0500fc9a86b210013a64a16277f629522e`

## Why This Was Chosen

- it gives the prototype a much more believable interior baseline than a hand-built blockout
- it already carries baked lighting and real room proportions
- it is good for rapid visual iteration while gameplay logic is still changing

## Important License Caution

- Treat this asset as prototype-safe, not automatically commercial-safe.
- ReplicaCAD licensing information appears inconsistent across its public distribution pages, so this room should not be assumed safe for commercial release without a separate licensing review.

## Technical References

- PlayCanvas engine:
  - <https://github.com/playcanvas/engine>
- Ammo.js physics:
  - <https://github.com/kripken/ammo.js>
- PlayCanvas Orange Room tutorial inspiration:
  - <https://developer.playcanvas.com/tutorials/orange-room/>
- glTF sample asset references:
  - <https://github.com/KhronosGroup/glTF-Sample-Assets/blob/main/Models/Models.md>

The mirror, anomalies, sunflower photo frame, and upside-down ghost props are still custom runtime-built objects.

The bundled runtime licenses are in `vendor/LICENSE-playcanvas.txt` and `vendor/LICENSE-ammojs.txt`.
