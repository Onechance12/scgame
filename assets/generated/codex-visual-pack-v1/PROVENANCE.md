# Provenance

Pack: `codex-visual-pack-v1`

Created: 2026-07-21

Repository: `Onechance12/scgame`

Tool mode: OpenAI built-in image generation, primarily **generate** mode. The parchment mask used one **edit** call with this pack's generated parchment albedo as its only image input.

## Origin statement

- Every base raster in this pack was generated specifically for this repository.
- No pre-existing repository image, downloaded texture, stock image, third-party artwork, real-person photo, copyrighted character, logo, or recognizable franchise image was supplied as a raster reference. The parchment mask edit used this pack's generated parchment albedo; sign derivatives include locally rasterized system-font glyphs; all such derivative inputs are documented below.
- The generated title hospital is a fictional composite, not a literal reconstruction.
- The newspaper is a wholly fictional generated prop, not an archival scan or verified reconstruction. Its real-world-adjacent requested naming must not be presented as historical evidence.
- The facade sign is fictional game wayfinding, not a verified historical reconstruction; `EST. 1928` is requested display text rather than an independently established fact.
- The sign lettering was applied locally to generated blank sign plates so all requested wording is exact.
- These files are not labeled CC0, public domain, or legally cleared by assumption. Project-owner rights/provenance review remains required before release.
- No API keys, tokens, or generation credentials are stored in the repository.

Exact prompts are preserved in [`PROMPTS.md`](PROMPTS.md). The generated outputs below existed locally during generation and processing, but they are not committed and are not guaranteed to remain accessible, durable, or immutable outside this repository. Their observed filenames, dimensions, and hashes are recorded for the review trail; only optimized derivatives are proposed in this PR.

## Generated source inventory

| Source ID | Generated filename | Dimensions | SHA-256 |
|---|---|---:|---|
| `newspaper-v1` | `exec-68bfe675-db68-47e3-94fa-e8a5c3217494.png` | 1254×1254 | `a0710aebcf8993c419344e7fc058bcc17b058befdc4aa1ff4c98a81050f8b737` |
| `document-patient-v1` | `exec-a352f4ce-f2fa-4f4b-a669-0367be511a76.png` | 1448×1086 | `41806b03f4803f408825d99db8ce93815994996df3b11f6582135d45efc53c20` |
| `document-police-v1` | `exec-5ed5dbb6-f6ba-4eec-bc3c-b6471a648c2e.png` | 1448×1086 | `df0783c09230b012b7074fbaf29414e77798bcda4241fb3ea77ee69c83f0fc02` |
| `document-diary-v1` | `exec-0cd49af1-37eb-43a9-b92a-6e2d92ca1cdb.png` | 1448×1086 | `cb9d0dd2b7f568119ceb14f734886a33c4dfeda64a8d624b8474eac73a9f307f` |
| `document-press-v1` | `exec-99f6ccf3-c277-45e1-9e1e-fb615193acf5.png` | 1448×1086 | `419b34ede3d29483b88cd83a45fd87b2dae4eb8eaedfd468cb777256dee5b563` |
| `sign-plates-v1` | `exec-f95a1cc8-649e-4af3-8117-fa7346a27fda.png` | 1672×941 | `701755a97c12e7f92192509716021972f5245804e5806ad777fe092d17cbb32f` |
| `sign-facade-v1` | `exec-20fdaaf4-b1a7-4724-950f-cb573135be72.png` | 1881×836 | `20852abef2ba5ee1f0b6168b4f03ac4aded19869ec827504a8cf2d9f15decd57` |
| `flames-orange-v1` | `exec-aea79f3b-d476-49ef-8927-7e78625559b9.png` | 1254×1254 | `1f8c213c04d58dd21be74b40939f962894dc7d38fb8a803c73209876f9ca9646` |
| `grime-v2` | `exec-f5e5bc52-76d0-43fc-af38-3687dc1a9b87.png` | 1254×1254 | `bc3d492ae29a712608a11153b79b4f4a4b75d33daf0db83005fe046a057f16a6` |
| `wall-green-v2` | `exec-bc6130af-0806-47cb-aa28-fd9b8f7d4e0c.png` | 1254×1254 | `7a59fe2d0f4b06cec403792e61252eba1b15782c8130e1bf6d5790688c5ac03e` |
| `wall-wallpaper-v2` | `exec-8cef2b14-d53d-40c7-8edd-86cbd89e50f4.png` | 1254×1254 | `563cab0f082fe6bd55157106f6a98ddeb43dfd124eb49b1e83b42c20b9b17ae6` |
| `title-v1` | `exec-c5cff43b-cedc-4a10-839b-9bcd4affb80d.png` | 1672×941 | `4135d706422d7990bb7c79f48017c5544daf6b5b042defff358c7835e456280a` |
| `parchment-albedo-v1` | `exec-307c8660-bf7f-42bf-a6c2-194d0d629b8d.png` | 1254×1254 | `cc43278f990716bd10a1cbf4e21bbf56b57c0830a282bbbb70e6c1e0d0f56f4e` |
| `parchment-mask-v1` | `exec-607774c6-5a65-460a-b800-2a3d039867a3.png` | 1254×1254 | `84f534ae8d20bcbd1de6e1e84d15cdc98ccbdbb6367ef88ca87123cc2218cca1` |

## Local transformations

### Newspaper and document backplates

- Resized with macOS `sips`.
- Newspaper retained as a 1024×1024 opaque RGB PNG.
- Selectively blurred the generated small article columns while preserving only the requested masthead, date, headline, and central prop photograph. This prevents invented names, quotations, and reporting from being consumed as canonical or archival text.
- Four document sources retained their native 4:3 framing and were encoded as 1024×768 RGB JPEGs.
- No repository story text was composited into the generated small print.

### Signage

- Generated blank enamel plates against flat `#ff00ff`.
- Removed the key with the installed OpenAI image-generation helper using border auto-key, soft matte, transparent threshold 12, opaque threshold 150, despill, and a one-pixel edge contraction.
- Downsampled with premultiplied-alpha LANCZOS sampling.
- Standard signs were rendered at 512×256; the facade sign at 1024×256.
- Wayfinding lettering used `/System/Library/Fonts/Supplemental/DIN Condensed Bold.ttf`.
- Facade lettering used `/System/Library/Fonts/Supplemental/Copperplate.ttc` at 41 pixels.
- DIN Condensed Bold observed version `14.0d1e1`, SHA-256 `36958182a424e1e8a1307b2636a615a6323ce1bbfadda136735ab4fb3bd26ceb`.
- Copperplate collection observed version `13.0d1e2`, SHA-256 `2a14817d53238ac7a25688b4f7e0f0bd1c4c6e4fe84c72be7198151db5d2df22`.
- The right arrow and em dash were drawn deterministically to avoid glyph substitution.
- Final PNG metadata records `SignText`, `Typeface`, `SourcePlate`, and workflow details.

The metadata value `blank-hospital-sign-plates-chroma.png` identifies the local intermediate derived from source ID `sign-plates-v1`; `blank-facade-sign-plate-chroma.png` identifies the intermediate derived from `sign-facade-v1`. Those chroma intermediates are intentionally not shipped as runtime assets; the observed generated-source identifiers and hashes are recorded above.

The fonts themselves are not redistributed; only rasterized glyph pixels appear in the output. This record is technical provenance, not a license opinion: commercial clearance for the resulting rasterized font output remains **not determined** and requires project-owner review.

### Flames

- Resized the orange generated sheet to 1024×1024 with LANCZOS sampling, producing exact 128×128 cells.
- Derived the green sheet from the final orange pixels with a `67/256` HSV hue shift and a restrained color adjustment.
- The two variants therefore have identical frame registration.

### Grime

- Generated on a near-white removable background.
- Removed that background with the installed OpenAI helper using border auto-key, soft matte, transparent threshold 12, opaque threshold 180, despill, and one-pixel edge contraction.
- Resized from 1254×1254 to 512×512 with premultiplied-alpha LANCZOS sampling.
- No blood cells were retained.

### Wall albedos

- Selected second-generation sources with even microdetail and no large global tide band or peel patch.
- Hospital-green plaster: resized to 1024×1024 and applied a symmetric 16-pixel edge crossfade.
- Floral wallpaper: detected the generated motif periods, cropped six horizontal periods by four vertical double-row periods, resized to 1024×1024, then applied a symmetric 16-pixel edge crossfade.
- Encoded both as progressive RGB JPEGs.
- Inspected both at 4×4 repetition and measured final opposite-edge error; values are recorded in `README.md`.

### Title art

- Resized/cropped from the generated 16:9 source to 1920×1080.
- Encoded as an RGB JPEG.

### Burning parchment

- Resized the generated albedo and generated mask to 1024×1024.
- Encoded the albedo as RGB JPEG.
- Converted the mask to a single luminance signal replicated across RGB.
- Normalized mask values: inputs at or below 32 became black; inputs at or above 224 became white; the intervening band was mapped linearly for edge antialiasing.
- The mask is intended for linear `alphaMap`/shader use, not sRGB display.

## Derivative relationships

- `flames/fire-witch-green-8x8.png` is derived from `flames/fire-orange-8x8.png`.
- All standard signs share the generated `sign-plates-v1` source sheet.
- `signs/college-hill-hospital-est-1928.png` uses `sign-facade-v1`.
- `parchment/burning-parchment-scorched-edge-mask-v1.png` is a generated edit of the pack's own parchment albedo, followed by deterministic normalization.

Every checked-in derivative's dimensions, byte count, pixel mode, intended color space, and SHA-256 hash are recorded in [`asset-manifest.json`](asset-manifest.json).
