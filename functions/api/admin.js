// functions/api/admin.js
// 管理后台统一接口（Cloudflare Pages Function）
// POST JSON，按 body.action 分发。
//
// 数据存储（KV 绑定名：TV_KV）：
//   tv:sources -> { custom: [{key,name,api,detail}], disabled: [key...] }
//   tv:site    -> { passwordHash, siteName }
//
// 鉴权：
//   有效密码哈希 effectiveHash = KV tv:site.passwordHash（若有）
//   否则 sha256(env.PASSWORD || '')。
//   login 用密码换 token；token = sha256(effectiveHash + ':baofu-admin-v1')，
//   改密码后旧 token 自动失效。

import { sha256 } from '../../js/sha256.js';

// 内置资源源名单：与 js/config.js 的 API_SITES + js/customer_site.js 的
// CUSTOMER_SITES 保持同步（增删内置源时两边一起改）。
const BUILTIN_SITES = [
    { key: 'feifan', name: '飞凡资源', api: 'https://cj.ffzyapi.com/api.php/provide/vod/' },
    { key: 'suoni', name: '索尼资源', api: 'https://suoniapi.com/api.php/provide/vod/' },
    { key: 'tianya', name: '天涯资源', api: 'https://tyyszy.com/api.php/provide/vod/' },
    { key: 'liangzi', name: '量子资源', api: 'https://cj.lziapi.com/api.php/provide/vod/' },
    { key: 'baofeng', name: '暴风资源', api: 'https://bfzyapi.com/api.php/provide/vod/' },
    { key: 'guangsu', name: '光速资源', api: 'https://api.guangsuapi.com/api.php/provide/vod/' },
    { key: 'baidu', name: '百度资源', api: 'https://api.apibdzy.com/api.php/provide/vod/' },
    { key: 'wolong', name: '卧龙资源', api: 'https://collect.wolongzyw.com/api.php/provide/vod/' },
    { key: 'hongniu', name: '红牛资源', api: 'https://www.hongniuzy2.com/api.php/provide/vod/' },
    { key: 'jisu', name: '极速资源', api: 'https://jszyapi.com/api.php/provide/vod/' },
    { key: 'kuaiche', name: '快车资源', api: 'https://caiji.kuaichezy.com/api.php/provide/vod/' },
    { key: 'shandian', name: '闪电资源', api: 'https://sdzyapi.com/api.php/provide/vod/' },
    { key: 'jinying', name: '金鹰资源', api: 'https://jyzyapi.com/api.php/provide/vod/' },
    { key: 'haohua', name: '豪华资源', api: 'https://hhzyapi.com/api.php/provide/vod/' },
    { key: 'wujin', name: '无尽资源', api: 'https://api.wujinapi.me/api.php/provide/vod/' },
    { key: 'uku', name: 'U酷资源', api: 'https://api.ukuapi.com/api.php/provide/vod/' },
    { key: 'zy1080', name: '1080资源', api: 'https://api.1080zy.com/api.php/provide/vod/' },
    { key: 'xinlang', name: '新浪资源', api: 'https://api.xinlangapi.com/api.php/provide/vod/' },
    { key: 'modu', name: '魔都资源', api: 'https://moduapi.com/api.php/provide/vod/' },
    { key: 'heimuer', name: '黑木耳资源', api: 'https://json.heimuer.tv/api.php/provide/vod/' },
    { key: 'qihu', name: '奇虎资源', api: 'https://qihuapi.com/api.php/provide/vod/' },
    { key: 'shenma', name: '神马资源', api: 'https://api.shenmazy.com/api.php/provide/vod/' },
    { key: 'wangwang', name: '旺旺资源', api: 'https://api.wwzy.com/api.php/provide/vod/' },
    { key: 'yinghua', name: '樱花动漫', api: 'https://m3u8.iyinghua.io/api.php/provide/vod/' },
    { key: 'zy4k', name: '4K资源', api: 'https://api.4kzy.com/api.php/provide/vod/' },
    { key: 'qiqi', name: '七七资源', api: 'https://www.qiqidys.com/api.php/provide/vod' }
];

const KV_NOT_BOUND_MESSAGE = '尚未绑定 KV 命名空间（TV_KV），无法保存到服务器。请在 Cloudflare Pages 项目「设置 → 函数 → KV 命名空间绑定」中把变量名 TV_KV 绑定到一个 KV 命名空间（生产和预览都绑），然后重新部署再回来操作。';
const NO_PASSWORD_MESSAGE = '部署平台尚未设置 PASSWORD 环境变量，且后台也还没有保存过密码，无法登录。请先在 Cloudflare Pages 项目「设置 → 环境变量」中添加 PASSWORD，重新部署后再回来登录。';
const DEFAULT_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

function jsonResponse(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store'
        }
    });
}

function kvNotBound() {
    return jsonResponse({ ok: false, error: 'KV_NOT_BOUND', message: KV_NOT_BOUND_MESSAGE }, 200);
}

// ---------- KV 读写 ----------

async function readSite(env) {
    if (!env.TV_KV) return {};
    try {
        const raw = await env.TV_KV.get('tv:site');
        if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === 'object') return parsed;
        }
    } catch (e) { /* 忽略损坏的数据 */ }
    return {};
}

async function writeSite(env, site) {
    await env.TV_KV.put('tv:site', JSON.stringify(site));
}

async function readSources(env) {
    const empty = { custom: [], disabled: [] };
    if (!env.TV_KV) return empty;
    try {
        const raw = await env.TV_KV.get('tv:sources');
        if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === 'object') {
                return {
                    custom: Array.isArray(parsed.custom) ? parsed.custom : [],
                    disabled: Array.isArray(parsed.disabled) ? parsed.disabled : []
                };
            }
        }
    } catch (e) { /* 忽略损坏的数据 */ }
    return empty;
}

async function writeSources(env, data) {
    await env.TV_KV.put('tv:sources', JSON.stringify(data));
}

// ---------- 鉴权 ----------

async function getEffectiveHash(env) {
    const site = await readSite(env);
    if (site.passwordHash) {
        return { hash: site.passwordHash, source: 'kv', site };
    }
    const envPassword = env.PASSWORD || '';
    const hash = envPassword ? await sha256(envPassword) : '';
    return { hash, source: 'env', site };
}

async function makeToken(effectiveHash) {
    return sha256(effectiveHash + ':baofu-admin-v1');
}

// ---------- 资源源解析（batchAddSources / importFromUrl 共用） ----------

// 把多种格式的文本解析成 [{name, api, detail}]，附带逐条 errors。
function parseSourcesInput(text) {
    const sources = [];
    const errors = [];
    if (text === null || text === undefined || String(text).trim() === '') {
        return { sources, errors: ['内容为空'] };
    }
    const raw = String(text).trim();

    const pushItem = (name, api, detail) => {
        const cleanApi = typeof api === 'string' ? api.trim() : '';
        if (!cleanApi || !/^https?:\/\//i.test(cleanApi)) {
            errors.push(`跳过无效地址：${api || '(空)'}`);
            return;
        }
        let cleanName = typeof name === 'string' ? name.trim() : '';
        if (!cleanName) {
            try { cleanName = new URL(cleanApi).hostname; } catch (e) { cleanName = cleanApi; }
        }
        const item = { name: cleanName, api: cleanApi };
        if (detail && typeof detail === 'string' && detail.trim()) item.detail = detail.trim();
        sources.push(item);
    };

    // 先尝试 JSON 格式
    if (raw.startsWith('{') || raw.startsWith('[')) {
        try {
            const data = JSON.parse(raw);
            if (Array.isArray(data)) {
                // b) JSON 数组 [{name,api,detail}]
                data.forEach((item, i) => {
                    if (item && typeof item === 'object' && item.api) {
                        pushItem(item.name, item.api, item.detail);
                    } else {
                        errors.push(`第 ${i + 1} 条不是有效的源对象（缺 api）`);
                    }
                });
                return { sources, errors };
            }
            if (data && typeof data === 'object' && data.api_site && typeof data.api_site === 'object') {
                // c) 配置对象 {api_site:{key:{name,api,detail}}}（苹果 CMS / LunaTV 配置格式）
                Object.values(data.api_site).forEach((site) => {
                    if (site && typeof site === 'object' && site.api) {
                        pushItem(site.name, site.api, site.detail);
                    }
                });
                if (sources.length === 0) errors.push('api_site 里没有找到可用的源');
                return { sources, errors };
            }
            if (data && typeof data === 'object' && data.api) {
                // 单个对象 {name,api,detail}
                pushItem(data.name, data.api, data.detail);
                return { sources, errors };
            }
            return { sources, errors: ['JSON 格式无法识别（需要数组、{api_site:{...}} 配置对象，或单个 {name,api} 对象）'] };
        } catch (e) {
            // 不是合法 JSON，继续按逐行格式解析
        }
    }

    // a) 逐行格式：名称,API地址 / 名称，API地址 / 只有 API 地址
    const lines = raw.split(/\r?\n/);
    lines.forEach((line, idx) => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//')) return;
        const urlMatch = trimmed.match(/https?:\/\/[^\s,，]+/i);
        if (!urlMatch) {
            errors.push(`第 ${idx + 1} 行没有找到网址：${trimmed.slice(0, 60)}`);
            return;
        }
        const api = urlMatch[0];
        let name = '';
        const before = trimmed.slice(0, urlMatch.index).replace(/[,，:：\s]+$/, '').trim();
        if (before) name = before;
        pushItem(name, api, '');
    });

    if (sources.length === 0 && errors.length === 0) {
        errors.push('没有解析出任何源');
    }
    return { sources, errors };
}

// 生成不重复的自定义源 key：'u' + 时间戳36进制 + 随机后缀
// （只用时间戳时，同一毫秒内的多次添加会撞 key，删除/禁用会误伤同名 key 的源）
function genSourceKey(store) {
    const used = new Set((store && store.custom ? store.custom : []).map((s) => s.key));
    let key = '';
    do {
        key = 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    } while (used.has(key));
    return key;
}

// 把解析出的源并入 store，按 api 去重（与内置源、已有自定义源都比对）。
function mergeSources(store, parsed) {
    const seen = new Set();
    BUILTIN_SITES.forEach((s) => seen.add(s.api));
    store.custom.forEach((s) => seen.add(s.api));
    let added = 0;
    let skipped = 0;
    parsed.forEach((item) => {
        if (seen.has(item.api)) { skipped++; return; }
        seen.add(item.api);
        const entry = {
            key: genSourceKey(store),
            name: item.name,
            api: item.api
        };
        if (item.detail) entry.detail = item.detail;
        store.custom.push(entry);
        added++;
    });
    return { added, skipped };
}

function validateApi(api) {
    if (!api || typeof api !== 'string') return 'API 地址不能为空';
    try {
        const u = new URL(api);
        if (u.protocol !== 'http:' && u.protocol !== 'https:') return 'API 地址必须是 http(s) 网址';
    } catch (e) {
        return 'API 地址不是合法网址';
    }
    return null;
}

// ---------- 各动作 ----------

async function buildState(env) {
    const { hash, source } = await getEffectiveHash(env);
    const site = await readSite(env);
    const store = await readSources(env);
    return {
        ok: true,
        hasKv: !!env.TV_KV,
        passwordSource: hash ? source : 'env',
        siteName: site.siteName || '',
        sources: {
            custom: store.custom,
            disabled: store.disabled,
            builtins: BUILTINS_SITES_COPY()
        }
    };
}

function BUILTINS_SITES_COPY() {
    return BUILTIN_SITES.map((s) => ({ key: s.key, name: s.name, api: s.api }));
}

async function testSource(api) {
    const sep = api.includes('?') ? '&' : '?';
    const url = api + sep + 'ac=videolist&wd=' + encodeURIComponent('测试');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
        const resp = await fetch(url, {
            signal: controller.signal,
            headers: { 'User-Agent': DEFAULT_UA, 'Accept': 'application/json' }
        });
        clearTimeout(timer);
        if (resp.status !== 200) {
            return { ok: false, error: `对方返回 HTTP ${resp.status}` };
        }
        const text = await resp.text();
        let data;
        try { data = JSON.parse(text); } catch (e) {
            return { ok: false, error: '对方返回的不是 JSON 数据' };
        }
        if (!data || !Array.isArray(data.list)) {
            return { ok: false, error: '返回 JSON 里没有 list 数组，不是标准采集接口' };
        }
        const sample = data.list[0];
        return {
            ok: true,
            count: data.list.length,
            sampleTitle: sample && sample.vod_name ? String(sample.vod_name) : ''
        };
    } catch (e) {
        clearTimeout(timer);
        return { ok: false, error: e && e.name === 'AbortError' ? '请求超时（10 秒）' : ('请求失败：' + (e.message || e)) };
    }
}

// ---------- 主入口 ----------

export async function onRequestPost(context) {
    const { request, env } = context;

    let body;
    try {
        body = await request.json();
    } catch (e) {
        return jsonResponse({ ok: false, error: '请求体不是合法 JSON' }, 400);
    }
    const action = body && body.action;

    const { hash: effectiveHash } = await getEffectiveHash(env);

    // login 不需要 token
    if (action === 'login') {
        if (!effectiveHash) {
            return jsonResponse({ ok: false, error: 'NO_PASSWORD', message: NO_PASSWORD_MESSAGE });
        }
        const password = typeof body.password === 'string' ? body.password : '';
        const inputHash = password ? await sha256(password) : '';
        if (!inputHash || inputHash !== effectiveHash) {
            return jsonResponse({ ok: false, error: '密码不正确' }, 401);
        }
        return jsonResponse({ ok: true, token: await makeToken(effectiveHash) });
    }

    // 其余动作都要校验 token
    if (!effectiveHash || !body.token || body.token !== (await makeToken(effectiveHash))) {
        return jsonResponse({ ok: false, error: '未登录或登录已失效，请重新登录' }, 401);
    }

    const needsKv = ['setPassword', 'resetPassword', 'setSiteName', 'addSource', 'batchAddSources', 'importFromUrl', 'updateSource', 'deleteSource', 'toggleSource'];
    if (needsKv.includes(action) && !env.TV_KV) {
        return kvNotBound();
    }

    try {
        switch (action) {
            case 'getState': {
                return jsonResponse(await buildState(env));
            }

            case 'setPassword': {
                const newPassword = typeof body.newPassword === 'string' ? body.newPassword : '';
                if (newPassword.length < 4) {
                    return jsonResponse({ ok: false, error: '新密码至少 4 位' });
                }
                const site = await readSite(env);
                site.passwordHash = await sha256(newPassword);
                await writeSite(env, site);
                // 密码已变，返回基于新哈希的新 token，前端可无感续用
                return jsonResponse({ ok: true, token: await makeToken(site.passwordHash), passwordSource: 'kv' });
            }

            case 'resetPassword': {
                const site = await readSite(env);
                delete site.passwordHash;
                await writeSite(env, site);
                const envPassword = env.PASSWORD || '';
                if (!envPassword) {
                    return jsonResponse({ ok: true, warning: '已清除后台密码，但部署平台也没有设置 PASSWORD，站点将没有有效密码，请尽快在部署平台设置 PASSWORD 或重新在后台设密码。' });
                }
                return jsonResponse({ ok: true, token: await makeToken(await sha256(envPassword)), passwordSource: 'env' });
            }

            case 'setSiteName': {
                const siteName = typeof body.siteName === 'string' ? body.siteName.trim() : '';
                const site = await readSite(env);
                site.siteName = siteName;
                await writeSite(env, site);
                return jsonResponse({ ok: true, siteName });
            }

            case 'addSource': {
                const name = typeof body.name === 'string' ? body.name.trim() : '';
                const api = typeof body.api === 'string' ? body.api.trim() : '';
                const detail = typeof body.detail === 'string' ? body.detail.trim() : '';
                if (!name) return jsonResponse({ ok: false, error: '名称不能为空' });
                const apiError = validateApi(api);
                if (apiError) return jsonResponse({ ok: false, error: apiError });
                const store = await readSources(env);
                const dup = store.custom.some((s) => s.api === api) || BUILTIN_SITES.some((s) => s.api === api);
                if (dup) return jsonResponse({ ok: false, error: '这个 API 地址已经存在（内置源或自定义源里有了）' });
                const entry = { key: genSourceKey(store), name, api };
                if (detail) entry.detail = detail;
                store.custom.push(entry);
                await writeSources(env, store);
                const result = { ok: true, source: entry };
                if (!api.includes('/api.php/provide/vod')) {
                    result.warning = '这个地址不含常见的 /api.php/provide/vod 路径，可能不是标准苹果 CMS 采集接口，请用「测试」按钮确认能否用。';
                }
                return jsonResponse(result);
            }

            case 'batchAddSources': {
                const { sources: parsed, errors } = parseSourcesInput(body.text);
                const store = await readSources(env);
                const { added, skipped } = mergeSources(store, parsed);
                if (added > 0) await writeSources(env, store);
                return jsonResponse({ ok: true, added, skipped, errors });
            }

            case 'importFromUrl': {
                const url = typeof body.url === 'string' ? body.url.trim() : '';
                const urlError = validateApi(url);
                if (urlError) return jsonResponse({ ok: false, error: urlError });
                const controller = new AbortController();
                const timer = setTimeout(() => controller.abort(), 10000);
                let text;
                try {
                    const resp = await fetch(url, {
                        signal: controller.signal,
                        headers: { 'User-Agent': DEFAULT_UA }
                    });
                    clearTimeout(timer);
                    if (!resp.ok) return jsonResponse({ ok: false, error: `拉取失败：对方返回 HTTP ${resp.status}` });
                    text = await resp.text();
                } catch (e) {
                    clearTimeout(timer);
                    return jsonResponse({ ok: false, error: e && e.name === 'AbortError' ? '拉取超时（10 秒）' : ('拉取失败：' + (e.message || e)) });
                }
                const { sources: parsed, errors } = parseSourcesInput(text);
                const store = await readSources(env);
                const { added, skipped } = mergeSources(store, parsed);
                if (added > 0) await writeSources(env, store);
                return jsonResponse({ ok: true, added, skipped, errors });
            }

            case 'updateSource': {
                const key = body.key;
                const store = await readSources(env);
                const entry = store.custom.find((s) => s.key === key);
                if (!entry) return jsonResponse({ ok: false, error: '没找到这个自定义源（内置源不能改地址，只能禁用/启用）' });
                if (typeof body.name === 'string' && body.name.trim()) entry.name = body.name.trim();
                if (typeof body.api === 'string' && body.api.trim()) {
                    const apiError = validateApi(body.api.trim());
                    if (apiError) return jsonResponse({ ok: false, error: apiError });
                    const newApi = body.api.trim();
                    const dup = store.custom.some((s) => s.key !== key && s.api === newApi) || BUILTIN_SITES.some((s) => s.api === newApi);
                    if (dup) return jsonResponse({ ok: false, error: '这个 API 地址已经存在' });
                    entry.api = newApi;
                }
                if (typeof body.detail === 'string') {
                    if (body.detail.trim()) entry.detail = body.detail.trim();
                    else delete entry.detail;
                }
                await writeSources(env, store);
                return jsonResponse({ ok: true, source: entry });
            }

            case 'deleteSource': {
                const key = body.key;
                const store = await readSources(env);
                const before = store.custom.length;
                store.custom = store.custom.filter((s) => s.key !== key);
                store.disabled = store.disabled.filter((k) => k !== key);
                if (store.custom.length === before) {
                    return jsonResponse({ ok: false, error: '没找到这个自定义源（内置源不能删除，只能禁用）' });
                }
                await writeSources(env, store);
                return jsonResponse({ ok: true });
            }

            case 'toggleSource': {
                const key = body.key;
                if (!key) return jsonResponse({ ok: false, error: '缺少 key' });
                const store = await readSources(env);
                const isCustom = store.custom.some((s) => s.key === key);
                const isBuiltin = BUILTIN_SITES.some((s) => s.key === key);
                if (!isCustom && !isBuiltin) return jsonResponse({ ok: false, error: '没找到这个源' });
                const disabled = typeof body.disabled === 'boolean' ? body.disabled : !store.disabled.includes(key);
                if (disabled) {
                    if (!store.disabled.includes(key)) store.disabled.push(key);
                } else {
                    store.disabled = store.disabled.filter((k) => k !== key);
                }
                await writeSources(env, store);
                return jsonResponse({ ok: true, disabled });
            }

            case 'testSource': {
                const api = typeof body.api === 'string' ? body.api.trim() : '';
                const apiError = validateApi(api);
                if (apiError) return jsonResponse({ ok: false, error: apiError });
                return jsonResponse(await testSource(api));
            }

            default:
                return jsonResponse({ ok: false, error: `未知动作：${action || '(空)'}` }, 400);
        }
    } catch (e) {
        return jsonResponse({ ok: false, error: '服务器处理失败：' + (e.message || e) }, 500);
    }
}

export async function onRequest(context) {
    if (context.request.method === 'POST') return onRequestPost(context);
    return jsonResponse({ ok: false, error: '请用 POST 请求' }, 405);
}
