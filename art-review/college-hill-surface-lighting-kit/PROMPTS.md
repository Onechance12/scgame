# Generation prompts

These are the exact prompts used for the seven committed visual candidates. No repository image, third-party image, or other reference image was supplied to the generator.

The generated source filenames and hashes are recorded in `asset-manifest.json`. The checked-in images are resized/converted review derivatives; they are not claimed to be production-ready textures.

## `corridor-mood-v1`

```text
Use case: stylized-concept
Asset type: game environment art-direction target for a Meta Quest WebXR survival-horror game
Primary request: an original abandoned 1920s Appalachian hospital corridor showing the intended use of a restrained surface-and-lighting kit
Scene/backdrop: long institutional corridor with peeling pale green plaster, dirty checker linoleum, corroded cream-painted steel doors, sparse old hospital fixtures, no people or creatures
Style/medium: cinematic realistic game-environment concept render, achievable with optimized real-time Three.js assets rather than offline film rendering
Composition/framing: wide 16:9 eye-level corridor view, clear foreground wall/floor/metal materials and readable depth
Lighting/mood: cold moonlight through one barred side window, intermittent sickly fluorescent practicals, one warm distant emergency glow, controlled fog and dust, deep but readable shadows
Color palette: desaturated surgical green, nicotine cream, charcoal, oxidized brown, tiny amber accent
Materials/textures: pronounced but believable peeling plaster, damp staining, scuffed linoleum, rust blooms, grime around hand height, restrained blood traces
Constraints: original fictional location; no real brands; no logos; no readable text; no recognizable franchise imagery; no gore; no watermark; no cinematic black bars; no UI overlay
Avoid: excessive props, glossy clean surfaces, neon colors, crushed-black unreadable image, fantasy architecture, fisheye distortion
```

## `plaster-albedo-v1`

```text
Use case: stylized-concept
Asset type: tileable game texture, base-color/albedo source for an optimized Meta Quest horror environment
Primary request: seamless square texture of old institutional plaster painted desaturated surgical green, with layered peeling paint, hairline cracks, damp tide marks, mildew freckles, and hand-height grime
Style/medium: photorealistic scanned-material appearance, restrained and believable, not concept art
Composition/framing: perfectly orthographic front-facing flat surface filling the entire square; evenly distributed features; edges must tile seamlessly in both axes
Lighting/mood: neutral diffuse capture with absolutely no directional light, cast shadows, highlights, vignette, or ambient occlusion baked into the color
Color palette: faded surgical green, gray plaster, nicotine cream, dark gray-brown grime
Constraints: albedo only; no objects, trim, corners, floor, graffiti, letters, symbols, blood, logos, watermark, perspective, obvious central focal feature
Avoid: large unique cracks crossing only one edge, dramatic lighting, glossy wetness, repeating stamp artifacts, excessive contrast
```

## `linoleum-albedo-v1`

```text
Use case: stylized-concept
Asset type: tileable game texture, base-color/albedo source for an optimized Meta Quest horror environment
Primary request: seamless square vintage hospital linoleum made of small alternating nicotine-cream and charcoal-green checker tiles, deeply scuffed, wax worn, lightly stained, with subtle hairline seams and occasional restrained rust-colored transfer marks
Style/medium: photorealistic scanned-material appearance, authentic aged institutional flooring
Composition/framing: perfectly orthographic top-down flat surface filling the square; regular checker grid aligned to image axes; exact seamless tiling on all edges
Lighting/mood: neutral diffuse capture with no directional illumination, reflections, cast shadows, vignette, perspective, or baked puddle highlights
Color palette: dirty cream, desaturated dark green-gray, dull brown-gray wear
Constraints: albedo only; no debris, footprints, objects, blood, text, logos, watermark, dramatic puddles, broken missing tiles, or central focal point
Avoid: perspective convergence, irregular grid scale, shiny CGI look, obvious duplicated stamps
```

## `painted-steel-albedo-v1`

```text
Use case: stylized-concept
Asset type: tileable game texture, base-color/albedo source for optimized hospital doors, lockers, pipes, and equipment
Primary request: seamless square texture of old cream-painted steel with chipped enamel, fine scratches, subtle rust blooms, oxidation around small chips, and accumulated institutional grime
Style/medium: photorealistic scanned-material appearance, restrained real-world weathering
Composition/framing: perfectly orthographic front-facing flat metal sheet filling the square; evenly distributed microdetail; seamless tiling in both axes
Lighting/mood: neutral diffuse capture with no directional light, reflections, cast shadows, vignette, or baked specular highlight
Color palette: nicotine cream enamel, dark steel chips, muted orange-brown rust, gray-brown grime
Constraints: albedo only; no bolts, rivets, handles, panels, seams, letters, symbols, blood, logos, watermark, perspective, or unique central damage
Avoid: heavy orange rust covering most of surface, shiny chrome, dramatic depth, repeating stamp patterns
```

## `damage-decals-v1`

```text
Use case: stylized-concept
Asset type: transparent game decal atlas for an optimized Meta Quest abandoned-hospital environment
Primary request: sixteen distinct flat surface-damage decals arranged in a precise 4 by 4 grid: water leak stain, mildew bloom, cracked plaster web, peeled paint patch, soot smear, dirty hand streaks, rusty runoff, shoe scuff cluster, dried restrained blood swipe, small dried blood droplets, dragged grime mark, damp ceiling stain, chipped enamel cluster, black mold edge, old adhesive residue, thin wall scratches
Scene/backdrop: perfectly flat solid #00ff00 chroma-key background for local removal
Style/medium: photorealistic flat decal textures, believable restrained institutional decay
Composition/framing: square atlas; sixteen evenly sized isolated cells; one centered decal per cell; generous clear green padding around every decal; no overlap; no cell borders
Lighting/mood: flat diffuse capture; decal color and opacity only; no directional light, cast shadow, perspective, depth extrusion, floor plane, or reflections
Color palette: gray-brown grime, muted olive mildew, charcoal soot, oxidized rust, dark dried maroon only for two blood cells
Constraints: background must be one perfectly uniform #00ff00 with no gradient, texture, shadows, spill, or variation; do not use green in decals; crisp isolated edges; no text, numbers, logos, watermark, body parts, gore, fresh pools, symbols, or recognizable imagery
Avoid: dramatic splatter, shiny wet blood, 3D chunks, green contamination, vignette, atlas labels
```

## `light-cookies-v1`

```text
Use case: stylized-concept
Asset type: grayscale light-cookie atlas for a Meta Quest Three.js horror environment
Primary request: four distinct projected-light masks arranged in a precise 2 by 2 grid: broken fluorescent diffuser with irregular dim bands, barred institutional window with soft moonlit rectangles, handheld flashlight beam with imperfect dirty lens falloff, swinging industrial cage fixture with radial wire shadows
Scene/backdrop: pure black square background with wide black gutters separating the four cells
Style/medium: physically plausible grayscale projected-light masks, utility texture rather than concept art
Composition/framing: one centered mask per quadrant, each fully contained and fading to black before its cell edges, no overlap
Lighting/mood: white means full light, black means none, smooth grayscale transitions, restrained film grain
Color palette: grayscale only
Constraints: no perspective scene, no objects, no fixtures themselves, no text, labels, numbers, logos, colored pixels, borders, watermark, or clipping at edges
Avoid: lens flare, rainbow artifacts, hard rectangular atlas outline, decorative icons
```

## `atmosphere-particles-v1`

```text
Use case: stylized-concept
Asset type: monochrome particle sprite atlas for optimized Meta Quest WebXR atmosphere
Primary request: sixteen distinct isolated particle sprites arranged in a precise 4 by 4 grid: soft fog puffs, narrow mist wisps, dust motes clusters, ash flakes, tiny ember groups, ceiling drip splash, breath haze, subtle spirit wisp, and variations of each
Scene/backdrop: pure black square background
Style/medium: realistic game VFX masks designed for additive or alpha-from-luminance blending
Composition/framing: one centered white-to-gray sprite per evenly sized cell; generous black padding; no overlap; every sprite fades completely to black before cell edges
Lighting/mood: soft controlled values with useful midtones, no baked scene lighting
Color palette: monochrome grayscale only
Constraints: no text, labels, grid lines, borders, colors, logos, watermark, recognizable objects, faces, skulls, hands, creatures, or scenery
Avoid: clipped smoke at cell borders, solid white blobs, heavy high-frequency noise, dramatic explosions
```
