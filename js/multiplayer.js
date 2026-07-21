/* ============================================================================
 * multiplayer.js — peer-to-peer co-op: up to 4 investigators in one hospital.
 *
 * The game is a $0 static site, so there is no game server: the HOST's browser
 * IS the server. PeerJS's free public broker handles only the handshake
 * (matching a 4-letter room code to the host); after that, all traffic runs on
 * direct browser-to-browser WebRTC data channels in a star around the host —
 * joiners send state to the host, the host relays everyone to everyone.
 *
 * Design: shared exploration. The hospital layout is seeded, so every copy of
 * the game builds the exact same building — you see your friends walking the
 * same halls as glowing-flashlight investigators. But the dead haunt each
 * player SEPARATELY: your night is still your night. When a friend dies or
 * reaches dawn, everyone is told.
 * ==========================================================================*/
const MP = (() => {
  const MAX = 4;                          // host + 3 joiners
  const PREFIX = 'collegehill-24h-';      // namespaces room codes on the public broker
  const ALPHA = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';  // no 0/O/1/I/L — codes get read aloud

  let peer = null, conns = [], hostConn = null;
  let role = 'off';                       // off | host | join
  let code = '', myName = 'INVESTIGATOR';
  let statusCb = null, eventCb = null;
  let peers = new Map();                  // peer id -> { name, st, at }
  let lastSend = 0;

  function setName(n) { myName = String(n || 'INVESTIGATOR').slice(0, 14); }
  function status(msg, kind) { if (statusCb) statusCb(msg, kind || 'info'); }
  function emit(ev) { if (eventCb) eventCb(ev); }
  function makeCode() { let c = ''; for (let i = 0; i < 4; i++) c += ALPHA[(Math.random() * ALPHA.length) | 0]; return c; }
  function roster() { const r = [{ name: myName, me: true }]; peers.forEach((p) => r.push({ name: p.name })); return r; }

  // ---- host: claim a room code on the broker and wait at the door ----
  function host() {
    leave();
    if (typeof Peer === 'undefined') { status('Multiplayer needs an internet connection.', 'err'); return; }
    role = 'host'; code = makeCode();
    status('Opening the hospital…');
    peer = new Peer(PREFIX + code, { debug: 0 });
    peer.on('open', () => { status('Room open. Share the code — friends pick JOIN and enter it.', 'ok'); emit({ kind: 'roster' }); });
    peer.on('error', (e) => {
      if (e.type === 'unavailable-id' && role === 'host') { try { peer.destroy(); } catch (er) { } role = 'off'; host(); return; }  // code taken — reroll
      status('Connection trouble: ' + e.type, 'err');
    });
    peer.on('connection', (c) => {
      c.on('open', () => {
        if (conns.length >= MAX - 1) { try { c.send({ t: 'full' }); } catch (e) { } setTimeout(() => c.close(), 400); return; }
        conns.push(c);
      });
      wireData(c);
      c.on('close', () => dropConn(c));
      c.on('error', () => dropConn(c));
    });
  }

  function dropConn(c) {
    const i = conns.indexOf(c); if (i >= 0) conns.splice(i, 1);
    const p = peers.get(c.peer);
    if (p) { peers.delete(c.peer); broadcast({ t: 'bye', id: c.peer }, null); emit({ kind: 'leave', name: p.name }); emit({ kind: 'roster' }); }
  }

  // ---- join: dial the host by room code ----
  function join(codeIn) {
    leave();
    if (typeof Peer === 'undefined') { status('Multiplayer needs an internet connection.', 'err'); return; }
    const cd = String(codeIn || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (cd.length !== 4) { status('Codes are 4 letters/numbers.', 'err'); return; }
    role = 'join'; code = cd;
    status('Knocking…');
    peer = new Peer({ debug: 0 });
    peer.on('error', (e) => {
      if (e.type === 'peer-unavailable') { status('No night found with code ' + cd + '.', 'err'); leave(); emit({ kind: 'roster' }); }
      else status('Connection trouble: ' + e.type, 'err');
    });
    peer.on('open', () => {
      hostConn = peer.connect(PREFIX + cd, { serialization: 'json' });
      hostConn.on('open', () => { hostConn.send({ t: 'hi', name: myName }); });
      wireData(hostConn);
      hostConn.on('close', () => {
        if (role === 'join') { status("The host's light went out.", 'err'); leave(); emit({ kind: 'roster' }); }
      });
    });
  }

  // ---- the wire protocol (host relays joiners; joiners talk only to the host) ----
  function wireData(c) {
    c.on('data', (m) => {
      if (!m || typeof m !== 'object') return;
      switch (m.t) {
        case 'hi': {  // (host) a new investigator introduces themselves
          if (conns.indexOf(c) < 0) break;   // was rejected as full
          const nm = String(m.name || '???').slice(0, 14);
          peers.set(c.peer, { name: nm, st: null, at: performance.now() });
          try { c.send({ t: 'welcome', names: roster().map((r) => r.name) }); } catch (e) { }
          broadcast({ t: 'ev', kind: 'join', name: nm }, c);
          emit({ kind: 'join', name: nm }); emit({ kind: 'roster' });
          break;
        }
        case 'welcome':  // (joiner) the host let us in
          status("You're in. The night is shared now.", 'ok'); emit({ kind: 'roster' });
          break;
        case 'full':
          status('That night is full (4 investigators).', 'err'); leave(); emit({ kind: 'roster' });
          break;
        case 's': {  // (host) state from a joiner — keep it and relay to the others
          const p = peers.get(c.peer); if (!p) break;
          p.st = m.st; p.at = performance.now();
          broadcast({ t: 'p', id: c.peer, name: p.name, st: m.st }, c);
          break;
        }
        case 'p': {  // (joiner) someone's state, relayed by the host
          let p = peers.get(m.id);
          if (!p) { p = { name: String(m.name || '???').slice(0, 14), st: null, at: 0 }; peers.set(m.id, p); emit({ kind: 'roster' }); }
          p.st = m.st; p.at = performance.now();
          break;
        }
        case 'bye': {  // (joiner) the host says someone left
          const p = peers.get(m.id);
          if (p) { peers.delete(m.id); emit({ kind: 'leave', name: p.name }); emit({ kind: 'roster' }); }
          break;
        }
        case 'ev':  // deaths, dawns, joins — host relays, everyone hears
          if (role === 'host') broadcast(m, c);
          emit(m);
          break;
      }
    });
  }

  function broadcast(m, except) {
    conns.forEach((c) => { if (c !== except && c.open) { try { c.send(m); } catch (e) { } } });
  }

  // my transform, called every frame but throttled to ~10 Hz on the wire
  function send(st) {
    if (role === 'off') return;
    const t = performance.now(); if (t - lastSend < 100) return; lastSend = t;
    if (role === 'host') broadcast({ t: 'p', id: '@host', name: myName, st }, null);
    else if (hostConn && hostConn.open) { try { hostConn.send({ t: 's', st }); } catch (e) { } }
  }

  // one-shot announcements: {kind:'death', by} | {kind:'win'}
  function event(ev) {
    if (role === 'off') return;
    const m = { t: 'ev', kind: ev.kind, name: myName, by: ev.by || '' };
    if (role === 'host') broadcast(m, null);
    else if (hostConn && hostConn.open) { try { hostConn.send(m); } catch (e) { } }
  }

  function leave() {
    if (peer) { try { peer.destroy(); } catch (e) { } }
    peer = null; conns = []; hostConn = null; peers.clear();
    role = 'off'; code = '';
  }

  return {
    host, join, leave, send, event, setName,
    active: () => role !== 'off', isHost: () => role === 'host',
    code: () => code, peers: () => peers, roster,
    count: () => 1 + peers.size,
    onStatus: (cb) => (statusCb = cb), onEvent: (cb) => (eventCb = cb),
  };
})();
if (typeof window !== 'undefined') window.MP = MP;
