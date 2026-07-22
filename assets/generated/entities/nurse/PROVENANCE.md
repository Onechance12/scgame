# Provenance — Original Grey Nurse Entity v1

Created: 2026-07-22

## Rights and source policy

This is an original procedural character created specifically for `Onechance12/scgame`. No third-party model, mesh, armature, animation, motion capture, scan, texture, stock asset, reference image, real-person likeness, logo, medical mark, trademarked character, franchise creature, or copyrighted character design was used as source material or supplied as a reference.

The Grey Nurse is a fictional 1920s ward-counter with a visible asymmetric face, rigid closed uniform, split high collar, folded ledger-style cap, pleated apron, and forearm chart board. The character deliberately avoids covered or bandaged faces, medical-cross emblems, fetishized uniform shapes, weapons, and recognizable horror-franchise nurse motifs.

No external license applies to the shipped GLB, and no third-party credit or attribution line is required. The repository owner should still make the final commercial-clearance decision. This record documents the creation pipeline and source-content boundary; it is not a legal opinion.

## Generation record

- Tool: OpenAI Codex, using repository-local deterministic Node.js glTF builders.
- Builder: `../tools/build-nurses.mjs`.
- Shared library: `../tools/entity-glb-kit.mjs`.
- Shared original rig: `original-ward-nurse-rig-v1`; signature recorded in the manifest.
- Runtime dependencies: Node.js standard library only.
- Random inputs: none.
- External inputs: none.
- Output: self-contained glTF 2.0 GLB using metallic-roughness PBR.
- Material strategy: one opaque material with original procedural vertex colors; no texture files.
- Geometry strategy: one indexed low-poly mesh assembled from closed procedural volumes and an outward-wound, capped-hem front/back-skinned skirt shell covered at the waist.
- Rig strategy: original 25-joint upright hierarchy with explicit inverse-bind matrices.
- Animation strategy: original hand-authored quaternion keys for grounded idle, ward-round walk, and rigid run loops. All locomotion is in place and contains no Root translation.

## Reproducibility

Run from the repository root:

```sh
node assets/generated/entities/tools/build-nurses.mjs
node assets/generated/entities/tools/validate-entity-glb.mjs assets/generated/entities/nurse/nurse.glb
```

The builder is bit-reproducible on conforming Node.js runtimes. The canonical output byte count and SHA-256 are recorded in `asset-manifest.json`.
