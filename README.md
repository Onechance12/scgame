# COLLEGE HILL — 24 Hours  🥽

A **VR survival-horror game** for the **Meta Quest** (and any WebXR headset),
built to run right in the headset's browser — no store, no sideloading, no APK.
There's also a desktop mode and a 2D version.

You are locked, alone, inside the **Old Hospital on College Hill** in
Williamson, West Virginia — the real abandoned asylum from Sam & Colby's
most-viewed investigation, *"Our Unexplainable Night at Haunted Asylum."* Your
ride is gone. The doors are chained. You have until dawn — **24 hours**.

The dead have that long with you.

---

## Play on a Meta Quest (VR)

WebXR needs to be served over **HTTPS** (or `localhost`). Pick one:

### Easiest — GitHub Pages (free, HTTPS)
1. Push this repo to GitHub.
2. Repo **Settings → Pages →** deploy from your branch, root folder.
3. On the Quest, open the **Meta Quest Browser** and go to your Pages URL
   (e.g. `https://<you>.github.io/scgame/`).
4. Tap **🥽 ENTER IN VR**, put the headset on, and stand in a cleared space.

### Local network (same Wi-Fi as the Quest)
```bash
# from the project folder — any static server with HTTPS works
npx http-server -S -C cert.pem -K key.pem   # or use mkcert to make cert.pem/key.pem
```
Then browse to `https://<your-computer-ip>:8080` in the Quest browser.
(Plain HTTP works for the *desktop* preview but the headset needs HTTPS.)

### VR controls
| Control | Action |
|---|---|
| **Left thumbstick** | Walk (smooth locomotion) |
| **Right thumbstick** | Snap-turn (comfort) |
| **Trigger** | Interact — pick up, use stairs, read, ring the bell |
| **Right grip** | Toggle the flashlight |
| **Left grip (hold)** | Spirit box — listen for answers |
| **Wrist panel (left hand)** | Your clock, fear, light, body, objective |

Comfort: snap-turn + a motion vignette are on by default. Play standing, room-scale.

---

## Play on desktop (no headset)

Open `index.html` **through a local server** (ES-free, but browsers still
sandbox some features on `file://`):
```bash
python3 -m http.server 8000    # then visit http://localhost:8000
```
Click **🖥 PLAY ON DESKTOP**. Controls: **WASD** move · **drag mouse / click to
lock** look · **F** flashlight · **E** interact · **Q** spirit box · **Shift**
run · **P** pause.

> The 2D top-down original is at **`flat.html`** and runs from a bare file with
> no server at all.

> **Why serve it?** The 3D hospital uses real textures, and browsers block
> WebGL textures loaded from a bare `file://` page (CORS). Served over
> http/https they load fine — so the game looks best from a server or from the
> live GitHub Pages URL. Opened as a bare file it still runs, just with flat
> untextured walls.

> Best played **alone, in the dark, with headphones.** All sound is generated
> live in your browser — there are no audio files, so every whisper is aimed
> at *you*.

---

## What's inside

A full, furnished hospital — not empty boxes:

- **Dressed rooms** — hospital beds & gurneys, wheelchairs, IV stands, morgue
  drawers, operating & autopsy tables, a **large kitchen** (counters, stove &
  hood, prep table), a cafeteria, a chapel with pews and a cross, boilers, the
  glowing **incinerator**, laundry, shelves, lockers, and more — placed per room.
- **Flickering, dying fluorescent lights** that buzz, stutter, and cut out, plus
  random **power-surge blackouts** that drop the whole floor into darkness.
- **More rooms & a bigger footprint** — kitchen, cafeteria, pharmacy, autopsy,
  laundry, extra wards and baths across five wider floors.
- **More of the dead** — the Grey Nurse, Mose Blackburn, the basement Child, the
  incinerator's **Ash**, a fast low **Crawler** out of the kitchen, and a second
  **Night Nurse** working the wards.
- **A deeper soundscape** — dripping water, dragged gurneys, distant screams,
  a child's laughter, electrical buzz, and slamming doors, all synthesized live.

## The real haunting (the game is built on it)

- **The building** — opened 1928 after the original hospital burned in 1926;
  closed 1988. Four floors over an underground basement that held the
  **children's ward, morgue, X-ray, and the incinerator** where unclaimed
  bodies were burned.
- **The Grey Nurse** — died in the ER after a car crash on her way to a shift.
  She never stopped walking her rounds.
- **Mose Blackburn** — in 1962 he shot and killed Lt. Garnet Richmond in a
  downtown gun battle, was guarded on the **third floor**, tore the window
  screen and fell to his death. His shadow still stands in that window, trying
  to set the record straight.
- **The Ash** — what the incinerator made.

## How to survive

- Uncover the night's **four truths** (Nurse, Mose, the Basement, the Bell) to
  lift the chain on the front doors at dawn.
- **FEAR** rises in the dark and near the dead. At 100 your heart gives out.
  Candlelight and calm bring it down.
- The dead **hear** you (sprint, spirit box) and **see** your flashlight beam.
  Sometimes the only way past is in the dark, or hidden in a locker.

## Files

- `index.html` — WebXR VR game shell (+ desktop mode)
- `flat.html` — the original 2D top-down version
- `game.css` — styling
- `assets/textures/` — CC0 hospital textures from Poly Haven (see `assets/CREDITS.txt`)
- `js/vendor/three.min.js` — Three.js r160 (vendored, offline-capable)
- `js/vr-game.js` — 3D world build, WebXR rig, controllers, render loop
- `js/audio.js` — procedural Web Audio horror engine (no external assets)
- `js/world.js` — floor generation, rooms, items, and the true history/lore
- `js/props.js` — furniture & set dressing (beds, morgue drawers, kitchen…)
- `js/entities.js` — the dead, and how they hunt
- `js/game.js` — logic for the 2D version

This is a fan-made, non-commercial tribute. Not affiliated with Sam & Colby,
the XPLR brand, or the Old Hospital on College Hill.
