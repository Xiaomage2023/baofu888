// functions/api/home.js
// 首页推荐数据接口（Cloudflare Pages Function）。
// 从已启用的资源源（苹果 CMS）拉分类与各分区内容，替代原来的豆瓣推荐：
//   源基址 + '?ac=list'             -> {class:[...], list:[最新条目]}
//   源基址 + '?ac=videolist&t=<id>' -> 分区条目
// 源按顺序试，第一个可用的胜出；分类与分区结果在 KV 缓存 20 分钟
// （键 tv:home:<sourceKey>）。带有效用户会话（tv_user cookie）时，
// 按用户 prefs（地区/类型）把偏好分区前置，并生成「为你推荐」，
// 个性化结果不写公共缓存。

import {
    hasKv, readJson, writeJson, getSessionUser
} from '../../js/userstore.js';

// 内置资源源名单：与 js/config.js 的 API_SITES + customer_site.js 的
// CUSTOMER_SITES、functions/api/admin.js 的 BUILTIN_SITES 保持同步。
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

const DEFAULT_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const CACHE_TTL_MS = 20 * 60 * 1000;
const SECTION_LIMIT = 14;

function jsonResponse(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store'
        }
    });
}

async function readSourcesStore(env) {
    const store = await readJson(env, 'tv:sources', {});
    return {
        custom: Array.isArray(store.custom) ? store.custom : [],
        disabled: Array.isArray(store.disabled) ? store.disabled : []
    };
}

// 已启用源的有序列表：内置（原顺序）在前，自定义在后，扣掉禁用名单
async function enabledSources(env) {
    const { custom, disabled } = await readSourcesStore(env);
    const disabledSet = new Set(disabled);
    const list = [];
    BUILTIN_SITES.forEach((s) => {
        if (!disabledSet.has(s.key)) list.push({ key: s.key, name: s.name, api: s.api });
    });
    custom.forEach((s) => {
        if (s && s.key && s.api && !disabledSet.has(s.key)) {
            list.push({ key: s.key, name: s.name || s.key, api: s.api });
        }
    });
    return list;
}

function joinQuery(api, query) {
    return api + (api.includes('?') ? '&' : '?') + query;
}

async function fetchCmsJson(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
        const resp = await fetch(url, {
            signal: controller.signal,
            headers: { 'User-Agent': DEFAULT_UA, 'Accept': 'application/json' }
        });
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        const text = await resp.text();
        return JSON.parse(text);
    } finally {
        clearTimeout(timer);
    }
}

function normalizeItem(item, classNameById) {
    if (!item || item.vod_id === undefined || item.vod_id === null) return null;
    return {
        id: String(item.vod_id),
        title: String(item.vod_name || ''),
        poster: String(item.vod_pic || ''),
        remarks: String(item.vod_remarks || ''),
        type: String(item.vod_type_name || (item.type_id !== undefined && classNameById ? (classNameById[String(item.type_id)] || '') : '') || ''),
        year: String(item.vod_year || '')
    };
}

function normalizeList(list, classNameById) {
    if (!Array.isArray(list)) return [];
    const out = [];
    list.forEach((item) => {
        const n = normalizeItem(item, classNameById);
        if (n && n.title) out.push(n);
    });
    return out;
}

// ---------- 分类分桶 ----------

// 判断一个类的“种类”：tv / movie / anime / variety / other
function classKind(cls, parentById) {
    const name = cls.type_name || '';
    if (name.includes('动漫') || name.includes('动画')) return 'anime';
    if (name.includes('综艺')) return 'variety';
    const parent = parentById[String(cls.type_pid)];
    const parentName = parent ? (parent.type_name || '') : '';
    if (parentName.includes('电影')) return 'movie';
    if (parentName.includes('电视') || parentName.includes('剧')) return 'tv';
    if (name.includes('电影') || name.includes('片')) return 'movie';
    if (name.includes('剧')) return 'tv';
    return 'other';
}

const TV_AREA_BUCKETS = [
    { key: 'guochan', title: '国产剧', area: '国产', words: ['国产'] },
    { key: 'rihan', title: '日韩剧', area: '日韩', words: ['日韩', '日本', '韩国'] },
    { key: 'oumei', title: '欧美剧', area: '欧美', words: ['欧美', '美国'] },
    { key: 'tai', title: '泰剧', area: '泰国', words: ['泰国', '泰剧'] },
    { key: 'gangtai', title: '港台剧', area: '港台', words: ['港台', '香港', '台湾'] }
];
const MOVIE_BUCKETS = [
    { key: 'dongzuo', words: ['动作'] },
    { key: 'xiju', words: ['喜剧'] },
    { key: 'aiqing', words: ['爱情'] },
    { key: 'kehuan', words: ['科幻'] },
    { key: 'kongbu', words: ['恐怖'] },
    { key: 'juqing', words: ['剧情'] }
];

// 按 class 列表算出分区方案：[{key,title,classId,area,kindTag}]
function planSections(classes, kindById) {
    const plan = [];
    const usedClassIds = new Set();
    const pick = (words, kinds) => {
        // 先只挑子类（type_pid 非 0）：父类直接拉 videolist 在不少源上是空的
        for (const pass of [0, 1]) {
            for (const cls of classes) {
                const id = String(cls.type_id);
                if (usedClassIds.has(id)) continue;
                const isParent = String(cls.type_pid) === '0' || cls.type_pid === 0;
                if (pass === 0 && isParent) continue;
                const name = cls.type_name || '';
                if (!words.some((w) => name.includes(w))) continue;
                if (kinds && !kinds.includes(kindById[id])) continue;
                usedClassIds.add(id);
                return cls;
            }
        }
        return null;
    };

    TV_AREA_BUCKETS.forEach((b) => {
        const cls = pick(b.words, ['tv']);
        // 泰剧等类名本身含“剧”但父类不明时 kind 可能算成 tv/已覆盖；
        // 若按 tv 没命中，再放宽到任意 kind 含“剧”的类
        const found = cls || pick(b.words, null);
        if (found) {
            plan.push({ key: b.key, title: b.title, classId: String(found.type_id), area: b.area, kindTag: '电视剧' });
        }
    });
    MOVIE_BUCKETS.forEach((b) => {
        const cls = pick(b.words, ['movie']);
        if (cls) {
            plan.push({ key: 'movie_' + b.key, title: cls.type_name, classId: String(cls.type_id), area: '', kindTag: '电影' });
        }
    });
    const anime = pick(['动漫', '动画'], null);
    if (anime) plan.push({ key: 'anime', title: anime.type_name || '动漫', classId: String(anime.type_id), area: '', kindTag: '动漫' });
    const variety = pick(['综艺'], null);
    if (variety) plan.push({ key: 'variety', title: variety.type_name || '综艺', classId: String(variety.type_id), area: '', kindTag: '综艺' });
    return plan;
}

// ---------- 单个源的数据构建（可缓存部分） ----------

async function buildSourceData(env, source) {
    const cacheKey = 'tv:home:v2:' + source.key;
    if (hasKv(env)) {
        const cached = await readJson(env, cacheKey, null);
        if (cached && cached.at && (Date.now() - cached.at) < CACHE_TTL_MS
            && Array.isArray(cached.classes) && Array.isArray(cached.latest) && cached.byClass) {
            return cached;
        }
    }

    const listData = await fetchCmsJson(joinQuery(source.api, 'ac=list'));
    if (!listData || !Array.isArray(listData.class) || !Array.isArray(listData.list)) {
        throw new Error('ac=list 返回格式不对');
    }
    const classes = listData.class.map((c) => ({
        type_id: c.type_id, type_name: String(c.type_name || ''), type_pid: c.type_pid
    }));
    const parentById = {};
    const classNameById = {};
    classes.forEach((c) => {
        classNameById[String(c.type_id)] = c.type_name;
        if (String(c.type_pid) === '0' || c.type_pid === 0) parentById[String(c.type_id)] = c;
    });
    const kindById = {};
    classes.forEach((c) => { kindById[String(c.type_id)] = classKind(c, parentById); });

    // 最新更新改用 videolist 拉全字段（ac=list 的 list 不带海报）；失败回退 list 原数据
    let latest = [];
    try {
        const latestData = await fetchCmsJson(joinQuery(source.api, 'ac=videolist&pg=1'));
        latest = normalizeList(latestData && latestData.list, classNameById).slice(0, 20);
    } catch (e) { /* 回退 */ }
    if (!latest.length) {
        latest = normalizeList(listData.list, classNameById).slice(0, 20);
    }
    const plan = planSections(classes, kindById);

    const byClass = {};
    await Promise.all(plan.map(async (sec) => {
        try {
            const data = await fetchCmsJson(joinQuery(source.api, 'ac=videolist&t=' + encodeURIComponent(sec.classId) + '&pg=1'));
            byClass[sec.classId] = normalizeList(data && data.list, classNameById).slice(0, SECTION_LIMIT);
        } catch (e) {
            byClass[sec.classId] = [];
        }
    }));

    const built = {
        at: Date.now(),
        classes,
        plan,
        latest,
        byClass
    };
    if (hasKv(env)) {
        try { await writeJson(env, cacheKey, built); } catch (e) { /* 缓存写失败不影响返回 */ }
    }
    return built;
}

// ---------- 分区组装与个性化 ----------

function assembleSections(built) {
    const sections = [];
    if (built.latest && built.latest.length) {
        sections.push({ key: 'latest', title: '最新更新', items: built.latest, area: '', kindTag: '' });
    }
    (built.plan || []).forEach((sec) => {
        const items = built.byClass[sec.classId] || [];
        if (!items.length) return;
        sections.push({
            key: sec.key, title: sec.title, items,
            area: sec.area || '', kindTag: sec.kindTag || ''
        });
    });
    return sections;
}

// 从 classes 里按地区词找第一个类（任意种类），供「为你推荐」取数
function findAreaClass(classes, words) {
    for (const cls of classes) {
        const name = cls.type_name || '';
        if (words.some((w) => name.includes(w))) return cls;
    }
    return null;
}

const AREA_WORDS = {
    '国产': ['国产'], '港台': ['港台', '香港', '台湾'], '日韩': ['日韩', '日本', '韩国'],
    '欧美': ['欧美', '美国'], '泰国': ['泰国', '泰剧'], '其他': []
};

async function buildForYou(env, source, built, prefs) {
    const areas = (prefs && prefs.areas) || [];
    if (!areas.length) return null;
    const seen = new Set();
    const items = [];
    for (const area of areas) {
        const words = AREA_WORDS[area] || [];
        if (!words.length) continue;
        const cls = findAreaClass(built.classes, words);
        if (!cls) continue;
        const classId = String(cls.type_id);
        let classItems = built.byClass[classId];
        if (!classItems) {
            try {
                const data = await fetchCmsJson(joinQuery(source.api, 'ac=videolist&t=' + encodeURIComponent(classId) + '&pg=1'));
                const classNameById = {};
                built.classes.forEach((c) => { classNameById[String(c.type_id)] = c.type_name; });
                classItems = normalizeList(data && data.list, classNameById).slice(0, SECTION_LIMIT);
            } catch (e) {
                classItems = [];
            }
        }
        classItems.slice(0, 5).forEach((item) => {
            const dedupeKey = item.id;
            if (!seen.has(dedupeKey)) {
                seen.add(dedupeKey);
                items.push(item);
            }
        });
        if (items.length >= 10) break;
    }
    if (!items.length) return null;
    return { key: 'foryou', title: '为你推荐', items: items.slice(0, 10), area: '', kindTag: '' };
}

function personalize(sections, forYou, prefs) {
    const areas = new Set((prefs && prefs.areas) || []);
    const kinds = new Set((prefs && prefs.kinds) || []);
    const latest = sections.filter((s) => s.key === 'latest');
    const rest = sections.filter((s) => s.key !== 'latest');
    const preferred = [];
    const others = [];
    rest.forEach((s) => {
        const areaHit = s.area && areas.has(s.area);
        const kindHit = s.kindTag && kinds.has(s.kindTag);
        if (areaHit || kindHit) preferred.push(s);
        else others.push(s);
    });
    const out = [];
    if (forYou) out.push(forYou);
    out.push(...latest, ...preferred, ...others);
    return out.map(({ area, kindTag, ...pub }) => pub);
}

function stripMeta(sections) {
    return sections.map(({ area, kindTag, ...pub }) => pub);
}

// ---------- 主入口 ----------

export async function onRequestGet(context) {
    const { request, env } = context;

    // 个性化：有效用户会话才读 prefs（未登录/无 KV 时为 null）
    let session = null;
    try { session = await getSessionUser(env, request); } catch (e) { session = null; }
    const prefs = session ? session.user.prefs : null;
    const hasPrefs = !!(prefs && ((prefs.areas && prefs.areas.length) || (prefs.kinds && prefs.kinds.length)));

    const sources = await enabledSources(env);
    let lastError = null;
    for (const source of sources) {
        try {
            const built = await buildSourceData(env, source);
            let sections = assembleSections(built);
            if (!sections.length) throw new Error('该源没有可用分区');
            if (hasPrefs) {
                const forYou = await buildForYou(env, source, built, prefs);
                sections = personalize(sections, forYou, prefs);
            } else {
                sections = stripMeta(sections);
            }
            return jsonResponse({
                ok: true,
                source: { key: source.key, name: source.name },
                sections
            });
        } catch (e) {
            lastError = e;
            // 顺延下一个源
        }
    }
    return jsonResponse({
        ok: false,
        error: '所有资源源暂时不可用，请稍后重试' + (lastError ? '（' + (lastError.message || lastError) + '）' : '')
    });
}

export async function onRequest(context) {
    if (context.request.method === 'GET') return onRequestGet(context);
    return jsonResponse({ ok: false, error: '请用 GET 请求' }, 405);
}
