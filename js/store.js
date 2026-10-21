/*
 * Browser settings, classroom scores and legacy songs. Private cloud songs stay
 * in memory; authenticated assignments and results live in the Singing API.
 */
import { BUILTIN_SONGS } from './data/songs/index.js';

const KEYS = {
  songs: 'singing.songs.v1',
  settings: 'singing.settings.v1',
  teams: 'singing.teams.v1',
  progress: 'singing.progress.v1',
};

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const v = JSON.parse(raw);
    return v ?? fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------ settings

const DEFAULT_SETTINGS = {
  guide: 'robo',
  showPics: true,
  ball: true,
  translations: true,
  lyricScale: 1,
  backend: 'https://api.pinplay.win',
  ttsVoice: 'en-US-AriaNeural',
  sfx: true,
  speechLang: 'en-US',
  songUploadPermission: false,
};

export function getSettings() {
  return { ...DEFAULT_SETTINGS, ...read(KEYS.settings, {}) };
}

export function setSettings(patch) {
  const next = { ...getSettings(), ...patch };
  write(KEYS.settings, next);
  return next;
}

// --------------------------------------------------------------------- songs

let sharedSong = null; // a song opened from a share link, not saved yet
let cloudSongs = [];
const songListeners = new Set();
export function onSongs(fn) { songListeners.add(fn); return () => songListeners.delete(fn); }
export function setCloudSongs(songs) { cloudSongs = songs; for (const fn of songListeners) fn(); }
export function localUserSongs() {
  const list = read(KEYS.songs, []);
  return Array.isArray(list) ? list : [];
}
export function markMigrated(localId, principalId, cloudId) {
  const migrated = read('singing.migrated.v1', {});
  migrated[localId] = { principalId, cloudId };
  if (!write('singing.migrated.v1', migrated)) throw new Error('Could not record migration. Your cloud copy is safe; retry migration later.');
}

export function userSongs() {
  const migrated = read('singing.migrated.v1', {});
  return [...cloudSongs, ...localUserSongs().filter((s) => !migrated[s.id])];
}

export function allSongs() {
  return [...userSongs().map((s) => ({ ...s, mine: s.mine !== false })), ...BUILTIN_SONGS];
}

export function getSong(id) {
  if (sharedSong && sharedSong.id === id) return sharedSong;
  const migrated = read('singing.migrated.v1', {});
  return allSongs().find((s) => s.id === id || s.id === migrated[id]?.cloudId) || null;
}

export function setSharedSong(song) {
  sharedSong = song;
}

export function saveUserSong(song) {
  if (song.cloud) throw new Error('Save this song to your cloud library.');
  if (song.source === 'audio' || ['audio', 'karaoke', 'vocals', 'sourceFile'].some((role) => song[role]?.mediaId)) throw new Error('Uploaded songs must be saved to your private cloud library. Sign in as a teacher.');
  const list = localUserSongs();
  const clean = { ...song };
  delete clean.mine;
  delete clean.builtin;
  clean.updatedAt = Date.now();
  if (!clean.createdAt) clean.createdAt = clean.updatedAt;
  const i = list.findIndex((s) => s.id === clean.id);
  if (i >= 0) list[i] = clean; else list.unshift(clean);
  if (!write(KEYS.songs, list)) throw new Error('This browser is out of storage space.');
  return clean;
}

export function deleteUserSong(id) {
  write(KEYS.songs, localUserSongs().filter((s) => s.id !== id));
}

export function newSongId(title = 'song') {
  const slug = String(title).toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 32) || 'song';
  return `${slug}-${Math.random().toString(36).slice(2, 7)}`;
}

// --------------------------------------------------------------------- teams

const TEAM_PRESETS = [
  { name: 'Rock Stars', emoji: '🎸', hue: 350 },
  { name: 'Pop Pandas', emoji: '🐼', hue: 200 },
  { name: 'Jazz Cats', emoji: '🐱', hue: 45 },
  { name: 'Disco Dinos', emoji: '🦖', hue: 130 },
  { name: 'Rap Rabbits', emoji: '🐰', hue: 280 },
  { name: 'Opera Owls', emoji: '🦉', hue: 20 },
];

export function teamPresets() {
  return TEAM_PRESETS.map((t) => ({ ...t }));
}

export function getTeams() {
  const t = read(KEYS.teams, null);
  if (t && Array.isArray(t.list)) return t;
  return { on: false, list: TEAM_PRESETS.slice(0, 2).map((p, i) => ({ id: `t${i}`, ...p, score: 0 })), turn: 0 };
}

const teamListeners = new Set();

export function onTeams(fn) {
  teamListeners.add(fn);
  return () => teamListeners.delete(fn);
}

export function setTeams(teams, detail) {
  write(KEYS.teams, teams);
  for (const fn of teamListeners) {
    try { fn(teams, detail); } catch (e) { console.error(e); }
  }
}

export function addPoints(teamId, points) {
  const teams = getTeams();
  const t = teams.list.find((x) => x.id === teamId);
  if (!t) return;
  t.score = Math.max(-999, (t.score || 0) + points);
  setTeams(teams, { bump: teamId, points });
}

export function nextTurn() {
  const teams = getTeams();
  if (!teams.list.length) return null;
  teams.turn = ((teams.turn || 0) + 1) % teams.list.length;
  setTeams(teams, { turn: teams.turn });
  return teams.list[teams.turn];
}

export function currentTeam() {
  const teams = getTeams();
  if (!teams.on || !teams.list.length) return null;
  return teams.list[(teams.turn || 0) % teams.list.length];
}

// ------------------------------------------------------------------ progress

export function getProgress() {
  return read(KEYS.progress, { played: {}, best: {} });
}

export function recordPlay(songId, game, score) {
  const p = getProgress();
  p.played[songId] = (p.played[songId] || 0) + 1;
  p.last = { songId, game, at: Date.now() };
  if (score !== undefined) {
    const k = `${songId}:${game}`;
    if (!(k in p.best) || score > p.best[k]) p.best[k] = score;
  }
  write(KEYS.progress, p);
}

export function bestScore(songId, game) {
  return getProgress().best[`${songId}:${game}`];
}
