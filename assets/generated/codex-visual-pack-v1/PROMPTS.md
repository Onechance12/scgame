# Final generator prompts

These are the exact built-in image-generation prompts behind the committed derivatives. Every base raster was generated from text; no pre-existing repository, stock, downloaded, or third-party raster was supplied as a reference. The parchment mask used this pack's generated parchment albedo as its only image input, and sign derivatives use documented system-font glyphs plus local transforms. Period-style words such as “authentic” below describe the requested visual target, not independent historical verification.

## `newspaper-v1`

```text
Use case: historical-scene
Asset type: square game prop texture, tutorial newspaper front page
Primary request: Create an original late-1980s small-town West Virginia newspaper front page, photographed/scanned perfectly straight-on and filling the entire square canvas edge to edge. It is an aged physical broadsheet from October 1988, yellowed newsprint, subtle coffee-ring stain, fold creases, worn edges, and exactly one torn corner. The design must feel believable and restrained, not a horror poster.
Composition/framing: orthographic flat scan, 1024 x 1024 square composition, front page fills frame, no table or background around it. Strong masthead at top, date line immediately beneath, one large headline, then plausible narrow newspaper columns and one small generic monochrome hospital-building photo below the fold. Body copy may be softly printed and largely unreadable so it works as background texture.
Text (verbatim): Masthead exactly once: "THE WILLIAMSON DAILY". Date exactly once: "OCTOBER 1988". Main headline exactly once across the page: "COLLEGE HILL HOSPITAL TO CLOSE AFTER SIXTY YEARS".
Typography: authentic late-1980s American newspaper serif masthead and headline; crisp, high-contrast, correctly spelled uppercase text. Spell WILLIAMSON as W-I-L-L-I-A-M-S-O-N. Spell COLLEGE HILL HOSPITAL TO CLOSE AFTER SIXTY YEARS exactly as written.
Color palette: warm aged ivory paper, faded charcoal ink, restrained brown coffee stain.
Constraints: original fictional layout; exact required text and no other prominent headlines; no modern objects; no logos, trademarks, people, hands, watermark, signature, frame, perspective skew, or surrounding scene. Keep all important text well inside safe margins. One torn corner only.
```

## `document-patient-v1`

```text
Use case: historical-scene
Asset type: blank period document background for an in-game document viewer
Primary request: Create an original blank-ish patient admission form from a small Appalachian hospital, circa 1930s to 1950s. It must function as a background plate: the game will typeset its own story text over it.
Composition/framing: perfectly straight-on flat scan of one landscape 4:3 sheet filling the entire canvas edge to edge; no desk or surrounding scene. Keep the central 75 percent pale, quiet, and highly legible for overlaid text. Faint printed structure only: thin ruled fields near the top, a sparse patient-information grid, a subtle vertical margin line, and a small empty signature/date area along the bottom.
Style/medium: authentic aged paper and letterpress form, understated institutional design.
Color palette: warm ivory paper, very faded blue-gray and charcoal printing, sparse pale brown stains.
Materials/textures: fine paper fibers, subtle fold lines, softened corners, light edge wear, restrained foxing.
Constraints: mostly empty text areas; any tiny field labels must be generic, faint, and unobtrusive. No patient name, handwriting, filled answers, story text, hospital logo, seal, photograph, people, hands, pen, clipboard, watermark, signature, frame, perspective skew, or dramatic shadows. No prominent headline. Keep visual noise low and avoid dark stains in the center.
```

## `document-police-v1`

```text
Use case: historical-scene
Asset type: blank period document background for an in-game document viewer
Primary request: Create an original blank-ish county police incident report letterhead, circa 1962, suitable as a background plate while the game types its own story over it.
Composition/framing: perfectly straight-on flat scan of one landscape 4:3 sheet filling canvas edge to edge; no desk. Keep central 70 percent pale and open. A restrained generic county police heading at top, thin case/date/officer fields, one faint horizontal rule, a tiny empty routing box, and a sparse signature line at bottom. No official real agency identity.
Style/medium: authentic mid-century carbon-copy/typed form on aged government paper.
Color palette: cool gray-ivory paper, faded charcoal/typewriter ink, subtle blue carbon traces, sparse tan stains.
Materials/textures: paper fibers, two soft fold lines, light edge wear, restrained foxing.
Constraints: mostly empty writing area; generic faint field labels only. No case narrative, names, badge number, handwriting, filled answers, real seal, real logo, photograph, people, hands, pen, clipboard, watermark, frame, perspective skew, dramatic shadows, or prominent unrelated text. Keep dark marks away from central story area.
```

## `document-diary-v1`

```text
Use case: historical-scene
Asset type: blank period document background for an in-game document viewer
Primary request: Create an original blank-ish handwritten diary page from a hospital matron's private journal, circa 1950s. It is a background plate; the game will typeset its story onto it.
Composition/framing: perfectly straight-on flat scan of one landscape 4:3 cream paper sheet filling canvas edge to edge. Keep the middle broad and lightly ruled. Include only a few faint, illegible cursive fragments near the upper and lower edges, leaving at least 70 percent of the page clear for overlay text. A narrow red margin rule and subtle blue horizontal ruling are acceptable.
Style/medium: authentic fountain-pen journal paper, intimate but restrained, not occult or theatrical.
Color palette: aged cream, faded blue rules, muted sepia-black ink, a trace of brown handling stain.
Materials/textures: fine paper grain, gentle center fold, softened edges, sparse foxing.
Constraints: no legible diary story, no names, no symbols, no blood, no drawings, no occult marks, no photograph, people, hands, pen, book cover, watermark, frame, perspective skew, or dark center stains. Mostly empty and highly readable beneath game text.
```

## `document-press-v1`

```text
Use case: historical-scene
Asset type: blank period press-cutting background for an in-game document viewer
Primary request: Create an original blank-ish newspaper press-cutting layout, circa 1920s to 1960s, to sit behind story text typeset by the game.
Composition/framing: perfectly straight-on flat scan of a landscape 4:3 aged newsprint clipping filling canvas edge to edge; no desk. Use a faint two- or three-column grid, thin rules, an empty headline band at the top, and one pale empty photo box or halftone placeholder pushed to a lower corner. Keep the central text zones quiet and mostly blank.
Style/medium: authentic letterpress newsprint, softly yellowed and slightly uneven, understated archival clipping.
Color palette: warm gray-yellow newsprint, faded charcoal rules, restrained tan age marks.
Materials/textures: newsprint fibers, fold line, softly ragged cut edges, light foxing.
Constraints: no legible headline, no article narrative, no names, no newspaper masthead, no real logo, no recognizable photograph, people, hands, scrapbook background, tape, watermark, frame, perspective skew, dramatic shadows, or dark central stains. The game must have clean areas for its own headline and body text.
```

## `sign-plates-v1`

```text
Use case: stylized-concept
Asset type: source sheet for transparent 1920s hospital game signage
Primary request: four distinct blank aged enamel or painted-steel hospital sign plates, arranged in a precise 2 by 2 grid, to serve as reusable source plates for a Meta Quest WebXR game
Scene/backdrop: perfectly flat solid #ff00ff chroma-key background for local background removal
Subject: four wide horizontal rectangular sign plates, each fully visible, straight-on, orthographic, isolated, with generous magenta space around it; variants should include faded surgical-green enamel with cream border, nicotine-cream enamel with dark green border, dark oxidized green painted steel with cream inset border, and aged ivory enamel with thin black and rusted edge; restrained chips, scratches, rust streaks, tiny corner mounting holes or bolts; large clean empty center area for later typesetting
Style/medium: realistic game-asset texture source, period-appropriate 1920s–1980s institutional hospital signage, readable at small size
Composition/framing: exact 2x2 layout; one centered 3:1 horizontal plate in each quadrant; no overlap; every plate entirely contained within its quadrant; front faces parallel to the image plane; no perspective
Lighting/mood: neutral diffuse capture, no cast shadows, no scene lighting, no vignette, no reflections
Color palette: desaturated surgical green, aged ivory, nicotine cream, black, muted brown rust; absolutely no magenta within any plate
Text: none; all sign faces must be completely blank
Constraints: background must be one uniform #ff00ff with no shadows, gradients, texture, floor plane, or lighting variation; crisp plate silhouettes; no words, letters, numbers, arrows, symbols, logos, brands, watermark, decorative icons, wall, frame, props, or extra objects
Avoid: perspective, beveled 3D depth, dramatic corrosion obscuring the empty center, modern wayfinding style, glossy new surfaces, illegible pseudo-text, magenta spill
```

## `sign-facade-v1`

```text
Use case: stylized-concept
Asset type: source plate for a transparent 1920s hospital facade sign texture
Primary request: one single blank ultra-wide aged painted-enamel hospital facade sign plate for later deterministic typesetting
Scene/backdrop: perfectly flat solid #ff00ff chroma-key background for local background removal
Subject: one long horizontal rectangular dark desaturated surgical-green enamel sign plate, approximately 4.5 to 1 width-to-height, entirely visible straight-on; aged ivory inset border; restrained chipped enamel, muted rust along the outer rim, four small corner mounting holes; broad clean empty center for text
Style/medium: realistic game-asset texture source, stately 1920s institutional civic-hospital character
Composition/framing: single plate centered horizontally and vertically with generous magenta padding; front face parallel to image plane; exact orthographic straight-on view; no perspective
Lighting/mood: neutral diffuse capture, no cast shadow, no vignette, no reflections
Color palette: dark oxidized surgical green, aged ivory, black, muted brown rust; absolutely no magenta within the plate
Text: none; sign face completely blank
Constraints: background must be one uniform #ff00ff with no shadows, gradients, texture, floor plane, or lighting variation; crisp silhouette; no words, letters, numbers, arrows, symbols, logos, brands, watermark, decorative icons, wall, frame, props, or extra objects
Avoid: pseudo-text, perspective, thick 3D depth, glossy new finish, dramatic corrosion obscuring the center, modern wayfinding style, magenta spill
```

## `flames-orange-v1`

```text
Use case: production-asset
Asset type: game VFX flipbook texture atlas for Meta Quest WebXR
Primary request: a single loopable orange fire animation sequence arranged as an exact uniform 8 by 8 grid of sixty-four square frames; every frame contains one centered small flame silhouette at a consistent scale; the animation progresses smoothly left-to-right and top-to-bottom and the final frame transitions naturally back to the first
Scene/backdrop: pure solid black background in every frame
Style/medium: realistic but optimized game-particle fire, clean additive-blend-ready sprite sheet, soft orange core with yellow-white center and restrained red edge
Composition/framing: square atlas, exactly eight columns and exactly eight rows, no gutters and no grid lines; each flame stays fully inside its cell with generous black padding and never crosses a cell boundary
Lighting/mood: emissive flame only, no scene illumination or surface beneath it
Color palette: black, amber, orange, warm yellow-white, tiny restrained red
Constraints: exactly 64 equal cells; no labels, numbers, text, borders, watermark, smoke, sparks crossing cells, objects, logs, candles, torches, hands, scenery, floor, reflections, logos, or colored background; frame centers and flame baseline must remain stable
Avoid: uneven strips, irregular cell sizes, montage borders, clipped flames, large explosions, camera movement, white background, decorative presentation
```

The green witchfire sheet is a deterministic hue-derived derivative of the orange result; no separate generator prompt was used.

## `grime-v2`

```text
Use case: production-asset
Asset type: surface grime decal atlas for a Meta Quest abandoned-hospital game
Primary request: sixteen distinct flat decay decals in an exact 4 by 4 grid, left-to-right top-to-bottom: vertical water leak, circular water ring, black mold bloom, mildew edge, thin rust run, broad rust runoff, damp ceiling stain, soot smear, smeared dirty handprint, finger streaks, shoe scuffs, dragged grime, chipped cream enamel, old adhesive residue, fine wall scratches, peeling green paint patch
Scene/backdrop: perfectly uniform pure white #ffffff background for local removal
Style/medium: photorealistic flat surface decal textures, believable restrained institutional decay, original imagery
Composition/framing: square atlas with sixteen equal cells; one centered isolated decal per cell; very generous untouched white padding around every decal; no overlap, no cell borders, no grid lines
Lighting/mood: flat diffuse color/opacity source only; no directional light, cast shadow, perspective, depth extrusion, floor plane, reflections, or vignette
Color palette: charcoal and gray-brown grime, muted olive mildew, oxidized orange-brown rust, nicotine cream chips, desaturated surgical green paint
Constraints: background must remain perfectly uniform #ffffff; do not use white inside the decal art except tiny enamel chips; no blood, gore, text, numbers, symbols, logos, body parts, brands, watermark, scenery, or recognizable imagery; crisp isolated edges suitable for extraction
Avoid: green-screen backgrounds, bright neon color, shiny wet effects, 3D chunks, dramatic splatter, central presentation shadow, atlas labels
```

## `wall-green-v2`

```text
Use case: stylized-concept
Asset type: seamless tileable 1K albedo texture for continuous Meta Quest hospital corridor UVs
Primary request: old 1920s institutional plaster painted faded hospital green, with restrained evenly distributed fine cracking, small peeling paint islands, subtle mildew freckles, and faint age discoloration
Style/medium: photorealistic scanned-material appearance, flat base-color/albedo source rather than concept art
Composition/framing: perfectly orthographic front-facing square surface filling the frame; exact seamless tiling in both axes; balanced microdetail across the entire image
Lighting/mood: neutral diffuse capture with no directional lighting, cast shadows, highlights, ambient occlusion, vignette, or baked depth
Color palette: desaturated pale hospital green, warm gray plaster, tiny nicotine-cream and gray-brown age marks
Constraints: albedo only; no horizontal tide line, no broad dirt band, no global gradient, no center focal point, no large unique crack, no high-contrast feature near an edge, no trim, corner, floor, graffiti, text, symbols, blood, objects, logos, watermark, perspective, or wet gloss
Avoid: dramatic peeling holes, obvious repeated stamp clusters, large dark mold masses, directional shadows, uneven illumination
```

## `wall-wallpaper-v2`

```text
Use case: stylized-concept
Asset type: seamless tileable 1K albedo texture for continuous Meta Quest hospital corridor UVs
Primary request: authentic restrained 1920s institutional floral wallpaper, a small repeating Art Nouveau sprig motif on faded cream-and-pale-sage paper, aged with fine cracking, tiny isolated peel flecks, subtle foxing, and faint evenly distributed water speckles
Style/medium: photorealistic scanned-material appearance, flat base-color/albedo source rather than a wall scene
Composition/framing: perfectly orthographic front-facing square surface filling the frame; exact seamless tiling in both axes; motif repeat aligned and consistent; small-scale balanced wear across the whole image
Lighting/mood: neutral diffuse capture with no directional light, cast shadows, highlights, ambient occlusion, vignette, or baked depth
Color palette: yellowed cream, pale sage, muted ochre stems, dusty burgundy flower accents, warm gray age marks
Constraints: albedo only; no large peeled areas, no broad dark stain, no unique central damage, no repeating giant patch, no global gradient, no high-contrast feature near an edge, no trim, corner, floor, objects, text, symbols, blood, logos, watermark, perspective, or wet gloss
Avoid: Victorian luxury brocade, bold modern print, large flowers, dramatic torn sheets, obvious cloned damage stamps, directional shadows, uneven illumination
```

## `title-v1`

```text
Use case: stylized-concept
Asset type: 16:9 video-game title-screen background art
Primary request: an original fictional 1920s brick hospital standing dark on a steep wooded hill above Williamson, West Virginia at night; the building feels abandoned and watchful, with exactly one small amber-lit window
Scene/backdrop: distant Appalachian valley town far below as a sparse scatter of dim lights; layers of pine-covered hills; drifting low mist and a cloud-veiled moon
Subject: the hospital dominates the hilltop in a wide establishing view, period-appropriate institutional architecture with a central block, restrained wings, tall dark windows, and a weathered roofline
Style/medium: painterly cinematic horror key art, traditional gouache and oil-brush feeling, richly atmospheric rather than photorealistic
Composition/framing: wide 16:9 landscape, hospital centered slightly above the horizontal midline, hill rising as a dark silhouette, open murky sky and mist providing title-safe negative space; readable at thumbnail size
Lighting/mood: cold blue-gray moonlight, deep charcoal shadows, thin silver fog, exactly one subtle warm amber window as the only warm focal light; ominous, lonely, restrained
Color palette: midnight navy, slate blue, charcoal, desaturated pine green, moonlit gray, one muted amber accent
Materials/textures: weathered brick, damp stone, tangled winter brush, soft mist, visible painterly brush grain
Constraints: final intent 1920x1080; original fictional hospital imagery only; no people; no vehicles; no ghosts; no creatures; no gore; no fire; no lightning; no readable signs; no title lettering; no text; no logos; no watermark; no recognizable franchise imagery; no real-person likeness
Avoid: modern skyscrapers, castle turrets, fantasy architecture, bright city skyline, multiple lit windows, orange sky, exaggerated haunted-house clichés, photographic realism
```

## `parchment-albedo-v1`

```text
Use case: stylized-concept
Asset type: game texture albedo for a two-triangle burning-parchment card
Primary request: an original blank sheet of very old parchment seen perfectly front-on, filling the square canvas; warm fibrous paper with an irregular scorched perimeter, dark charcoal-brown singeing, ember-rust discoloration, tiny burned notches and a few small edge holes; broad clean center suitable for overlay text
Style/medium: realistic painterly game-texture albedo, materially believable handmade rag paper, not a photographed prop scene
Composition/framing: orthographic flat square; one continuous parchment sheet fills nearly the whole canvas; irregular burned contour stays close to all four image edges; wide uninterrupted central writing area
Lighting/mood: neutral diffuse albedo lighting with no directional cast shadow and no scene lighting
Color palette: warm bone, antique cream, ochre fibers, sepia stains, dark brown and charcoal edge scorching, very restrained ember-red traces only at the rim
Materials/textures: fine rag-paper fibers, faint creases, scattered foxing, subtle age mottling, crisp-to-feathered burn transition at the perimeter
Constraints: 1024x1024 square intent; opaque paper albedo; blank center; edge treatment must be easy to pair with a black-and-white opacity mask; no active flames; no smoke; no separate background scene; no perspective; no drop shadow; no handwriting; no printed marks; no symbols; no text; no logos; no watermark; original fictional imagery only
Avoid: treasure map, scroll rolls, wax seals, quills, books, desk surface, human hands, gore, recognizable franchise imagery, large holes through the writing area
```

## `parchment-mask-v1`

```text
Use case: precise-object-edit
Asset type: grayscale opacity/alpha mask for the referenced burning-parchment game texture
Input images: Image 1 is the exact parchment albedo and silhouette to match
Primary request: convert Image 1 into a clean, usable black-and-white opacity mask while preserving the exact outer burned-paper contour, corner losses, top-edge holes, bottom-edge notches, and all major silhouette irregularities
Style/medium: technical grayscale mask, not artwork
Composition/framing: same square framing and alignment as Image 1; do not move, crop, rotate, scale, or redesign the parchment silhouette
Pixel meaning: pure white (#FFFFFF) throughout all surviving parchment interior; pure black (#000000) everywhere outside the parchment and inside fully burned-through holes; a narrow smooth gray antialias/feather transition only along the scorched cutout boundary
Constraints: change only the rendering into a mask; preserve Image 1's exact contour and hole placement; 1024x1024 square intent; full-range grayscale; high-contrast; opaque PNG image carrying mask values in RGB/luminance; no paper texture inside the white region; no shadows; no glow; no flame; no orange; no color; no text; no logos; no watermark
Avoid: gray interior gradients, photographic paper detail, invented holes, changed edge geometry, soft broad halo, inverted mask
```
