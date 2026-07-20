# Free Asset Database — College Hill

A curated, mostly-**CC0** (public-domain, no attribution, commercial-ok) database
of places to pull **skins/textures, 3D objects, creatures, sounds, music, VFX,
HDRIs, fonts, and real period documents** to build this game out.

The machine-readable version is **[`asset-db.json`](./asset-db.json)** — sources,
verified download-URL patterns (resolvers), and a starter catalog of specific
assets keyed to what each is for. This file is the human tour.

> **License rule:** prefer **CC0**. If you use **CC-BY**, add the credit to
> [`CREDITS.txt`](./CREDITS.txt). Never commit an asset you haven't confirmed is
> free. ✅ = endpoint/URL pattern tested live during this build.

---

## The short list (start here)

| Category | Best free source | License | Why |
|---|---|---|---|
| **Textures / skins** | ✅ [Poly Haven](https://polyhaven.com/) · ✅ [ambientCG](https://ambientcg.com/) | CC0 | PBR walls/floors/rust + horror **decals** (blood, stains, cracks) |
| **3D objects** | ✅ [Poly Haven models](https://polyhaven.com/models) · ✅ [Poly Pizza](https://poly.pizza/) | CC0 | Gothic beds, cabinets, rocking chairs, medical props, GLB downloads |
| **Creatures / monsters** | ✅ [Quaternius](https://quaternius.com/) | CC0 | **Ultimate Monsters** = 50 rigged+animated monsters (FBX+glTF) |
| **Sounds / SFX** | ✅ [Freesound](https://freesound.org/) · [Pixabay](https://pixabay.com/sound-effects/) | CC0 / RF | whispers, EVP, screams, drips, ambiences |
| **VFX** | ✅ [JangaFX VDB](https://jangafx.com/software/embergen/download/free-vdb-animations/) · [Kenney Particles](https://kenney.nl/assets?q=particle) | free / CC0 | smoke, fire, mist, particle sprites |
| **HDRIs / skyboxes** | ✅ [Poly Haven HDRIs](https://polyhaven.com/hdris) | CC0 | night, moonlit, abandoned interiors |
| **Music** | [Free Music Archive](https://freemusicarchive.org/) · [Musopen](https://musopen.org/) | CC/PD | drones, ambient, PD organ/lullaby |
| **Fonts** | [Google Fonts](https://fonts.google.com/) | OFL | Special Elite, IM Fell, Creepster |
| **Story documents** | [Chronicling America](https://chroniclingamerica.loc.gov/) | PD | **real** 1920s–60s newspaper clippings |
| **Master index** | [awesome-cc0](https://github.com/madjin/awesome-cc0) | — | the curated meta-list |

---

## Creatures & the dead

- **[Quaternius](https://quaternius.com/)** (CC0) — the top pick. Rigged + animated,
  FBX **and glTF** (glTF/GLB drops straight into Three.js). Packs: **Ultimate
  Monsters (50)**, animated skeletons/enemies, animals.
- **[Poly Pizza](https://poly.pizza/)** (CC0) — search a single "ghost/monster/
  skeleton/wheelchair" and download a **GLB**. Mirrors Quaternius, Kenney, the old
  Google Poly library. Free API key for automation.
- **[100/300 Avatars](https://github.com/madjin/100avatars)** (CC0) — rigged humanoid
  avatars; reskin as patients or the Grey Nurse.
- **[Kenney](https://kenney.nl/assets?q=character)** (CC0) — blocky/mini characters.
- **[Sketchfab CC0](https://sketchfab.com/search?features=downloadable&licenses=7c23a1ba438d4306920229c12afcb5f9&type=models)**
  — higher-detail; filter `license=cc0 & downloadable` (download needs a free login).
- **[Smithsonian Open Access](https://3d.si.edu/cc0)** (CC0) — real scanned medical
  instruments/skeletons for authenticity.

## 3D objects / props (Poly Haven, CC0 — verified IDs in `asset-db.json`)

`GothicBed_01`, `GothicCabinet_01`, `Rockingchair_01`, `SchoolDesk_01`,
`WetFloorSign_01`, `barrel_stove`, `brass_candleholders`, `ceiling_fan`,
`desk_lamp_arm_01`, `drawer_cabinet`, `fancy_picture_frame_01`,
`book_encyclopedia_set_01`, `alarm_clock_01`, `cardboard_box_01`, `Megaphone_01`.

Pull any of them:
```
curl -s https://api.polyhaven.com/files/GothicBed_01   # JSON with every download URL
# gltf: https://dl.polyhaven.org/file/ph-assets/Models/gltf/1k/GothicBed_01/GothicBed_01_1k.gltf
```

## Textures / skins

- **[Poly Haven](https://polyhaven.com/textures)** (CC0) — already used for walls/
  floors/ceiling/door. Deterministic URLs (see resolvers).
- **[ambientCG](https://ambientcg.com/)** (CC0) — the extra win is **Decals**:
  blood splatter, stains, cracks, water damage, grime → overlay on walls/floors for
  instant horror. `https://ambientcg.com/list?type=Decal`. ZIPs via
  `https://ambientcg.com/get?file=<Id>_1K-JPG.zip`.
- **[3DTextures.me](https://3dtextures.me/)**, **[Texture Ninja](https://texture.ninja/)** (CC0)
  — more materials + photo grime + paper for documents.

## Sounds / SFX

- **[Freesound](https://freesound.org/)** — best library. Filter
  `license:"Creative Commons 0"`. Search whispers, EVP, child laugh, scream,
  crying, abandoned-hospital room tone, door creak, metal drag, drips.
  *Downloading files needs a free API token; searching is open.*
- **[Pixabay SFX](https://pixabay.com/sound-effects/search/horror/)** — royalty-free,
  no attribution, easy download; free API key for automation.
- **[Sonniss GDC](https://sonniss.com/gameaudiogdc)** — multi-GB pro bundles, free +
  royalty-free for games.
- **[Kenney Audio](https://kenney.nl/assets?q=audio)** (CC0) — impact/interface SFX.

> The game currently synthesizes **all** audio live (no files). These are for
> layering in recorded EVP/ambience later — drop files into `assets/audio/` and
> wire a small file player alongside `js/audio.js`.

## VFX

- **[JangaFX free VDB](https://jangafx.com/software/embergen/download/free-vdb-animations/)**
  — volumetric smoke/fire/mist/explosions, free & commercial-ok. For the web build,
  bake to **sprite sheets** (or use as reference); native in Blender/Unity/UE.
- **[Kenney Particle Pack](https://kenney.nl/assets?q=particle)** (CC0) — smoke puffs,
  sparks, magic — as Three.js sprite/point clouds.
- **[OpenGameArt](https://opengameart.org/)** — CC0 fire/smoke/blood **sprite sheets**
  (verify each item's license).

## HDRIs / skyboxes (Poly Haven, CC0)

`dikhololo_night` (moonlit), `blaubeuren_night`, `abandoned_hall_01`,
`abandoned_church`, `approaching_storm`.
```
# https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/dikhololo_night_1k.hdr
```
Use as a Three.js scene environment/background for a real night sky through windows.

## Fonts (Google Fonts, OFL — self-host the .woff2)

- **Special Elite** — typewriter, for documents & the case file.
- **IM Fell English** — old print, for newspaper clippings.
- **Creepster / Nosifer** — the title.

## Story documents (real, public-domain)

- **[Chronicling America](https://chroniclingamerica.loc.gov/)** — Library of Congress
  digitized US newspapers **1770–1963**, public domain, **JSON API** + page images.
  Pull genuine West Virginia clippings from around the 1926 fire / 1962 shooting to
  back the mystery. Example:
  `https://chroniclingamerica.loc.gov/search/pages/results/?state=West+Virginia&andtext=hospital+fire&format=json`
- **[Internet Archive](https://archive.org/)** / **[Wikimedia Commons](https://commons.wikimedia.org/)**
  — PD forms, photos, ephemera, asylum/hospital imagery.

---

## Pulling assets (the two deterministic APIs)

`tools/fetch-asset.sh` wraps the verified endpoints:
```
tools/fetch-asset.sh ph-tex  dirty_tiles         # Poly Haven texture (diff+nor, 1k jpg)
tools/fetch-asset.sh ph-model GothicBed_01        # Poly Haven model (gltf+bin+textures)
tools/fetch-asset.sh ph-hdri  dikhololo_night     # Poly Haven HDRI (1k hdr)
tools/fetch-asset.sh acg      Rock030             # ambientCG material (1k jpg zip)
```
Everything downloaded is CC0 — record CC-BY/RF items in `CREDITS.txt`.
