'use strict';
// Lakalaka player records. Server side only: this module is the one place
// that talks to the Supabase store, with the service role key from the
// environment. The key never reaches the browser; clients read records
// through GET /api/records on this server.
//
// If SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing, every function
// here is a graceful no-op and the game runs exactly as it did before
// records existed.
const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const CACHE_MS = 30000;

let cache = { at: 0, data: null };

function enabled() {
  return Boolean(SUPABASE_URL && SERVICE_KEY);
}

function storeHeaders(extra) {
  return Object.assign({
    apikey: SERVICE_KEY,
    Authorization: 'Bearer ' + SERVICE_KEY,
    'Content-Type': 'application/json'
  }, extra || {});
}

// Save one finished match. Fire and forget by contract: the caller never
// awaits this in the game path, and a failed write only logs one line.
async function recordMatch(match) {
  if (!enabled()) return;
  try {
    const res = await fetch(SUPABASE_URL + '/rest/v1/matches', {
      method: 'POST',
      headers: storeHeaders({ Prefer: 'return=minimal' }),
      body: JSON.stringify({
        room_code: match.room_code,
        player_count: match.player_count,
        winner_name: match.winner_name,
        players: match.players
      })
    });
    if (!res.ok) throw new Error('store answered ' + res.status);
    cache = { at: 0, data: null }; // the newest game should show on the next read
  } catch (err) {
    console.log('records: could not save the match (' + (err && err.message ? err.message : err) + '). The game is unaffected.');
  }
}

async function fetchMatches(limit) {
  const url = SUPABASE_URL + '/rest/v1/matches?select=played_at,room_code,winner_name,player_count,players&order=played_at.desc&limit=' + limit;
  const res = await fetch(url, { headers: storeHeaders() });
  if (!res.ok) throw new Error('store answered ' + res.status);
  const rows = await res.json();
  return Array.isArray(rows) ? rows : [];
}

// Records follow the typed name, exactly as typed (trimmed). No accounts.
function aggregatePlayers(rows) {
  const byName = new Map();
  for (const row of rows) {
    const entries = Array.isArray(row.players) ? row.players : [];
    for (const entry of entries) {
      const name = String((entry && entry.name) || '').trim();
      if (!name) continue;
      let agg = byName.get(name);
      if (!agg) { agg = { name, games: 0, wins: 0, houses: 0 }; byName.set(name, agg); }
      agg.games += 1;
      if (entry.won) agg.wins += 1;
      agg.houses += Number(entry.houses) || 0;
    }
  }
  return [...byName.values()]
    .sort((a, b) => (b.wins - a.wins) || (b.houses - a.houses) || (b.games - a.games) || a.name.localeCompare(b.name))
    .slice(0, 20);
}

async function getRecords() {
  if (!enabled()) return { enabled: false, matches: [], players: [] };
  const now = Date.now();
  if (cache.data && now - cache.at < CACHE_MS) return cache.data;
  try {
    const rows = await fetchMatches(200);
    const data = {
      enabled: true,
      matches: rows.slice(0, 20).map((r) => ({
        played_at: r.played_at,
        room_code: r.room_code,
        winner_name: r.winner_name,
        player_count: r.player_count,
        players: Array.isArray(r.players) ? r.players : []
      })),
      players: aggregatePlayers(rows)
    };
    cache = { at: now, data };
    return data;
  } catch (err) {
    console.log('records: could not load matches (' + (err && err.message ? err.message : err) + ').');
    return cache.data || { enabled: true, matches: [], players: [] };
  }
}

module.exports = { enabled, recordMatch, getRecords };
