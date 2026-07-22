# Generation Prompts — Codex Ceiling + Floor Pack v1

All new base rasters were generated with OpenAI's built-in image generator in `stylized-concept` mode. No external reference image was supplied. Prompts deliberately requested flat, neutral albedo lighting, edge-to-edge material coverage, no lettering, no story prop, no gore, and no singular landmark that would reveal repetition.

The checker linoleum and fluorescent cookie came from the earlier Codex surface-lighting review and retain their original prompt/source identity below.

## `ceiling-calcimine-v1`

> Create a square, seamless tileable albedo texture for a 1928 Appalachian institutional hospital ceiling: smooth lime plaster under old calcimine paint, nicotine ivory and dirty warm cream, very fine trowel variation, faint hairline crazing, sparse tiny damp freckles, restrained age and neglect. Orthographic straight-on material scan, flat neutral diffuse lighting, no directional light, no cast shadows, no ambient occlusion, no perspective, no vignette, no border. Edge-to-edge continuous material with opposite edges designed to tile. No ceiling grid, beams, fixtures, vents, pipes, holes, large water rings, dramatic cracks, unique focal stain, text, symbols, blood, or gore. Keep detail quiet and evenly distributed for repeated use in a dark stylized Three.js/WebXR horror game.

## `floor-basement-concrete-v1`

> Create a square, seamless tileable albedo texture for a 1928 hospital basement floor: worn sealed concrete in dark neutral gray, fine exposed aggregate, old cart-wheel polish, subtle mop haze, sparse hairline cracks, mineral mottling, and restrained damp age. Orthographic straight-down material scan, flat neutral diffuse lighting, no directional illumination, no cast shadows, no ambient occlusion, no perspective, no vignette, no border, no baked reflection. Edge-to-edge continuous material with opposite edges designed to tile. No drain, puddle, footprint, debris pile, painted line, expansion-joint cross, large crack, unique stain, text, symbols, blood, or gore. Keep the pattern quiet and evenly distributed for repeated corridor use in a dark stylized Three.js/WebXR horror game.

## `ceiling-basement-concrete-v1`

> Create a square, seamless tileable albedo texture for the underside of a 1928 hospital basement concrete ceiling: poured concrete beneath failing dirty-ivory mineral paint, fine aggregate and form texture, restrained salt bloom, subtle damp mottling, and sparse hairline crazing. Orthographic straight-on material scan, flat neutral diffuse lighting, no directional illumination, no cast shadows, no ambient occlusion, no perspective, no vignette, no border. Edge-to-edge continuous material with opposite edges designed to tile. No beams, grid, fixtures, pipes, vents, large water rings, dramatic cracks, hole, unique focal stain, text, symbols, blood, or gore. Keep damage small and evenly distributed for repeated use in a dark stylized Three.js/WebXR horror game.

## `floor-terrazzo-v1`

> Create a square, seamless tileable albedo texture for an aged 1928 institutional hospital ground-floor terrazzo: warm dirty-cream cement matrix with many small chips in muted cream, desaturated sage, charcoal, and very sparse dull rust; gentle traffic wear and mop haze, low contrast, period-appropriate and utilitarian. Orthographic straight-down material scan, flat neutral diffuse lighting, no directional illumination, no cast shadows, no ambient occlusion, no perspective, no vignette, no border, no baked gloss or reflection. Edge-to-edge continuous material with opposite edges designed to tile. No tile grid, brass divider, medallion, large chip cluster, crack focal point, footprint, trash, text, blood, or gore. Keep chips small and evenly distributed for repeated corridor use in a dark stylized Three.js/WebXR horror game.

## `ceiling-fiberboard-v1`

> Create a square, seamless tileable albedo texture of midcentury institutional cellulose fiberboard ceiling panels for an old Appalachian hospital. Show a perfectly regular orthographic square panel grid, faded dirty-cream boards, tiny uniform fiber pinholes, thin straight recessed seams, restrained age variation, and no displaced or broken panels. Flat neutral diffuse material lighting, no directional light, no cast shadows, no ambient occlusion, no perspective, no vignette, no border. Opposite edges must tile continuously. No fixtures, vents, pipes, stains larger than a panel, sagging, missing tile, unique focal mark, lettering, symbols, blood, or gore. Keep each panel subtly varied but the full pattern quiet for a dark stylized Three.js/WebXR horror game.

The generator returned a visually useful 6×6 source grid. The deterministic `acoustic` post-process resized one six-panel period to 768×768, seam-blended that period, then tiled it into 1024×1024 so the shipped derivative contains an exact 8×8 panel grid.

## `ground-appalachian-v1`

> Create a square, seamless tileable albedo texture for damp Appalachian ground around an abandoned hilltop hospital: dark brown clay, crushed charcoal shale, flattened small autumn leaf fragments, scattered thin pine needles, tiny exposed root fibers, and sparse muted moss. The surface is wet and compacted but has no puddle or baked shine. Orthographic straight-down material scan, flat overcast diffuse lighting, no directional light, no cast shadows, no ambient occlusion, no perspective, no vignette, no border. Edge-to-edge continuous material with opposite edges designed to tile. No large intact leaf, branch, stone landmark, footprint, tire track, trash, path edge, text, symbols, blood, or gore. Keep all elements small and evenly distributed for a dark stylized Three.js/WebXR horror game.

## `floor-dark-oak-v1`

> Create a square, seamless tileable albedo texture for the upper floor of a neglected 1928 Appalachian hospital: approximately eighteen narrow dark-oak floorboards running vertically, staggered end joints, straight period millwork, dry worn wax, muted umber and charcoal-brown variation, fine grain, shallow scratches, and restrained foot-traffic wear. Orthographic straight-down material scan, flat neutral diffuse lighting, no directional light, no cast shadows, no ambient occlusion, no perspective, no vignette, no border, no baked reflection. Edge-to-edge continuous material with opposite edges designed to tile. No broken or missing board, nail cluster, furniture shadow, large gouge, unique focal stain, text, symbols, blood, or gore. Keep contrast subdued for a dark stylized Three.js/WebXR horror game.

## `linoleum-albedo-v1` — carried approved derivative

> Seamless square albedo texture, top-down orthographic surface scan of worn 1930s hospital checkerboard linoleum, alternating small cream and desaturated charcoal-green squares, grimy grout, chipped wax finish, subtle scuffs and age, evenly distributed detail, low contrast. Flat neutral lighting, no shadows, no highlights, no perspective, no border, no objects, no feet, no blood, no text, no watermark, no unique focal feature. Tileable edges. Stylized realistic game texture for a dark Appalachian hospital horror game.

Runtime reuses the checker JPEG directly from `../surface-kit-v1/`, the derivative Claude previously approved. Only its normal map is new and was derived from that exact final JPEG.

## `light-cookies-v1` — carried approved derivative

> A 2x2 atlas of four distinct black and white light-cookie masks for a 1920s hospital horror game. Pure black background, soft white-to-gray projected-light shapes, no color, no text, no symbols, no objects, no scene, no border. Quadrant 1: long broken fluorescent ceiling light pool, uneven bars and gaps. Quadrant 2: narrow barred window moonlight. Quadrant 3: round surgical lamp pool with subtle radial structure. Quadrant 4: weak doorway spill with irregular edge. Each shape centered and isolated within its quadrant, generous black padding, no overlap across cell boundaries. Flat orthographic mask atlas, high contrast, clean cell registration, suitable for additive projected-light planes in Three.js/WebXR.

`lighting/broken-fluorescent-floor-cookie.png` is the top-left quadrant, cropped and resized deterministically to 512×512.

## Derived normal maps

No generative prompt was used for the normals. `tools/surface_processor.swift normal` resamples the final color derivative to 512×512, computes a blurred luminance height proxy with wrapped sampling and a Sobel gradient, normalizes it, and writes an 8-bit RGB tangent-space map. Strength values are recorded per asset in `asset-manifest.json`.
