# Provenance — Original Child Entity v1

Created: 2026-07-22

## Rights and source policy

This is an original procedural character created specifically for `Onechance12/scgame`. No third-party model, mesh, armature, animation, motion capture, scan, texture, stock asset, reference image, real-person likeness, logo, trademarked character, franchise creature, or copyrighted character design was used as source material or supplied as a reference.

The design is a small, fictional hospital-gown phantom assembled from deterministic geometric primitives and an original joint hierarchy. It is not intended to depict a real child or any existing entertainment character. No external license applies to the shipped GLB, and no third-party credit or attribution line is required.

The repository owner should still make the final commercial-clearance decision. This provenance record documents the creation pipeline and source-content boundary; it is not a legal opinion.

## Generation record

- Tool: OpenAI Codex, using a repository-local deterministic Node.js glTF builder.
- Builder: `../tools/build-child.mjs`.
- Runtime dependencies: Node.js standard library only.
- Random inputs: none.
- External inputs: none.
- Output: self-contained glTF 2.0 GLB using metallic-roughness PBR.
- Material strategy: one material with original procedural vertex colors; no texture files.
- Geometry strategy: low-poly ellipsoids, tapered tubes, boxes, and a custom ragged gown surface.
- Rig strategy: original 20-joint humanoid hierarchy with explicit inverse-bind matrices.
- Animation strategy: original hand-authored quaternion keyframes for looping `idle`, `walk`, and `run` clips. All locomotion is in place and contains no root translation.

## Reproducibility

Run from the repository root:

```sh
node assets/generated/entities/tools/build-child.mjs
node assets/generated/entities/tools/validate-entity-glb.mjs
```

The builder is bit-reproducible on conforming Node.js runtimes. The canonical output byte count and SHA-256 are recorded in `asset-manifest.json`.
