// functions/api/config.js
// 前端读取服务端配置（Cloudflare Pages Function）
// GET 返回：
// {
//   ok: true,
//   hasKv: 是否绑定了 KV 命名空间 TV_KV,
//   site: { siteName },
//   sources: { custom: [{key,name,api,detail}], disabled: [key...] }
// }
// 数据来自 KV：tv:sources（自定义源+禁用名单）、tv:site（站点设置）。
// 没有 KV 绑定时返回 hasKv:false 且空列表，站点照常按内置源工作。

async function readKvJson(env, key) {
    if (!env.TV_KV) return null;
    try {
        const raw = await env.TV_KV.get(key);
        if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === 'object') return parsed;
        }
    } catch (e) { /* 忽略损坏的数据 */ }
    return null;
}

export async function onRequestGet(context) {
    const { env } = context;
    const hasKv = !!env.TV_KV;

    const siteRaw = hasKv ? await readKvJson(env, 'tv:site') : null;
    const sourcesRaw = hasKv ? await readKvJson(env, 'tv:sources') : null;

    const site = siteRaw || {};
    const store = sourcesRaw || {};

    const body = {
        ok: true,
        hasKv,
        site: {
            siteName: typeof site.siteName === 'string' ? site.siteName : ''
        },
        sources: {
            custom: Array.isArray(store.custom) ? store.custom : [],
            disabled: Array.isArray(store.disabled) ? store.disabled : []
        }
    };

    return new Response(JSON.stringify(body), {
        status: 200,
        headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store'
        }
    });
}

export async function onRequest(context) {
    if (context.request.method === 'GET') return onRequestGet(context);
    return new Response(JSON.stringify({ ok: false, error: '请用 GET 请求' }), {
        status: 405,
        headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store'
        }
    });
}
