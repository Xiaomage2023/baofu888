// functions/api/user.js
// 站点用户账号接口（Cloudflare Pages Function）。
// POST JSON 按 action 分发：register / login / logout / setPrefs / changePassword
// GET：me（凭 tv_user cookie 返回登录状态、定制、统计与观看历史）
//
// KV 模型见 js/userstore.js。没有绑定 KV 时返回
// {ok:false, error:'KV_NOT_BOUND'} 并附中文说明；站点其他功能不受影响。

import {
    hasKv, readSite, loadUser, saveUser, loadUserIndex, saveUserIndex,
    hashUserPassword, createSession, destroySession, readCookie,
    SESSION_COOKIE, sessionCookieHeader, clearSessionCookieHeader,
    getSessionUser, loadHistory, historyToArray, sanitizePrefs
} from '../../js/userstore.js';

const KV_NOT_BOUND_MESSAGE = '尚未绑定 KV 命名空间（TV_KV），用户系统无法使用。请在 Cloudflare Pages 项目「设置 → 函数 → KV 命名空间绑定」中把变量名 TV_KV 绑定到一个 KV 命名空间（生产和预览都绑），重新部署后再回来。';

function jsonResponse(data, status = 200, extraHeaders = {}) {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store',
            ...extraHeaders
        }
    });
}

function kvNotBound() {
    return jsonResponse({ ok: false, error: 'KV_NOT_BOUND', message: KV_NOT_BOUND_MESSAGE });
}

const USERNAME_RE = /^[\u4e00-\u9fa5A-Za-z0-9_]{2,20}$/;

function validateCredentials(username, password) {
    if (typeof username !== 'string' || !USERNAME_RE.test(username)) {
        return '用户名需为 2-20 个字符，只能用中文、字母、数字和下划线';
    }
    if (typeof password !== 'string' || password.length < 4) {
        return '密码至少 4 位';
    }
    return null;
}

function publicStats(user) {
    return {
        loginCount: user.loginCount || 0,
        lastLoginAt: user.lastLoginAt || 0,
        lastSeenAt: user.lastSeenAt || 0,
        onlineSec: user.onlineSec || 0,
        watchSec: user.watchSec || 0,
        createdAt: user.createdAt || 0
    };
}

async function buildMe(env, request) {
    const session = await getSessionUser(env, request);
    if (!session) return { loggedIn: false };
    const hist = await loadHistory(env, session.username);
    return {
        loggedIn: true,
        username: session.username,
        prefs: session.user.prefs,
        stats: publicStats(session.user),
        history: historyToArray(hist, 50)
    };
}

export async function onRequestGet(context) {
    const { request, env } = context;
    // me：无 KV 时也只是未登录状态，不报错打扰前端
    if (!hasKv(env)) return jsonResponse({ ok: true, loggedIn: false, hasKv: false });
    const me = await buildMe(env, request);
    return jsonResponse({ ok: true, hasKv: true, ...me });
}

export async function onRequestPost(context) {
    const { request, env } = context;

    let body;
    try {
        body = await request.json();
    } catch (e) {
        return jsonResponse({ ok: false, error: '请求体不是合法 JSON' }, 400);
    }
    const action = body && body.action;

    if (!hasKv(env)) return kvNotBound();

    try {
        switch (action) {
            case 'register': {
                const site = await readSite(env);
                if (site.allowRegister === false) {
                    return jsonResponse({ ok: false, error: '管理员已关闭注册，请联系管理员' });
                }
                const username = typeof body.username === 'string' ? body.username.trim() : '';
                const password = typeof body.password === 'string' ? body.password : '';
                const invalid = validateCredentials(username, password);
                if (invalid) return jsonResponse({ ok: false, error: invalid });

                const existing = await loadUser(env, username);
                if (existing) return jsonResponse({ ok: false, error: '这个用户名已经被注册了，换一个试试' });

                const now = Date.now();
                const user = {
                    username,
                    passHash: await hashUserPassword(password, username),
                    createdAt: now,
                    loginCount: 1,
                    lastLoginAt: now,
                    lastSeenAt: now,
                    onlineSec: 0,
                    watchSec: 0,
                    disabled: false,
                    prefs: { areas: [], kinds: [] }
                };
                await saveUser(env, user);
                const index = await loadUserIndex(env);
                if (!index.includes(username)) {
                    index.push(username);
                    await saveUserIndex(env, index);
                }
                const token = await createSession(env, username);
                return jsonResponse(
                    { ok: true, username, stats: publicStats(user) },
                    200,
                    { 'Set-Cookie': sessionCookieHeader(token) }
                );
            }

            case 'login': {
                const username = typeof body.username === 'string' ? body.username.trim() : '';
                const password = typeof body.password === 'string' ? body.password : '';
                if (!username || !password) {
                    return jsonResponse({ ok: false, error: '请输入用户名和密码' });
                }
                const user = await loadUser(env, username);
                if (!user) return jsonResponse({ ok: false, error: '用户名或密码不正确' }, 401);
                if (user.disabled) return jsonResponse({ ok: false, error: '这个账号已被管理员禁用' }, 403);
                const inputHash = await hashUserPassword(password, username);
                if (inputHash !== user.passHash) {
                    return jsonResponse({ ok: false, error: '用户名或密码不正确' }, 401);
                }
                const now = Date.now();
                user.loginCount = (user.loginCount || 0) + 1;
                user.lastLoginAt = now;
                user.lastSeenAt = now;
                await saveUser(env, user);
                const token = await createSession(env, username);
                return jsonResponse(
                    { ok: true, username, prefs: user.prefs, stats: publicStats(user) },
                    200,
                    { 'Set-Cookie': sessionCookieHeader(token) }
                );
            }

            case 'logout': {
                const token = readCookie(request, SESSION_COOKIE);
                await destroySession(env, token);
                return jsonResponse({ ok: true }, 200, { 'Set-Cookie': clearSessionCookieHeader() });
            }

            case 'setPrefs': {
                const session = await getSessionUser(env, request);
                if (!session) return jsonResponse({ ok: false, error: '请先登录' }, 401);
                session.user.prefs = sanitizePrefs(body.prefs || body);
                await saveUser(env, session.user);
                return jsonResponse({ ok: true, prefs: session.user.prefs });
            }

            case 'changePassword': {
                const session = await getSessionUser(env, request);
                if (!session) return jsonResponse({ ok: false, error: '请先登录' }, 401);
                const oldPassword = typeof body.oldPassword === 'string' ? body.oldPassword : '';
                const newPassword = typeof body.newPassword === 'string' ? body.newPassword : '';
                if (newPassword.length < 4) return jsonResponse({ ok: false, error: '新密码至少 4 位' });
                const oldHash = await hashUserPassword(oldPassword, session.username);
                if (oldHash !== session.user.passHash) {
                    return jsonResponse({ ok: false, error: '原密码不正确' }, 401);
                }
                session.user.passHash = await hashUserPassword(newPassword, session.username);
                await saveUser(env, session.user);
                return jsonResponse({ ok: true });
            }

            default:
                return jsonResponse({ ok: false, error: `未知动作：${action || '(空)'}` }, 400);
        }
    } catch (e) {
        return jsonResponse({ ok: false, error: '服务器处理失败：' + (e.message || e) }, 500);
    }
}

export async function onRequest(context) {
    if (context.request.method === 'GET') return onRequestGet(context);
    if (context.request.method === 'POST') return onRequestPost(context);
    return jsonResponse({ ok: false, error: '请用 GET 或 POST 请求' }, 405);
}
