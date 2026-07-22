# Original Entity Cast

Project-owned replacement entities for College Hill. Each kind ships in its own folder as a self-contained glTF 2.0 GLB with a per-model manifest and provenance record.

## Batch 1

- `child/child.glb` — original 1.2 m hospital-gown phantom replacing the non-commercial `horrorkid` dependency.
- One mesh, one primitive, one metallic-roughness material, no textures.
- Original 20-joint skin with `idle_breathing`, `walk_in_place_1p1mps`, and `run_in_place_2p5mps` clips.
- Feet at Y=0, Y-up, metre-authored, no root motion.

## Build and validation

```sh
node assets/generated/entities/tools/build-child.mjs
node assets/generated/entities/tools/validate-entity-glb.mjs
```

The build is deterministic and uses no external model, scan, image, likeness, or animation input.
