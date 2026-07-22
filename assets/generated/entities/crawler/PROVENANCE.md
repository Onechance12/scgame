# Provenance — Original Crawler Entity v1

Created: 2026-07-22

## Rights and source policy

This is an original procedural character created specifically for `Onechance12/scgame`. No third-party model, mesh, armature, animation, motion capture, scan, texture, stock asset, reference image, real-person likeness, logo, trademarked character, franchise creature, or copyrighted character design was used as source material or supplied as a reference.

The design is a fictional hospital restraint-dragger: a prone human-derived silhouette with an offset craned head, uneven shoulders, asymmetric load-bearing forearms, torn ward canvas, crossed restraint bands, and atrophied trailing legs. It was deliberately designed without exposed-brain, tongue, fungal-head, mask, backward-spider, or featureless humanoid motifs associated with recognizable horror properties.

No external license applies to the shipped GLB, and no third-party credit or attribution line is required. The repository owner should still make the final commercial-clearance decision. This record documents the creation pipeline and source-content boundary; it is not a legal opinion.

## Generation record

- Tool: OpenAI Codex, using repository-local deterministic Node.js glTF builders.
- Builder: `../tools/build-crawler.mjs`.
- Shared library: `../tools/entity-glb-kit.mjs`.
- Runtime dependencies: Node.js standard library only.
- Random inputs: none.
- External inputs: none.
- Output: self-contained glTF 2.0 GLB using metallic-roughness PBR.
- Material strategy: one opaque material with original procedural vertex colors; no texture files.
- Geometry strategy: low-poly ellipsoids, tapered tubes, boxes, and double-sided torn-cloth surfaces compressed to a corridor-safe floor footprint.
- Rig strategy: original 21-joint prone hierarchy with explicit inverse-bind matrices.
- Animation strategy: original hand-authored quaternion keyframes for looping idle, drag-walk, and scuttle-run clips. All locomotion is in place and contains no Root translation.

## Reproducibility

Run from the repository root:

```sh
node assets/generated/entities/tools/build-crawler.mjs
node assets/generated/entities/tools/validate-entity-glb.mjs assets/generated/entities/crawler/crawler.glb
```

The builder is bit-reproducible on conforming Node.js runtimes. The canonical output byte count and SHA-256 are recorded in `asset-manifest.json`.
