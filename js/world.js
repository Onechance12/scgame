/* ============================================================================
 * world.js — The Old Hospital on College Hill.
 * Five levels (Basement, 1st, 2nd, 3rd, 4th) built from a deterministic
 * room-off-a-corridor generator, decorated with real rooms, items, lore,
 * and objectives drawn from the true history of the building.
 * ==========================================================================*/

const TILE = {
  VOID: 0,   // outside / black, impassable
  FLOOR: 1,
  WALL: 2,
  DOOR: 3,
  LOCKED: 4, // needs a key
  UP: 5,     // stairs up
  DOWN: 6,   // stairs down
  HIDE: 7,   // locker / bed you can hide in
  CANDLE: 8, // safe light — lowers fear, entities avoid briefly
  EXIT: 9,   // the chained front doors (opens at dawn once objectives done)
};

const World = (() => {
  const W = 48, H = 32;      // tiles per floor
  const CORR_TOP = 14, CORR_BOT = 17; // main corridor band (rows)

  // --- deterministic RNG so the hospital is the same every night ---
  let seed = 90210;
  function rnd() {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  }
  function reseed(s) { seed = s; }

  function blankGrid() {
    const g = [];
    for (let y = 0; y < H; y++) g.push(new Array(W).fill(TILE.VOID));
    return g;
  }

  function carveRoom(g, x, y, w, h) {
    for (let j = y; j < y + h; j++) {
      for (let i = x; i < x + w; i++) {
        if (i < 0 || j < 0 || i >= W || j >= H) continue;
        const edge = (i === x || i === x + w - 1 || j === y || j === y + h - 1);
        g[j][i] = edge ? TILE.WALL : TILE.FLOOR;
      }
    }
  }

  /* Build a floor: a horizontal corridor spanning the middle, with rooms
   * hanging above and below, each connected by a door into the corridor.
   * `spec.rooms` is an ordered list: {name, side:'top'|'bot', units, tag}
   * Returns {grid, rooms:[{name,tag,x,y,w,h,cx,cy,doorX,doorY}], name}. */
  function makeFloor(spec) {
    const g = blankGrid();

    // corridor
    for (let y = CORR_TOP; y <= CORR_BOT; y++) {
      for (let x = 2; x < W - 2; x++) g[y][x] = TILE.FLOOR;
    }
    // corridor walls (top & bottom edges of the corridor band)
    for (let x = 1; x < W - 1; x++) {
      g[CORR_TOP - 1][x] = TILE.WALL;
      g[CORR_BOT + 1][x] = TILE.WALL;
    }
    g[CORR_TOP][1] = TILE.WALL; g[CORR_BOT][1] = TILE.WALL;
    g[CORR_TOP][W - 2] = TILE.WALL; g[CORR_BOT][W - 2] = TILE.WALL;

    const rooms = [];
    const totalUnits = spec.rooms.reduce((a, r) => a + (r.units || 1), 0);
    const usable = W - 6;
    let cursorTop = 3, cursorBot = 3;
    const perUnit = Math.floor(usable / Math.max(totalUnits, 1));

    spec.rooms.forEach((r) => {
      const units = r.units || 1;
      const w = Math.max(6, perUnit * units - 1);
      const top = r.side === 'top';
      let x;
      if (top) { x = cursorTop; cursorTop += w + 1; }
      else { x = cursorBot; cursorBot += w + 1; }
      if (x + w > W - 3) return; // ran out of room, skip
      const h = top ? (CORR_TOP - 1) - 3 : (H - 3) - (CORR_BOT + 2);
      const y = top ? 3 : CORR_BOT + 2;
      if (h < 4) return;
      carveRoom(g, x, y, w, h);

      // door into corridor
      const doorX = x + Math.floor(w / 2);
      const doorY = top ? y + h - 1 : y;
      g[doorY][doorX] = r.locked ? TILE.LOCKED : TILE.DOOR;
      // connect the door tile to the corridor floor with a stub
      if (top) { g[doorY + 1] = g[doorY + 1] || g[doorY + 1]; g[CORR_TOP - 1][doorX] = TILE.DOOR; }
      else { g[CORR_BOT + 1][doorX] = TILE.DOOR; }

      rooms.push({
        name: r.name, tag: r.tag || r.name, locked: !!r.locked,
        x, y, w, h, cx: x + Math.floor(w / 2), cy: y + Math.floor(h / 2),
        doorX, doorY,
      });
    });

    // stairwells at both ends of the corridor
    // left stair
    g[CORR_TOP][2] = spec.hasDown ? TILE.DOWN : TILE.FLOOR;
    g[CORR_BOT][2] = spec.hasUp ? TILE.UP : TILE.FLOOR;
    // right stair (mirror) — put UP on right-top, DOWN on right-bottom for variety
    g[CORR_TOP][W - 3] = spec.hasUp ? TILE.UP : TILE.FLOOR;
    g[CORR_BOT][W - 3] = spec.hasDown ? TILE.DOWN : TILE.FLOOR;

    return { grid: g, rooms, name: spec.name, subtitle: spec.subtitle };
  }

  // ---- Floor definitions (top = 0-index basement .. 4th floor) ----
  // Player starts on floor index 1 (Ground / 1st floor lobby).
  const floorSpecs = [
    { // 0 : BASEMENT
      name: 'BASEMENT', subtitle: 'children’s ward · morgue · X-ray · the incinerator',
      hasUp: true, hasDown: false,
      rooms: [
        { name: 'Children’s Ward', side: 'top', units: 3, tag: 'nursery' },
        { name: 'X-Ray', side: 'top', units: 2, tag: 'xray' },
        { name: 'Cold Storage', side: 'top', units: 2, tag: 'storage' },
        { name: 'The Morgue', side: 'bot', units: 3, tag: 'morgue' },
        { name: 'Incinerator', side: 'bot', units: 2, tag: 'incinerator', locked: true },
        { name: 'Boiler', side: 'bot', units: 2, tag: 'boiler' },
      ],
    },
    { // 1 : FIRST FLOOR (start)
      name: 'FIRST FLOOR', subtitle: 'lobby · emergency room · admitting',
      hasUp: true, hasDown: true,
      rooms: [
        { name: 'Front Lobby', side: 'top', units: 3, tag: 'lobby' },
        { name: 'Admitting', side: 'top', units: 2, tag: 'admitting' },
        { name: 'Records', side: 'top', units: 2, tag: 'records' },
        { name: 'Emergency Room', side: 'bot', units: 4, tag: 'er' },
        { name: 'Waiting', side: 'bot', units: 3, tag: 'waiting' },
      ],
    },
    { // 2 : SECOND FLOOR
      name: 'SECOND FLOOR', subtitle: 'patient wing · nurses’ station',
      hasUp: true, hasDown: true,
      rooms: [
        { name: 'Ward 2-A', side: 'top', units: 2, tag: 'ward' },
        { name: 'Ward 2-B', side: 'top', units: 2, tag: 'ward' },
        { name: 'Nurses’ Station', side: 'top', units: 2, tag: 'station' },
        { name: 'Patient 207', side: 'bot', units: 2, tag: 'room207' },
        { name: 'Linen', side: 'bot', units: 1, tag: 'linen' },
        { name: 'Ward 2-C', side: 'bot', units: 3, tag: 'ward' },
      ],
    },
    { // 3 : THIRD FLOOR (Mose Blackburn)
      name: 'THIRD FLOOR', subtitle: 'surgery · the guarded room · the window',
      hasUp: true, hasDown: true,
      rooms: [
        { name: 'Operating Room', side: 'top', units: 3, tag: 'surgery' },
        { name: 'Recovery', side: 'top', units: 2, tag: 'recovery' },
        { name: 'Room 3-East', side: 'top', units: 2, tag: 'mose', locked: true },
        { name: 'Supply', side: 'bot', units: 2, tag: 'supply' },
        { name: 'Isolation', side: 'bot', units: 2, tag: 'iso' },
        { name: 'Stair Landing', side: 'bot', units: 3, tag: 'landing' },
      ],
    },
    { // 4 : FOURTH FLOOR (nurses' quarters / chapel)
      name: 'FOURTH FLOOR', subtitle: 'nurses’ quarters · chapel · the roof door',
      hasUp: false, hasDown: true,
      rooms: [
        { name: 'Nurses’ Quarters', side: 'top', units: 3, tag: 'quarters' },
        { name: 'Matron’s Office', side: 'top', units: 2, tag: 'matron' },
        { name: 'Chapel', side: 'bot', units: 3, tag: 'chapel' },
        { name: 'Bell Room', side: 'bot', units: 2, tag: 'bell' },
        { name: 'Roof Access', side: 'bot', units: 2, tag: 'roof', locked: true },
      ],
    },
  ];

  // ---- Lore fragments the player can find (spirit box + documents) ----
  // Each is grounded in the real history of the hospital.
  const LORE = {
    intro: [
      "1926. The hospital downtown burns. Williamson needs another.",
      "March 3rd, 1928 — the new hospital opens on College Hill.",
      "Four floors. And below them, a basement no one talks about.",
      "It closed in 1988. The lights went out. Not everyone left.",
    ],
    nurse: [
      "SPIRIT BOX: … late … I was going to be late for my shift …",
      "SPIRIT BOX: … the road … the other car … headlights …",
      "SPIRIT BOX: … they brought me into my own emergency room …",
      "SPIRIT BOX: … I still have rounds … the patients still need me …",
      "GREY NURSE: Follow the rules of the ward, and I will not touch you.",
    ],
    mose: [
      "CLIPPING, 1962: Two officers responded to a fight outside a restaurant.",
      "CLIPPING: Ora and Mose Blackburn were arguing. Then gunfire.",
      "CLIPPING: Lt. Garnet Richmond was shot below the left eye. He died here.",
      "CLIPPING: Blackburn, wounded in the arm, was guarded on the third floor.",
      "CLIPPING: He tore the window screen. He went out the third-story window.",
      "SPIRIT BOX: … they said I jumped … I did not jump … set it right …",
    ],
    basement: [
      "LEDGER: Children’s ward. Morgue. X-ray. All of it — down here.",
      "LEDGER: Unclaimed remains were burned in the incinerator.",
      "LEDGER: Sometimes not just remains. Whole bodies no one came for.",
      "SPIRIT BOX (child): … cold … will you stay with me … don’t go up …",
      "THE ASH: everything the fire took, it kept. it is awake now.",
    ],
    ending_good: [
      "6:00 AM. Grey light in the windows. The chain on the front doors falls.",
      "The Nurse stands aside. Her rounds are done. So are yours.",
      "You walk out of the Old Hospital on College Hill. It watches you go.",
    ],
    ending_bad: [
      "Your heart could not carry it any further.",
      "The building has thousands of names in its ledger.",
      "Now it has one more.",
    ],
  };

  // Build all floors + place items/objectives deterministically.
  function build() {
    reseed(90210);
    const floors = floorSpecs.map(makeFloor);

    // Helper to find a room by tag on a floor
    const findRoom = (fi, tag) => floors[fi].rooms.find((r) => r.tag === tag);

    // ---------- ITEMS ----------
    // {floor, x, y, type, id, taken}
    const items = [];
    const addItem = (fi, tag, type, id, dx = 0, dy = 0) => {
      const r = findRoom(fi, tag);
      if (!r) return;
      items.push({ floor: fi, x: r.cx + dx, y: r.cy + dy, type, id, taken: false });
    };

    // Ghost-hunting kit + survival supplies scattered around
    addItem(1, 'lobby', 'flashlight', 'flashlight');       // grab first
    addItem(1, 'admitting', 'battery', 'bat1', 1, 0);
    addItem(1, 'waiting', 'emf', 'emf');
    addItem(1, 'records', 'spiritbox', 'spiritbox');
    addItem(2, 'linen', 'battery', 'bat2');
    addItem(2, 'station', 'candlekit', 'candles1');
    addItem(3, 'supply', 'battery', 'bat3');
    addItem(3, 'recovery', 'battery', 'bat4', -1, 0);
    addItem(0, 'storage', 'battery', 'bat5');
    addItem(4, 'quarters', 'battery', 'bat6');

    // Keys — each unlocks a specific locked room/objective
    addItem(2, 'room207', 'key', 'key_incinerator');   // basement incinerator
    addItem(1, 'records', 'key', 'key_mose', 1, 1);    // Mose's room (3-East)
    addItem(4, 'chapel', 'key', 'key_roof');           // roof access (final)

    // ---------- OBJECTIVES ----------
    // The night's story beats. Complete all 4 "truths" to lift the chain at dawn.
    const objectives = [
      {
        id: 'nurse', title: 'Walk the Nurse’s last round',
        hint: 'The Emergency Room, 1st floor. Bring the spirit box.',
        floor: 1, tag: 'er', type: 'spiritbox', done: false, lore: 'nurse',
      },
      {
        id: 'mose', title: 'Let Mose set the record straight',
        hint: 'Room 3-East is locked. Find its key, then use the spirit box.',
        floor: 3, tag: 'mose', type: 'spiritbox', done: false, lore: 'mose',
        needsKey: 'key_mose',
      },
      {
        id: 'basement', title: 'Read what the basement burned',
        hint: 'The Morgue ledger, then survive the incinerator.',
        floor: 0, tag: 'morgue', type: 'document', done: false, lore: 'basement',
      },
      {
        id: 'roof', title: 'Ring the bell at dawn',
        hint: 'Bell Room, 4th floor. Only after the other three truths.',
        floor: 4, tag: 'bell', type: 'bell', done: false, lore: 'ending_good',
        requiresAll: true,
      },
    ];

    // Place a few candle "safe lights" in the world for fear relief.
    floors.forEach((f, fi) => {
      // one candle per floor near a stairwell corridor
      f.grid[CORR_TOP][4] = TILE.CANDLE;
      f.grid[CORR_BOT][W - 5] = TILE.CANDLE;
    });
    // Hide spots inside select rooms (lockers/beds)
    const hideRooms = [
      [1, 'admitting'], [1, 'er'], [2, 'ward'], [2, 'room207'],
      [3, 'recovery'], [3, 'iso'], [0, 'storage'], [0, 'morgue'],
      [4, 'quarters'],
    ];
    hideRooms.forEach(([fi, tag]) => {
      const r = findRoom(fi, tag);
      if (r) floors[fi].grid[r.y + 1][r.x + 1] = TILE.HIDE;
    });

    // Exit doors are the front lobby of floor 1.
    (() => {
      const r = findRoom(1, 'lobby');
      if (r) floors[1].grid[r.y + 1][r.cx] = TILE.EXIT;
    })();

    return { floors, items, objectives, LORE, TILE, W, H, CORR_TOP, CORR_BOT };
  }

  // Spawn point: 1st floor lobby
  function spawn(data) {
    const r = data.floors[1].rooms.find((rr) => rr.tag === 'lobby');
    return { floor: 1, x: r.cx, y: r.cy };
  }

  return { build, spawn, TILE, W, H };
})();
