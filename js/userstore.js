// js/userstore.js
// 用户系统的服务端共享模块，仅供 Cloudflare Pages Functions 引用
// （functions/api/user.js、track.js、home.js、admin.js 通过
//  '../../js/userstore.js' 引入；浏览器端没有任何页面加载它）。
//
// KV 模型（绑定名 TV_KV）：
//   tv:users               -> [username...]            用户名索引
//   tv:user:<username>     -> {username, passHash, createdAt, loginCount,
//                              lastLoginAt, lastSeenAt, onlineSec, watchSec,
//                              disabled, prefs:{areas:[], kinds:[]}}
//   tv:session:<token>     -> {username, createdAt}    token 为 32 位随机 hex
//   tv:history:<username>  -> {'<source>:<id>': {source,id,title,poster,
//                              episode,episodeLabel,positionSec,watchedSec,
//                              plays,lastAt}}            最多 200 条
//   tv:hot                 -> {'<source>:<id>': {source,id,title,plays,watchSec}}
//   tv:site                -> 站点设置（与 admin.js 共用，含 allowRegister）
//
// passHash = sha256(password + ':' + username)
// 会话 cookie 名：tv_user（HttpOnly，30 天）

import { sha256 } from './sha256.js';

export { sha256 };

export const SESSION_COOKIE = 'tv_user';
export const SESSION_MAX_AGE = 2592000; // 30 天
export const HISTORY_LIMIT = 200;
export const PREF_AREAS = ['国产', '港台', '日韩', '欧美', '泰国', '其他'];
export const PREF_KINDS = ['电影', '电视剧', '动漫', '综艺'];

// ---------- 基础 KV 读写 ----------

export function hasKv(env) {
    return !!(env && env.TV_KV);
}

export async function readJson(env, key, fallback) {
    if (!hasKv(env)) return fallback;
    try {
        const raw = await env.TV_KV.get(key);
        if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === 'object') return parsed;
        }
    } catch (e) { /* 损坏数据按缺省处理 */ }
    return fallback;
}

export async function writeJson(env, key, value) {
    await env.TV_KV.put(key, JSON.stringify(value));
}

export async function deleteKey(env, key) {
    if (!hasKv(env)) return;
    try { await env.TV_KV.delete(key); } catch (e) { /* 忽略 */ }
}

// ---------- 站点设置（与 admin.js 的 tv:site 同一份） ----------

export async function readSite(env) {
    return readJson(env, 'tv:site', {});
}

// ---------- 用户记录 ----------

export function defaultPrefs() {
    return { areas: [], kinds: [] };
}

export function sanitizePrefs(input) {
    const prefs = defaultPrefs();
    if (input && typeof input === 'object') {
        if (Array.isArray(input.areas)) {
            prefs.areas = input.areas.filter((a) => PREF_AREAS.includes(a));
        }
        if (Array.isArray(input.kinds)) {
            prefs.kinds = input.kinds.filter((k) => PREF_KINDS.includes(k));
        }
    }
    return prefs;
}

export function normalizeUser(raw, username) {
    if (!raw || typeof raw !== 'object' || typeof raw.passHash !== 'string') return null;
    return {
        username: username || raw.username || '',
        passHash: raw.passHash,
        createdAt: Number(raw.createdAt) || 0,
        loginCount: Number(raw.loginCount) || 0,
        lastLoginAt: Number(raw.lastLoginAt) || 0,
        lastSeenAt: Number(raw.lastSeenAt) || 0,
        onlineSec: Number(raw.onlineSec) || 0,
        watchSec: Number(raw.watchSec) || 0,
        disabled: !!raw.disabled,
        prefs: sanitizePrefs(raw.prefs)
    };
}

export async function loadUser(env, username) {
    if (!username) return null;
    const raw = await readJson(env, 'tv:user:' + username, null);
    return normalizeUser(raw, username);
}

export async function saveUser(env, user) {
    await writeJson(env, 'tv:user:' + user.username, user);
}

export async function loadUserIndex(env) {
    const idx = await readJson(env, 'tv:users', []);
    return Array.isArray(idx) ? idx.filter((u) => typeof u === 'string') : [];
}

export async function saveUserIndex(env, list) {
    await writeJson(env, 'tv:users', list);
}

export async function hashUserPassword(password, username) {
    return sha256(String(password) + ':' + String(username));
}

// ---------- 会话 ----------

export function randomToken() {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function sessionCookieHeader(token) {
    return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_MAX_AGE}`;
}

export function clearSessionCookieHeader() {
    return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export async function createSession(env, username) {
    const token = randomToken();
    await writeJson(env, 'tv:session:' + token, { username, createdAt: Date.now() });
    return token;
}

export async function destroySession(env, token) {
    if (token) await deleteKey(env, 'tv:session:' + token);
}

export function readCookie(request, name) {
    const header = (request && request.headers && request.headers.get('Cookie')) || '';
    const parts = header.split(';');
    for (const part of parts) {
        const eq = part.indexOf('=');
        if (eq < 0) continue;
        if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
    }
    return '';
}

// 凭请求 cookie 找当前登录用户。会话存在、用户记录存在且未被禁用才算登录；
// 任一不满足返回 null（被删除/禁用的用户，其旧会话立即失效）。
export async function getSessionUser(env, request) {
    if (!hasKv(env)) return null;
    const token = readCookie(request, SESSION_COOKIE);
    if (!token) return null;
    const session = await readJson(env, 'tv:session:' + token, null);
    if (!session || typeof session.username !== 'string' || !session.username) return null;
    const user = await loadUser(env, session.username);
    if (!user || user.disabled) return null;
    return { token, username: user.username, user };
}

// ---------- 观看历史 / 全站热度 ----------

export async function loadHistory(env, username) {
    const hist = await readJson(env, 'tv:history:' + username, {});
    return hist && typeof hist === 'object' && !Array.isArray(hist) ? hist : {};
}

export async function saveHistory(env, username, hist) {
    // 超过上限时按 lastAt 只保留最新 HISTORY_LIMIT 条
    const keys = Object.keys(hist);
    if (keys.length > HISTORY_LIMIT) {
        keys.sort((a, b) => (hist[b].lastAt || 0) - (hist[a].lastAt || 0));
        const trimmed = {};
        keys.slice(0, HISTORY_LIMIT).forEach((k) => { trimmed[k] = hist[k]; });
        hist = trimmed;
    }
    await writeJson(env, 'tv:history:' + username, hist);
}

export async function loadHot(env) {
    const hot = await readJson(env, 'tv:hot', {});
    return hot && typeof hot === 'object' && !Array.isArray(hot) ? hot : {};
}

export async function saveHot(env, hot) {
    // 粗略维护：条目过多时只留 plays（其次 watchSec）靠前的 50 条
    const keys = Object.keys(hot);
    if (keys.length > 80) {
        keys.sort((a, b) => ((hot[b].plays || 0) - (hot[a].plays || 0)) || ((hot[b].watchSec || 0) - (hot[a].watchSec || 0)));
        const trimmed = {};
        keys.slice(0, 50).forEach((k) => { trimmed[k] = hot[k]; });
        hot = trimmed;
    }
    await writeJson(env, 'tv:hot', hot);
}

// 把一次播放事件合并进 history / hot 条目（play-start 与 flush 共用）。
// play: {source,id,title,poster,episode,episodeLabel,positionSec}
// 返回是否真的更新了（source/id 缺失时不更新）。
export function applyPlay(hist, hot, play, opts) {
    if (!play || !play.source || play.id === undefined || play.id === null || String(play.id) === '') {
        return false;
    }
    const source = String(play.source);
    const id = String(play.id);
    const key = source + ':' + id;
    const now = (opts && opts.now) || Date.now();

    const entry = hist[key] || {
        source, id, title: '', poster: '',
        episode: 0, episodeLabel: '', positionSec: 0, watchedSec: 0, plays: 0, lastAt: 0
    };
    if (play.title) entry.title = String(play.title);
    if (play.poster) entry.poster = String(play.poster);
    if (play.episode !== undefined && play.episode !== null && play.episode !== '') {
        const ep = Number(play.episode);
        if (!Number.isNaN(ep)) entry.episode = ep;
    }
    if (play.episodeLabel) entry.episodeLabel = String(play.episodeLabel);
    if (opts && opts.isStart) entry.plays = (entry.plays || 0) + 1;
    if (opts && typeof opts.watchDeltaSec === 'number' && opts.watchDeltaSec > 0) {
        entry.watchedSec = (entry.watchedSec || 0) + opts.watchDeltaSec;
    }
    if (play.positionSec !== undefined && play.positionSec !== null) {
        const pos = Number(play.positionSec);
        if (!Number.isNaN(pos) && pos >= 0) entry.positionSec = pos;
    }
    entry.lastAt = now;
    hist[key] = entry;

    if (hot) {
        const h = hot[key] || { source, id, title: entry.title || '', plays: 0, watchSec: 0 };
        if (entry.title) h.title = entry.title;
        if (opts && opts.isStart) h.plays = (h.plays || 0) + 1;
        if (opts && typeof opts.watchDeltaSec === 'number' && opts.watchDeltaSec > 0) {
            h.watchSec = (h.watchSec || 0) + opts.watchDeltaSec;
        }
        hot[key] = h;
    }
    return true;
}

// history 对象转数组，按 lastAt 倒序
export function historyToArray(hist, limit) {
    const arr = Object.values(hist || {});
    arr.sort((a, b) => (b.lastAt || 0) - (a.lastAt || 0));
    return typeof limit === 'number' ? arr.slice(0, limit) : arr;
}
