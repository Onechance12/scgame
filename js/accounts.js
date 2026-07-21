/* ============================================================================
 * accounts.js — phone + PIN profiles, saved games, and local leaderboards.
 *
 * The game is a static, $0 site (GitHub Pages, no server), so accounts live in
 * this device's localStorage: sign in with a phone number + a short PIN, and the
 * game keeps YOUR saved night and YOUR records (best time survived, nights, wins)
 * separate from anyone else who plays on the same headset. The leaderboard ranks
 * every profile on this device. (A global, cross-device board would need a small
 * backend — the data layer here is shaped so one can be dropped in later.)
 * ==========================================================================*/
const Accounts = (() => {
  const AK = 'collegehill_accounts', CK = 'collegehill_current';

  function load() { try { return JSON.parse(localStorage.getItem(AK)) || {}; } catch (e) { return {}; } }
  function saveAll(a) { try { localStorage.setItem(AK, JSON.stringify(a)); } catch (e) { /* storage full/blocked */ } }
  // a simple non-crypto hash — this is a local PIN gate, not real security
  function hash(pin) { let h = 5381; const s = 'collegehill:' + pin; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return String(h >>> 0); }
  function normPhone(p) { return String(p || '').replace(/\D/g, ''); }
  function maskPhone(p) { p = normPhone(p); return p.length >= 4 ? '•••' + p.slice(-4) : (p || '—'); }
  function emptyRecords() { return { bestTimeSec: 0, nightsSurvived: 0, deaths: 0, wins: 0, ritesCompleted: 0, lastPlayed: 0, totalPlaySec: 0 }; }

  function current() { const p = localStorage.getItem(CK); if (!p) return null; const a = load(); return a[p] ? p : null; }
  function get(phone) { const a = load(); return a[normPhone(phone)] || null; }

  // sign in (existing account: verify PIN) or create (new phone: set PIN)
  function signIn(phone, pin) {
    phone = normPhone(phone);
    if (phone.length < 4) return { ok: false, err: 'Enter a valid phone number.' };
    if (!/^\d{4,8}$/.test(String(pin))) return { ok: false, err: 'PIN must be 4–8 digits.' };
    const a = load(); const acc = a[phone];
    if (acc) { if (acc.pin !== hash(pin)) return { ok: false, err: 'Wrong PIN for that number.' }; }
    else { a[phone] = { pin: hash(pin), created: Date.now(), records: emptyRecords(), save: null }; }
    saveAll(a);
    try { localStorage.setItem(CK, phone); } catch (e) { }
    return { ok: true, phone, isNew: !acc };
  }
  function signOut() { try { localStorage.removeItem(CK); } catch (e) { } }

  function _update(fn) { const p = current(); if (!p) return; const a = load(); if (!a[p]) return; fn(a[p]); a[p].records.lastPlayed = Date.now(); saveAll(a); }

  function records(phone) { const acc = get(phone || current()); return acc ? acc.records : null; }
  function saveGame(s) { const p = current(); if (!p) return false; const a = load(); if (!a[p]) return false; a[p].save = s; saveAll(a); return true; }
  function loadGame() { const acc = get(current()); return acc ? acc.save : null; }
  function clearGame() { _update((acc) => { acc.save = null; }); }

  function recordDeath(timeSec) { _update((acc) => { acc.records.deaths++; if (timeSec > acc.records.bestTimeSec) acc.records.bestTimeSec = timeSec; acc.records.totalPlaySec += timeSec | 0; }); }
  function recordWin(timeSec, rite) { _update((acc) => { acc.records.wins++; acc.records.nightsSurvived++; if (rite) acc.records.ritesCompleted++; if (timeSec > acc.records.bestTimeSec) acc.records.bestTimeSec = timeSec; acc.records.totalPlaySec += timeSec | 0; }); }

  function leaderboard() {
    const a = load();
    return Object.keys(a).map((phone) => {
      const r = a[phone].records || emptyRecords();
      return { phone, mask: maskPhone(phone), best: r.bestTimeSec || 0, nights: r.nightsSurvived || 0, wins: r.wins || 0, deaths: r.deaths || 0 };
    }).sort((x, y) => (y.best - x.best) || (y.nights - x.nights));
  }

  function fmtTime(sec) { sec = Math.max(0, Math.floor(sec)); const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60; return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`; }

  return { signIn, signOut, current, get, records, saveGame, loadGame, clearGame, recordDeath, recordWin, leaderboard, maskPhone, fmtTime };
})();
if (typeof window !== 'undefined') window.Accounts = Accounts;
