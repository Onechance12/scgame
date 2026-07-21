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
  const W = 64, H = 32;      // tiles per floor (wider — more & bigger rooms)
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
    const topUnits = spec.rooms.filter((r) => r.side === 'top').reduce((a, r) => a + (r.units || 1), 0);
    const botUnits = spec.rooms.filter((r) => r.side !== 'top').reduce((a, r) => a + (r.units || 1), 0);
    const usable = W - 6;
    let cursorTop = 3, cursorBot = 3;
    // size columns to the busier side so rooms fill the floor without overflow
    const perUnit = Math.floor(usable / Math.max(topUnits, botUnits, 1));

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
      name: 'BASEMENT', subtitle: 'children’s ward · morgue · autopsy · the incinerator',
      hasUp: true, hasDown: false,
      rooms: [
        { name: 'Children’s Ward', side: 'top', units: 3, tag: 'nursery' },
        { name: 'X-Ray', side: 'top', units: 2, tag: 'xray' },
        { name: 'Cold Storage', side: 'top', units: 2, tag: 'storage' },
        { name: 'Autopsy', side: 'top', units: 2, tag: 'autopsy' },
        { name: 'The Morgue', side: 'bot', units: 3, tag: 'morgue' },
        { name: 'Incinerator', side: 'bot', units: 2, tag: 'incinerator', locked: true },
        { name: 'Boiler Room', side: 'bot', units: 2, tag: 'boiler' },
        { name: 'Ritual Chamber', side: 'bot', units: 2, tag: 'ritual' },
        { name: 'Laundry', side: 'bot', units: 2, tag: 'laundry' },
      ],
    },
    { // 1 : FIRST FLOOR (start)
      name: 'FIRST FLOOR', subtitle: 'lobby · emergency room · kitchen · cafeteria',
      hasUp: true, hasDown: true,
      rooms: [
        { name: 'Front Lobby', side: 'top', units: 3, tag: 'lobby' },
        { name: 'Admitting', side: 'top', units: 2, tag: 'admitting' },
        { name: 'Records', side: 'top', units: 2, tag: 'records' },
        { name: 'Pharmacy', side: 'top', units: 2, tag: 'pharmacy' },
        { name: 'Emergency Room', side: 'bot', units: 4, tag: 'er' },
        { name: 'Waiting', side: 'bot', units: 2, tag: 'waiting' },
        { name: 'Kitchen', side: 'bot', units: 3, tag: 'kitchen' },
        { name: 'Cafeteria', side: 'bot', units: 2, tag: 'cafeteria' },
      ],
    },
    { // 2 : SECOND FLOOR
      name: 'SECOND FLOOR', subtitle: 'patient wing · nurses’ station · the baths',
      hasUp: true, hasDown: true,
      rooms: [
        { name: 'Ward 2-A', side: 'top', units: 2, tag: 'ward' },
        { name: 'Ward 2-B', side: 'top', units: 2, tag: 'ward' },
        { name: 'Nurses’ Station', side: 'top', units: 2, tag: 'station' },
        { name: 'Maternity', side: 'top', units: 3, tag: 'maternity' },
        { name: 'Patient 207', side: 'bot', units: 2, tag: 'room207' },
        { name: 'Linen', side: 'bot', units: 1, tag: 'linen' },
        { name: 'Ward 2-C', side: 'bot', units: 3, tag: 'ward' },
        { name: 'Bathrooms', side: 'bot', units: 2, tag: 'bath' },
      ],
    },
    { // 3 : THIRD FLOOR (Mose Blackburn)
      name: 'THIRD FLOOR', subtitle: 'surgery · the guarded room · the window',
      hasUp: true, hasDown: true,
      rooms: [
        { name: 'Operating Room', side: 'top', units: 3, tag: 'surgery' },
        { name: 'Recovery', side: 'top', units: 2, tag: 'recovery' },
        { name: 'Room 3-East', side: 'top', units: 2, tag: 'mose', locked: true },
        { name: 'Prep', side: 'top', units: 2, tag: 'prep' },
        { name: 'Supply', side: 'bot', units: 2, tag: 'supply' },
        { name: 'Isolation', side: 'bot', units: 2, tag: 'iso' },
        { name: 'Stair Landing', side: 'bot', units: 2, tag: 'landing' },
        { name: 'Ward 3-B', side: 'bot', units: 2, tag: 'ward' },
      ],
    },
    { // 4 : FOURTH FLOOR (nurses' quarters / chapel)
      name: 'FOURTH FLOOR', subtitle: 'nurses’ quarters · chapel · the roof door',
      hasUp: false, hasDown: true,
      rooms: [
        { name: 'Nurses’ Quarters', side: 'top', units: 2, tag: 'quarters' },
        { name: 'Matron’s Office', side: 'top', units: 2, tag: 'matron' },
        { name: 'The Sanctum', side: 'top', units: 2, tag: 'sanctum', locked: true },
        { name: 'Attic Records', side: 'top', units: 2, tag: 'attic' },
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
    ritual: [
      "The five candles catch. The circle closes. The air goes to ice.",
      "SPIRIT BOX: … you read the words … you opened the door …",
      "MATRON: We bound them so the hospital would never empty.",
      "MATRON: Say the last line and you unbind what we caged.",
      "The children stop crying. For the first time in decades, they are free.",
      "Something older, though, was caged in here with them. It is not.",
    ],
    unbinding: [
      "You swing the censer. Smoke coils out into the cold circle.",
      "ADA: … my rounds are over … oh, thank God, my rounds are over …",
      "MOSE: … somebody finally heard me … I did not jump … I can go …",
      "THE CHILDREN: … we can go home now? … we can really go home …",
      "THE ASH: what the fire took, the fire returns. it lets go last.",
      "The Binding breaks. Every soul the hospital caged comes loose at once.",
    ],
    ending_true: [
      "There is no dawn to wait for. You did not just survive the night —",
      "you emptied the Old Hospital on College Hill. Truly emptied it.",
      "Ada finishes her round and sets down her cap. Mose opens the window",
      "and simply steps through it into the dark, and is gone. The children",
      "carry their music box up the stairs, laughing, and do not come back.",
      "The chain on the front doors falls on its own. The building lets you",
      "leave — lighter than it has been in a hundred years. And so are you.",
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

    // ---------- survival economy (see js/survival.js) ----------
    // Quiet Draughts — 5 real minutes of peace each
    addItem(1, 'pharmacy', 'draught', 'dr1');
    addItem(1, 'kitchen', 'draught', 'dr2', 1, 1);
    addItem(2, 'station', 'draught', 'dr3', -1, 0);
    addItem(0, 'morgue', 'draught', 'dr4', 1, -1);
    // the backup lantern + extra batteries
    addItem(4, 'chapel', 'lantern', 'lantern', 1, -1);
    addItem(1, 'kitchen', 'battery', 'bat7', -1, 0);
    addItem(2, 'bath', 'battery', 'bat8');
    // the orderly's backpack + medkits
    addItem(0, 'storage', 'backpack', 'backpack', -1, 0);
    addItem(1, 'er', 'medkit', 'mk1', -1, 1);
    addItem(3, 'supply', 'medkit', 'mk2', 1, 0);
    // the seven teddy bears (the children's blessing)
    addItem(0, 'nursery', 'teddy', 'teddy1', -2, 0);
    addItem(1, 'waiting', 'teddy', 'teddy2', 1, 0);
    addItem(2, 'ward', 'teddy', 'teddy3', 1, 1);
    addItem(2, 'maternity', 'teddy', 'teddy4', -1, 1);
    addItem(3, 'iso', 'teddy', 'teddy5');
    addItem(0, 'laundry', 'teddy', 'teddy6', 1, 0);
    addItem(4, 'chapel', 'teddy', 'teddy7', -1, 1);

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

    // ---------- STORY DOCUMENTS (the mystery to investigate) ----------
    // {floor,x,y,id,type,title,body[],found}
    const documents = [];
    const addDoc = (fi, tag, id, type, title, body, dx = 0, dy = 0) => {
      const r = findRoom(fi, tag);
      if (!r) return;
      documents.push({ floor: fi, x: r.cx + dx, y: r.cy + dy, id, type, title, body, found: false });
    };
    addDoc(1, 'lobby', 'doc_fire', 'clipping', 'Mingo Republican — Nov. 1926', [
      'FIRE GUTS CITY HOSPITAL. Three lost in the night ward before the',
      'trucks arrived. Williamson is left without a hospital. A new one is',
      'already pledged — up on College Hill, above the flood line.',
    ], -1, 0);
    addDoc(1, 'admitting', 'doc_dedication', 'clipping', 'Dedication Program — March 3, 1928', [
      'THE NEW HOSPITAL ON COLLEGE HILL OPENS ITS DOORS.',
      'Four floors of the most modern care in Appalachia — and beneath',
      'them, a basement for the work the public need not see.',
    ]);
    addDoc(2, 'station', 'doc_nurse_letter', 'letter', 'Letter — Nurse Ada Coyle', [
      'Dear Mother — the night shift is long but the patients are kind.',
      'I am always running late; the road down the hill is wicked in rain.',
      'One day it will be the end of me. Ha. Kiss Bess for me. — Ada',
      '(dated the morning of her accident, 1953)',
    ]);
    addDoc(1, 'er', 'doc_admission', 'file', 'ER Admission Log — 1953', [
      'ADMITTED: Coyle, Ada — staff. MVA on College Hill Road.',
      'Brought into the room she worked in. Pronounced at 6:14 AM.',
      'Note in margin, another hand: "She never clocked out."',
    ], 1, 0);
    addDoc(1, 'records', 'doc_police', 'report', 'Police Report — 1962', [
      'Officers responded to a disturbance outside a downtown restaurant.',
      'Suspect M. BLACKBURN exchanged fire; Lt. G. RICHMOND struck fatally.',
      'Blackburn wounded, admitted under guard, third floor, Room 3-East.',
    ]);
    addDoc(3, 'mose', 'doc_mose_note', 'letter', 'Scrap of Paper — Room 3-East', [
      'they keep saying I jumped. I did not jump. two men were in the room',
      'and then the window was open and then I was falling.',
      'tell Ora. tell somebody. I did not jump. — M.B.',
    ]);
    addDoc(0, 'nursery', 'doc_ward', 'file', 'Children’s Ward Register — Winter 1937', [
      'Fever swept the ward. Eleven cots, eleven names, all struck through.',
      'Parents were turned away at the stair; contagion, they were told.',
      'The little ones were carried down, not up. Down to the basement.',
    ]);
    addDoc(0, 'boiler', 'doc_incin', 'file', 'Incinerator Log', [
      'Unclaimed remains, per county contract, reduced Tuesdays.',
      'Entries in a shaking hand grow vaguer: "materials," "effects," "the small ones."',
      'Last line: "It does not stay burned. Do not go down alone."',
    ]);
    addDoc(4, 'matron', 'doc_diary', 'diary', 'Matron’s Diary — 1953', [
      'The dead will not leave. Ada walks her rounds; the children cry below.',
      'The night staff have begun a working — candles, a circle, the old words —',
      'to BIND them here, so the beds are never truly empty and the ward survives.',
      'God forgive us. We caged them. And we caged something else with them.',
    ]);
    addDoc(0, 'ritual', 'doc_ritual', 'diary', 'The Unbinding — Instructions', [
      'The Binding took an anchor from each soul we caged, and sealed them here.',
      'To UNDO it, carry each anchor back to its pedestal in the circle:',
      '  — the Nurse’s cap, the man’s window-latch, the children’s music box,',
      '    and the urn of the unclaimed. Four pedestals. Four anchors.',
      'Then swing the Matron’s censer over the altar and let them all go at once.',
      'Warning: the circle holds more than the children. Something older waits under.',
    ]);
    addDoc(2, 'maternity', 'doc_crayon', 'letter', 'Crayon Drawing', [
      'A child’s drawing: stick figures in beds, a tall grey nurse over them.',
      'Scrawled at the bottom in red crayon, pressed hard enough to tear:',
      '"THEY WONT LET US GO HOME."',
    ]);
    addDoc(4, 'attic', 'doc_closing', 'letter', 'Final Memo — 1988', [
      'We are closing College Hill for good. The new hospital is open up the road.',
      'Do not disturb the basement. Do not relight the candles.',
      'Some doors are locked from the inside for a reason. — Administrator',
    ]);

    // ---------- THE UNBINDING RITE (multi-step end-game build) ----------
    // Four Spirit Anchors, each hidden with one of the dead and GATED behind that
    // spirit's truth (so you must investigate first). Gather all four + the
    // Matron's Censer, carry them to the basement altar, seat each anchor on its
    // pedestal, then perform the Rite to set every spirit free — the true ending.
    const RITE = {
      anchors: [
        { key: 'ada',   item: 'anchor_ada',   floor: 1, room: 'er',      name: 'Ada’s Blood-Stained Cap',
          gate: { obj: 'nurse' },    gateHint: 'Walk the Nurse’s last round first — she won’t give it up until she’s heard.',
          took: 'Ada’s nurse cap, stiff and brown. She stops mid-round to watch you take it.' },
        { key: 'mose',  item: 'anchor_mose',  floor: 3, room: 'mose',    name: 'Mose’s Window Latch',
          gate: { obj: 'mose' },     gateHint: 'Let Mose set the record straight first — the latch won’t turn until he’s believed.',
          took: 'The latch from the window he swore he never jumped out of. It is bent from the inside.' },
        { key: 'child', item: 'anchor_child', floor: 0, room: 'nursery', name: 'The Ward’s Music Box',
          gate: { blessed: true },   gateHint: 'The children won’t part with it. Find all seven teddy bears — earn their blessing first.',
          took: 'The children’s music box. Seven small voices hum along as it comes loose in your hands.' },
        { key: 'ash',   item: 'anchor_ash',   floor: 0, room: 'boiler',  name: 'The Unclaimed Urn',
          gate: { obj: 'basement' }, gateHint: 'Read what the basement burned first — the urn is fused to the grate until then.',
          took: 'An urn of ash the incinerator would never finish. It is still warm.' },
      ],
      censer: { item: 'censer', floor: 4, room: 'matron', name: 'The Matron’s Censer' },
    };
    // place the anchor items + the censer in the world (gated at pickup)
    RITE.anchors.forEach((a) => {
      const r = findRoom(a.floor, a.room);
      if (r) items.push({ floor: a.floor, x: r.cx, y: r.cy - 1, type: 'anchor', id: a.item, anchor: a.key, rite: true, gate: a.gate, taken: false });
    });
    (() => { const r = findRoom(RITE.censer.floor, RITE.censer.room);
      if (r) items.push({ floor: RITE.censer.floor, x: r.cx + 1, y: r.cy, type: 'censer', id: RITE.censer.item, rite: true, taken: false }); })();

    // ---------- RITUAL config (basement Ritual Chamber) ----------
    // Four pedestals in a ring — one per Spirit Anchor — around the central altar.
    const rr = findRoom(0, 'ritual');
    const ritual = rr ? {
      floor: 0, cx: rr.cx, cy: rr.cy, done: false,
      nodes: RITE.anchors.map((a, i) => {
        const ang = -Math.PI / 2 + (i / RITE.anchors.length) * Math.PI * 2;
        return { dx: Math.cos(ang) * 2.0, dy: Math.sin(ang) * 1.5, anchor: a.key, name: a.name, filled: false };
      }),
    } : null;

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

    return { floors, items, objectives, documents, ritual, rite: RITE, LORE, TILE, W, H, CORR_TOP, CORR_BOT };
  }

  // Spawn point: 1st floor lobby
  function spawn(data) {
    const r = data.floors[1].rooms.find((rr) => rr.tag === 'lobby');
    return { floor: 1, x: r.cx, y: r.cy };
  }

  return { build, spawn, TILE, W, H };
})();
if (typeof window !== 'undefined') window.World = World;
