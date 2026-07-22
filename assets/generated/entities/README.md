# Original Entity Cast

Project-owned replacement entities for College Hill. Each kind ships in its own folder as a self-contained glTF 2.0 GLB with a per-model manifest and provenance record.

## Included batches

- `child/child.glb` — original 1.2 m hospital-gown phantom replacing the non-commercial `horrorkid` dependency.
- `crawler/crawler.glb` — original 0.62 m restraint-dragger with a compact 0.77 × 1.49 m floor silhouette.
- `nurse/nurse.glb` — original Grey Nurse ward-counter with a ledger cap and forearm chart board.
- `nurse2/nurse2.glb` — original Night Nurse restraint attendant with a collapsed cap and charge silhouette.

Every model uses one mesh, one primitive, one metallic-roughness material, no textures, an original skin, and matchable `idle`, `walk`, and `run` clips. Feet/contact geometry is at Y=0; assets are Y-up, metre-authored, and contain no root motion.

## Build and validation

```sh
node assets/generated/entities/tools/build-child.mjs
node assets/generated/entities/tools/build-crawler.mjs
node assets/generated/entities/tools/build-nurses.mjs
node assets/generated/entities/tools/validate-entity-glb.mjs assets/generated/entities/child/child.glb
node assets/generated/entities/tools/validate-entity-glb.mjs assets/generated/entities/crawler/crawler.glb
node assets/generated/entities/tools/validate-entity-glb.mjs assets/generated/entities/nurse/nurse.glb
node assets/generated/entities/tools/validate-entity-glb.mjs assets/generated/entities/nurse2/nurse2.glb
```

The build is deterministic and uses no external model, scan, image, likeness, or animation input.

`preview.html?model=nurse&samples=512` and `preview.html?model=nurse2&samples=512`
run the dense release contact scan. The **Runtime look** control reproduces each
nurse's in-engine tint, opacity, transparency, and disabled depth writes so
sorting problems are visible before integration.
