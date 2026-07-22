# Provenance — Codex Ceiling + Floor Pack v1

Created: 2026-07-21

## Rights and source policy

Every base raster in this pack was generated for this project. No stock texture, third-party raster, photograph, logo, real-person likeness, or entertainment-franchise image was supplied as a reference. Two inputs—the checker linoleum and light-cookie atlas—were generated in the preceding Codex art-review pass and carried forward after Claude approved them as useful runtime candidates.

The generated outputs existed locally at generation time. They are not committed to this repository and are not guaranteed to remain available. Their observed filenames, dimensions, byte counts, and SHA-256 hashes are recorded below so the derivatives remain auditable.

Commercial clearance remains an owner decision. The pack contains no redistributed font or third-party source file. Generation is not bit-reproducible because the built-in generator did not expose a stable seed or complete model/run metadata.

## Source records

| Source ID | Local generator file | Size | Bytes | SHA-256 |
|---|---|---:|---:|---|
| `ceiling-calcimine-v1` | `exec-886f5c4f-95a3-4ec8-9d82-5b8e5c8b7060.png` | 1254² | 2,409,614 | `cfe1bca41a22f0c056b88bd710c56bf78ca559591a0b67a8dfd4fdde3b16bc38` |
| `floor-basement-concrete-v1` | `exec-50fd43f0-c43f-4875-b221-2d5310b15281.png` | 1254² | 2,996,001 | `fd12c0c913e0657ab1fcc5c896fafc900baf3e842912d9fa88a3a2453fc26d57` |
| `ceiling-basement-concrete-v1` | `exec-3b898582-06c7-4a45-874a-71532c50a653.png` | 1254² | 3,240,271 | `66c3cb9edec9e777d5530ffd7a4ae329b698b67d10880a07cacc22e6004543f4` |
| `floor-terrazzo-v1` | `exec-f79927bc-9d4e-4d7c-8df7-d458a538ee29.png` | 1254² | 3,340,267 | `2bcd69d2d34333d44e912c1aefd7eefc86b56ef0fb78cd8a40d846e1649658e1` |
| `ceiling-fiberboard-v1` | `exec-92b6e53d-688c-4875-b1c4-6549a51cc4fa.png` | 1254² | 2,813,657 | `09aeaa0d1d692d1439f6d25c4e2ee2578016a32c0feae75a2b46a5a888128197` |
| `ground-appalachian-v1` | `exec-82970cea-1cac-44d5-b576-3144de5eb1bd.png` | 1254² | 3,393,992 | `622e093926212cb0706196f0c7b0d0186e339e1f127321559b60bf881b0816b9` |
| `floor-dark-oak-v1` | `exec-afb88b8a-09d2-4109-a256-f89e11f1783a.png` | 1254² | 2,394,176 | `112a8f3a03cc3f9300981394deb85f49e358eb8799d7fc10e702d5abbd81001e` |
| `linoleum-albedo-v1` | `exec-03d7cd05-fc04-4597-8e33-f75c4478c79b.png` | 1254² | 3,166,966 | `26c8d5f3e8437b423b84c0eafb530699c0c1534bc892a606eedd91b1d5e52b16` |
| `light-cookies-v1` | `exec-e4587f4e-7312-4d22-a413-dded270011ac.png` | 1254² | 1,378,831 | `f63689ae16b9bc9e9f4469c21032c0b2e4615e021bad4e84af7bdc3fed3c0a4b` |

Source prompts are in `PROMPTS.md`.

## Deterministic transformations

The auditable implementation is `tools/surface_processor.swift`, using Swift, Foundation, CoreGraphics, ImageIO, and UniformTypeIdentifiers available on macOS.

- `albedo`: high-quality resample to 1024×1024 RGBA working pixels; symmetric 16-pixel left/right and top/bottom seam blend; JPEG encoding at quality 0.90.
- `acoustic`: high-quality resample of the useful six-panel source period to 768×768; symmetric 12-pixel seam blend; modulo tile into 1024×1024, yielding exactly eight panels across and down; JPEG quality 0.90.
- `normal`: high-quality resample of the final albedo to 512×512; 3×3 luma smoothing; wrapped Sobel gradient; normalized tangent-space RGB output. These are visual detail approximations, not measured surface normals.
- `cookie`: crop the top-left half-width/half-height quadrant from the approved atlas and resample to 512×512 PNG.
- `metrics`: report mean absolute RGB difference between opposite edge pixels.

The checker albedo is reused directly from `../surface-kit-v1/checker-hospital-linoleum-albedo.jpg` rather than duplicated in this pack. Its SHA-256 remains `9a007ec4f83222418cd62513663208c2ee9aedb78f2b39f4d351013785e2c54b`; the new normal map was derived from those exact final pixels.

## Normal strengths

| Final normal | Strength |
|---|---:|
| checker hospital linoleum | 0.16 |
| ground-floor terrazzo | 0.55 |
| basement sealed concrete | 0.65 |
| upper-floor dark oak | 0.32 |
| aged calcimine plaster | 0.55 |
| midcentury fiberboard panels | 0.22 |
| basement painted concrete | 0.55 |
| Appalachian wet leaf/clay | 0.48 |

## Reproducibility notes

- The final derivative byte hashes and sizes are canonical; see `asset-manifest.json`.
- Re-encoding JPEGs may change bytes between OS/library versions even with identical source pixels.
- Re-running a built-in image-generation prompt is expected to produce a different source image.
- The normal maps are intentionally derived from final compressed color pixels so their visible feature registration matches the exact shipped albedos.
