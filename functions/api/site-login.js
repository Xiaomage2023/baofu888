// functions/api/site-login.js
// 站点访问密码的服务端登录接口，配合 functions/_middleware.js 的门禁使用。
//
// 有效哈希 effectiveHash 的计算与 _middleware.js、api/admin.js、
// proxy/[[path]].js 保持一致：
//   KV tv:site.passwordHash 优先，否则 sha256(env.PASSWORD || '')，
//   空串表示未设密码。
// 授权 cookie：tv_site_auth = sha256(effectiveHash + ':baofu-site-v1')，
// 与 _middleware.js 中的公式一致（两边一起改）。

import { sha256 } from '../../js/sha256.js';

const SITE_COOKIE_NAME = 'tv_site_auth';
const SITE_TOKEN_SALT = ':baofu-site-v1';
const COOKIE_MAX_AGE = 2592000; // 30 天

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

async function getEffectiveHash(env) {
    try {
        if (env.TV_KV) {
            const rawSite = await env.TV_KV.get('tv:site');
            if (rawSite) {
                const site = JSON.parse(rawSite);
                if (site && site.passwordHash) {
                    return site.passwordHash;
                }
            }
        }
    } catch (e) {
        // KV 读取失败时回退到环境变量密码
    }
    const password = env.PASSWORD || '';
    return password ? await sha256(password) : '';
}

async function getSiteToken(effectiveHash) {
    return sha256(effectiveHash + SITE_TOKEN_SALT);
}

function readCookie(request, name) {
    const header = request.headers.get('Cookie') || '';
    const parts = header.split(';');
    for (const part of parts) {
        const eq = part.indexOf('=');
        if (eq < 0) continue;
        if (part.slice(0, eq).trim() === name) {
            return part.slice(eq + 1).trim();
        }
    }
    return '';
}

async function isAuthed(request, effectiveHash) {
    if (!effectiveHash) return false;
    const cookieToken = readCookie(request, SITE_COOKIE_NAME);
    if (!cookieToken) return false;
    return cookieToken === (await getSiteToken(effectiveHash));
}

export async function onRequestGet(context) {
    const { request, env } = context;
    const effectiveHash = await getEffectiveHash(env);
    return jsonResponse({
        required: !!effectiveHash,
        authed: await isAuthed(request, effectiveHash)
    });
}

export async function onRequestPost(context) {
    const { request, env } = context;

    let body = {};
    try {
        body = await request.json();
    } catch (e) {
        body = {};
    }

    if (body && body.action === 'logout') {
        return jsonResponse({ ok: true }, 200, {
            'Set-Cookie': `${SITE_COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`
        });
    }

    const effectiveHash = await getEffectiveHash(env);

    // 没设密码：不需要登录
    if (!effectiveHash) {
        return jsonResponse({ ok: true, required: false });
    }

    const password = body && typeof body.password === 'string' ? body.password : '';
    const inputHash = password ? await sha256(password) : '';
    if (!inputHash || inputHash !== effectiveHash) {
        return jsonResponse({ ok: false, error: '密码错误' }, 401);
    }

    const token = await getSiteToken(effectiveHash);
    return jsonResponse({ ok: true, hash: effectiveHash }, 200, {
        'Set-Cookie': `${SITE_COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${COOKIE_MAX_AGE}`
    });
}

export async function onRequest(context) {
    if (context.request.method === 'GET') return onRequestGet(context);
    if (context.request.method === 'POST') return onRequestPost(context);
    return jsonResponse({ ok: false, error: '不支持的请求方法' }, 405);
}
