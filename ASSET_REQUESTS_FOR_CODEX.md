# Asset Requests for Codex — Textures & Visuals

From: Claude (gameplay/integration) · To: Codex (generation/visual PR)
Repo: `Onechance12/scgame` · Base your PR on the latest `claude/sam-colby-ghost-game-s5fct5`.
Game: "College Hill — 24 Hours", WebXR survival horror, Meta Quest primary target, 1928–1988 abandoned hospital in Williamson, WV.

## Coordination — read first

1. **The asset loader was rebuilt on 2026-07-21** (commit `aec424b`). `loadHeroModels()` no longer
   exists — models register in the `Assets` staged-group registry near the top-middle of
   `js/vr-game.js` (search `"staged assets"`). **Prefer not to touch `js/` at all**: put files
   under `assets/generated/<pack-name>/` and I will wire them in. That guarantees zero merge
   conflicts with active gameplay work.
2. **CI now gates deploys.** Your PR must pass:
   - `node --check` on every file in `js/` and `scripts/` (another reason not to touch them);
   - `node scripts/validate-assets.mjs` — every `.gltf` you add must have resolving
     buffer/image URIs, and any asset path referenced from JS must exist on disk.
3. **Budgets (hard):** keep the whole PR under **20 MiB**. Textures ≤ **1024×1024** (512 for
   decals/sprites), power-of-two, PNG (alpha/normal) or JPG (opaque albedo), sRGB color.
   Models: **glTF 2.0 metallic-roughness only** (GLB preferred), ≤ 10k faces, Y-up, real-metre
   scale, textures ≤ 1K. **No `KHR_materials_pbrSpecularGlossiness`** — it is the source of the
   one console warning we have and CI will eventually reject it.
4. **Licensing (hard):** generated content only, clean provenance. Add a short `PROVENANCE.md`
   per pack (tool, date, and that it's original work for this repo). **No copyrighted characters
   or marks**: no SCP, no Silent Hill, no real-person likenesses. Never commit API keys/tokens.

## Requests, in priority order

### P0 — added 2026-07-22 (owner directive): ORIGINAL ENTITY CAST, license-free

14. **`generated/entities/<kind>/` — original replacement monsters, one GLB each.**
    Chance wants a cast we own outright: generated for this repo, **no third-party
    license, no attribution obligation, no real-person likeness, no franchise
    creature** (no SCP, no Silent Hill nurse, nothing recognizable). These replace
    the credited Sketchfab cast one-for-one; I retarget the loader per model as
    each lands, so ship them in any order — **batches welcome, one kind per folder.**

    **Priority order** (worst licensing first):
    1. `child` — replaces `horrorkid` (**CC-BY-NC — currently blocks any commercial
       build**). A small hospital-gown phantom, ~1.18 m. This one matters most.
    2. `crawler` — prone mutated body dragging itself, low silhouette ~0.62 m tall.
    3. `nurse` + `nurse2` — two 1920s ward nurses, ~1.78/1.80 m: one pale and
       half-there, one sicklier/greenish. Distinct faces/uniform states.
    4. `mose` — a huge dark orderly, ~2.02 m, broad, straitjacket straps.
    5. `ash` — charred straitjacketed body, ~1.92 m, cracked ember-glow skin.
    6. `ghoul` — hunched corpse-eater, ~1.72 m, long arms.
    7. `undead` — blood-caked patient, ~1.86 m, hospital gown.
    8. `nightmare` / `wraith` — two spectral variants (can share a base mesh with
       different textures), ~1.8 m.
    9. Stretch: `matron` (hooded, tall, faceless) and `runner` (gaunt sprinter for
       the exterior grounds).

    **Hard technical contract (the loader depends on this):**
    - glTF 2.0 **GLB**, metallic-roughness only, Y-up, real-metre scale, feet at
      origin. ≤ 15k faces, textures ≤ 1024, ideally **one material per model**.
    - **Rigged + animated, clips named so these substrings match (lowercase):**
      `idle`, `walk`, `run`. (Our finder also accepts `walking_a`/`running_a`.)
      Walk ~1.1 m/s and run ~2.5 m/s root-relative — animation is retimed in
      engine (`timeScale` from actual velocity), but authoring near those speeds
      minimizes foot-slide. **In-place clips only, no root motion.**
    - Idle must be a true standing loop (breathing/swaying), not a T-pose.
    - Keep silhouettes close to the descriptions above — engine tints, auras,
      translucency, and height-normalization are already tuned per kind and will
      be reused.
    - Per model: PROVENANCE.md + manifest with SHA-256/bytes/dims, exactly like
      the ceiling-floor pack. State explicitly that generation used no
      third-party model, scan, or likeness as reference.
    - A bad rig is worse than the licensing debt — if a model's deformation is
      broken, hold it back rather than ship it.

### P1 — kills a known problem

1. **`generated/watch/` — a 1920s field wristwatch, GLB.**
   Replaces `assets/models/horror/smartwatch/` (legacy specular-glossiness → the only runtime
   warning, and a modern smartwatch is an anachronism anyway). Worn leather strap, scratched
   brass or steel case, aged cream dial. ≤ 5k faces, ≤ 512px textures. The canvas HUD renders
   on a separate plane, so the model needs **no screen** — just a handsome dead watch face.
2. **`generated/newspaper/` — the tutorial newspaper, one 1024×1024 PNG.**
   Front page of *The Williamson Daily, October 1988*: masthead, headline
   `COLLEGE HILL HOSPITAL TO CLOSE AFTER SIXTY YEARS`, believable column text (can be soft
   gibberish below the fold), coffee-stained, yellowed, one torn corner. Currently that prop is
   a plain beige rectangle — this is the single highest visual win per byte in the game.
3. **`generated/flames/` — a clean flame flipbook sheet.**
   One 1024×1024 PNG, **uniform 8×8 grid** (128px frames), loopable orange fire on black
   (additive-blend ready), plus a green-tinted variant for witchfire. The found atlas we use has
   uneven strips, which limits where I can put fire. With a clean grid I'll upgrade the ritual
   altar and add the incinerator fire.

### P1.5 — added 2026-07-22 (new gameplay systems just landed)

11. **`generated/generator/` — a 1920s industrial generator, GLB.** The basement power
    system shipped with a procedural placeholder: replace it. Cast-iron engine block on a
    skid, riveted fuel tank, flywheel + hand crank, brass pressure gauge, cloth-wrapped
    cables. Rust, oil staining, chipped paint. ≤ 10k faces, ≤ 1K textures, ~1.7 m long.
    It sits in the boiler room and the player cranks it by hand — make it look worth the risk.
12. **`generated/mirrors/` — mirror scare set.** (a) A wall mirror with an aged wooden
    frame, GLB ≤ 3k faces (silvered glass slightly desilvered at the edges); (b) the SAME
    mirror broken: empty frame + a few shards clinging, for the after-state; (c) a 512px
    **cracked-glass decal** (PNG alpha, spiderweb crack radiating from an impact point) we
    can overlay on any intact mirror; (d) a 512px **glass-shard sprite sheet** (4×4, bright
    slivers on black, additive-ready) for the shatter burst.

### P1.6 — added 2026-07-22: the forest (owner request: "trees… a forest and all the tall grass")

13. **`generated/forest/` — an Appalachian night-forest vegetation pack.** The hillside
    approach is being planted much more densely and everything will be INSTANCED, so the
    hard technical rule is: **each plant = ONE mesh with ONE material** (single texture,
    alpha-carded foliage), or it can't go through `THREE.InstancedMesh` and won't ship.
    - (a) **Three tree species as separate GLBs**, ≤ 2.5k faces each, Y-up, real-metre
      scale, roots at origin: a **bare winter oak** (gnarled, wide crown of naked
      branches), an **eastern hemlock/pine** (dark evergreen mass), and a **young
      sycamore/birch** (thin pale trunk, sparse leaves). Trunk geometry + alpha-card
      canopy planes, 1K texture each (albedo + alpha; bark and branches can share the
      sheet). We scale instances 0.5×–2× so silhouettes must hold up both ways.
    - (b) **Tall grass / weed cards**: one 1024×1024 PNG alpha sheet with 4–6 isolated
      clumps (broomsedge, dead goldenrod, briers, thistle) laid out on a grid so we can
      cut per-clump UVs and build crossed-plane billboards. Muted winter browns/greens.
    - (c) **A night treeline strip**: seamless-tiling 2048×256 (or 1024×256) PNG alpha of
      a dark forest silhouette skyline — bare crowns + conifer spikes — to ring the far
      hillside as a billboard wall behind the playable grounds.
    - (d) Optional: a **fallen log / stump set**, one GLB ≤ 1.5k faces, same one-material
      rule (we'll scatter and half-bury them).
    Whole pack ≤ 8 MiB. Provenance/manifest exactly like the ceiling-floor pack — that
    workflow was perfect.

### P2 — big atmosphere upgrades

4. **`generated/signs/` — period hospital signage pack, PNGs with alpha, 512px each.**
   Aged enamel/painted signs: `WARD 2-A`, `WARD 2-B`, `MATERNITY`, `SURGERY`, `X-RAY`,
   `RECORDS`, `MORGUE`, `AUTOPSY`, `PHARMACY`, `CHAPEL`, `NO ADMITTANCE`, `QUIET PLEASE`,
   an arrow sign `STAIRS →`, and one big `COLLEGE HILL HOSPITAL — EST. 1928` facade sign
   (this one 1024×256). Rust streaks, chipped edges, 1920s letterforms.
5. **`generated/documents/` — aged paper backgrounds, 3–4 JPGs, 1024×768.**
   Blank-ish period forms for the in-game document viewer: a patient admission form, a police
   report letterhead, a handwritten-diary page, a press-cutting column layout. Faint printed
   structure, stains, fold lines — text areas mostly empty (the game types its own story onto
   them).
6. **`generated/walls/` — two seamless 1K wall sets.**
   (a) classic **hospital-green painted plaster**, peeling to reveal older paint; (b) 1920s
   **floral wallpaper**, water-stained and peeling. Albedo + optional normal. Seamless/tileable
   is mandatory — they run continuous UVs across whole corridors.
7. **`generated/grime/` — decal sheet, 1024×1024 PNG, alpha.**
   A grid of isolated decals: black mold blooms, rust runs, water stains, scuffed handprints
   (smeared, not fresh-gore). Our current decals are tiny procedural canvases; real ones would
   raise every room.

### P3 — nice to have

8. **`generated/title/` — start-screen key art, 1920×1080 JPG.**
   The hospital dark on its hill above Williamson, one amber window lit, mist, moonlight.
   Painterly, not photoreal. No people, no logos.
9. **`generated/parchment/` — burning-parchment texture set** (paper albedo + scorched-edge
   alpha mask). We rejected a 115k-face burning-parchment model for Quest; with these I can
   build the effect on a 2-triangle card.
10. **Stretch — `generated/child/`:** an original rigged low-poly ghost child (GLB, ≤ 15k faces,
    idle + walk clips) to eventually replace the CC-BY-NC `horrorkid`, which blocks any future
    commercial use. Only attempt if rigged output is solid — a bad rig is worse than the
    licensing debt.

## What NOT to do

- Don't regenerate/replace the credited CC-BY models wholesale — they're working and credited.
- Don't touch gameplay, multiplayer, saves, or `index.html` structure.
- Don't add npm dependencies, service workers, or build steps.
- Don't exceed the byte budget to add mipmaps/4K "quality" — Quest memory is the constraint.

Deliver as one PR against `claude/sam-colby-ghost-game-s5fct5` with the packs under
`assets/generated/`. I'll review, integrate, credit, and wire each pack into the staged loader.
