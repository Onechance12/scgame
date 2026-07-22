# Codex Ceiling + Floor Pack v1

Status: **runtime integration in this branch; draft review required**

Target: **College Hill — 24 Hours / Three.js WebXR / Meta Quest**

This pack gives the hospital distinct material identities by level and room instead of stretching one corridor texture across the whole map. It also supplies a restrained exterior ground surface and an optional broken-fluorescent floor cookie. Every color texture is original generated material art or an already-approved generated derivative from the preceding Codex surface review; no stock texture pack was imported.

## Surface direction

| Zone | Floor | Ceiling | Read at a glance |
|---|---|---|---|
| Ground-floor public circulation | muted institutional terrazzo | aged calcimine plaster | older public wing, worn but once presentable |
| Ground-floor clinical rooms | checker hospital linoleum | fiberboard panels or calcimine by room | cleaner geometry, colder treatment spaces |
| Basement | sealed dark concrete | painted concrete | damp service level, mineral staining, low reflectance |
| Second floor | checker hospital linoleum | fiberboard panels | repeated ward construction, phased per room rather than copy-stamped |
| Third floor | existing slate-grey large tile | Claude's pressed-plaster coffers | surgical wing with colder hard finishes |
| Fourth floor | narrow dark oak | aged boards | older residential, chapel, and attic fabric |
| Exterior | wet Appalachian leaf-and-clay ground | n/a | blends the building into its hillside without a repeated lawn texture |

The existing specialized room materials remain available where their story language is stronger—chapel boards, lobby mosaic, ritual bloodwood, wet-room tile, service metal, and other deliberate cases. Runtime selection is room-aware, so adjacent spaces no longer inherit identical pattern phase merely because they share a source bitmap.

## Files

### Floors

- `../surface-kit-v1/checker-hospital-linoleum-albedo.jpg` — reused runtime color from Claude's approved surface kit; it is not duplicated here.
- `floors/checker-hospital-linoleum-normal.png` — 512×512 linear normal derived from those exact final color pixels.
- `floors/ground-floor-terrazzo-albedo.jpg` and `-normal.png` — quiet public-wing aggregate with small period-muted chips.
- `floors/basement-sealed-concrete-albedo.jpg` and `-normal.png` — cart-worn, hairline-cracked service concrete.
- `floors/upper-floor-dark-oak-albedo.jpg` and `-normal.png` — narrow staggered boards with dry, low-gloss wear.

### Ceilings

- `ceilings/aged-calcimine-plaster-albedo.jpg` and `-normal.png` — continuous plaster for the older public/upper fabric.
- `ceilings/midcentury-fiberboard-panels-albedo.jpg` and `-normal.png` — deterministic 8×8 panel grid for clinical/service areas.
- `ceilings/basement-painted-concrete-albedo.jpg` and `-normal.png` — mineral-painted slab underside for the basement.

### Exterior and lighting

- `ground/appalachian-wet-leaf-clay-albedo.jpg` and `-normal.png` — damp leaf litter, shale, clay, roots, and sparse moss.
- `lighting/broken-fluorescent-floor-cookie.png` — one 512×512 projected-light candidate extracted from the previously approved 2×2 generated cookie atlas. It is intentionally optional: do not substitute it for a real light source or add a unique texture instance per fixture.

Total derivative image payload: **16 images, 6,184,322 bytes (5.90 MiB)**, plus the already-committed checker albedo reused from `surface-kit-v1`.

## Runtime integration rules

- Color textures use `THREE.SRGBColorSpace`; normal maps and the light cookie remain linear.
- Textures are cached once and shared. Do not clone maps per room or fixture.
- Floor and ceiling geometry carries world-scaled UVs. Pattern density therefore stays physically consistent across differently sized rooms.
- Room overlays add a deterministic fractional UV phase, so repeated ward/material families stay related without cloning the exact same texture stamp.
- Repeats are chosen in meters, not arbitrary per-room texture counts: checkers should read around 25–30 cm, boards remain narrow, and aggregate/plaster avoid obvious billboard scale.
- Floor overlays sit above the base plane without hiding puddles, decals, pickups, or interaction targets.
- Normal intensity stays restrained for Quest; these are luma-derived detail normals, not measured displacement.
- Keep room dressing clear of door swing arcs and retain a usable center lane through every traversable room.

## Validation performed

- All final color maps are 1024×1024 RGB JPEG; normals and cookie are 512×512 RGBA PNG.
- Every file was opened and visually inspected at final resolution.
- Continuous surfaces received symmetric 16-pixel edge blending before compression. Opposite-edge RGB mean absolute differences are documented in `asset-manifest.json`.
- Checker and fiberboard grids intentionally have contrasting opposite edge pixels because a period boundary lands at the image edge; both must be judged in a repeated preview rather than by raw edge MAD alone.
- Normal maps use wrapped sampling, so their height gradients stay continuous at repeat boundaries.
- `preview.html` renders each color map in a 4× repeat field and pairs it with its normal map.
- `tools/surface_processor.swift` is included so reviewers can audit the deterministic resizing, seam blending, panel-grid correction, normal derivation, cookie crop, and edge metrics.

## Review gates

- [ ] Inspect each 4× repeat field in `preview.html` for visible seams or unique repeating landmarks.
- [ ] Walk every floor and confirm the material transition makes architectural sense at door thresholds.
- [ ] Confirm no floor overlay hides puddles, evidence, interaction marks, or footsteps.
- [ ] Confirm ceiling normals face inward and fixtures sit slightly below the ceiling with no z-fighting.
- [ ] Test doors from both sides; verify props never occupy a door swing or collision opening.
- [ ] Run the world-layout validator and the existing game tests.
- [ ] Perform desktop browser smoke testing and an on-headset Quest frame-time check before merging.

Generation prompts and exact source hashes are in `PROMPTS.md` and `PROVENANCE.md`; machine-readable derivative hashes are in `asset-manifest.json`.
