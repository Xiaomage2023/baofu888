// 全局常量配置
const PROXY_URL = '/proxy/';    // 适用于 Cloudflare, Netlify (带重写), Vercel (带重写)
// const HOPLAYER_URL = 'https://hoplayer.com/index.html';
const SEARCH_HISTORY_KEY = 'videoSearchHistory';
const MAX_HISTORY_ITEMS = 5;

// 密码保护配置
// 注意：PASSWORD 环境变量是必需的，所有部署都必须设置密码以确保安全
const PASSWORD_CONFIG = {
    localStorageKey: 'passwordVerified',  // 存储验证状态的键名
    verificationTTL: 90 * 24 * 60 * 60 * 1000  // 验证有效期（90天，约3个月）
};

// 网站信息配置
const SITE_CONFIG = {
    name: 'LibreTV',
    url: 'https://libretv.is-an.org',
    description: '暴富视频搜索与观看平台',
    logo: 'image/logo.png',
    version: '1.1.0'
};


// API站点配置
// API站点配置
const API_SITES = {
    feifan: {
        api: 'https://cj.ffzyapi.com/api.php/provide/vod/',
        name: '飞凡资源'
    },
    suoni: {
        api: 'https://suoniapi.com/api.php/provide/vod/',
        name: '索尼资源'
    },
    tianya: {
        api: 'https://tyyszy.com/api.php/provide/vod/',
        name: '天涯资源'
    },
    liangzi: {
        api: 'https://cj.lziapi.com/api.php/provide/vod/',
        name: '量子资源'
    },
    baofeng: {
        api: 'https://bfzyapi.com/api.php/provide/vod/',
        name: '暴风资源'
    },
    guangsu: {
        api: 'https://api.guangsuapi.com/api.php/provide/vod/',
        name: '光速资源'
    },
    baidu: {
        api: 'https://api.apibdzy.com/api.php/provide/vod/',
        name: '百度资源'
    },
    wolong: {
        api: 'https://collect.wolongzyw.com/api.php/provide/vod/',
        name: '卧龙资源'
    },
    hongniu: {
        api: 'https://www.hongniuzy2.com/api.php/provide/vod/',
        name: '红牛资源'
    },
    jisu: {
        api: 'https://jszyapi.com/api.php/provide/vod/',
        name: '极速资源'
    },
    kuaiche: {
        api: 'https://caiji.kuaichezy.com/api.php/provide/vod/',
        name: '快车资源'
    },
    shandian: {
        api: 'https://sdzyapi.com/api.php/provide/vod/',
        name: '闪电资源'
    },
    jinying: {
        api: 'https://jyzyapi.com/api.php/provide/vod/',
        name: '金鹰资源'
    },
    haohua: {
        api: 'https://hhzyapi.com/api.php/provide/vod/',
        name: '豪华资源'
    },
    wujin: {
        api: 'https://api.wujinapi.me/api.php/provide/vod/',
        name: '无尽资源'
    },
    uku: {
        api: 'https://api.ukuapi.com/api.php/provide/vod/',
        name: 'U酷资源'
    },
    zy1080: {
        api: 'https://api.1080zy.com/api.php/provide/vod/',
        name: '1080资源'
    },
    xinlang: {
        api: 'https://api.xinlangapi.com/api.php/provide/vod/',
        name: '新浪资源'
    },
    modu: {
        api: 'https://moduapi.com/api.php/provide/vod/',
        name: '魔都资源'
    },
    heimuer: {
        api: 'https://json.heimuer.tv/api.php/provide/vod/',
        name: '黑木耳资源'
    },
    qihu: {
        api: 'https://qihuapi.com/api.php/provide/vod/',
        name: '奇虎资源'
    },
    shenma: {
        api: 'https://api.shenmazy.com/api.php/provide/vod/',
        name: '神马资源'
    },
    wangwang: {
        api: 'https://api.wwzy.com/api.php/provide/vod/',
        name: '旺旺资源'
    },
    yinghua: {
        api: 'https://m3u8.iyinghua.io/api.php/provide/vod/',
        name: '樱花动漫'
    },
    zy4k: {
        api: 'https://api.4kzy.com/api.php/provide/vod/',
        name: '4K资源'
    }
    //ARCHIVE https://telegra.ph/APIs-08-12
};

// 定义合并方法
function extendAPISites(newSites) {
    Object.assign(API_SITES, newSites);
}

// 暴露到全局
window.API_SITES = API_SITES;
window.extendAPISites = extendAPISites;


// 添加聚合搜索的配置选项
const AGGREGATED_SEARCH_CONFIG = {
    enabled: true,             // 是否启用聚合搜索
    timeout: 8000,            // 单个源超时时间（毫秒）
    maxResults: 10000,          // 最大结果数量
    parallelRequests: true,   // 是否并行请求所有源
    showSourceBadges: true    // 是否显示来源徽章
};

// 抽象API请求配置
const API_CONFIG = {
    search: {
        // 只拼接参数部分，不再包含 /api.php/provide/vod/
        path: '?ac=videolist&wd=',
        pagePath: '?ac=videolist&wd={query}&pg={page}',
        maxPages: 50, // 最大获取页数
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            'Accept': 'application/json'
        }
    },
    detail: {
        // 只拼接参数部分
        path: '?ac=videolist&ids=',
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            'Accept': 'application/json'
        }
    }
};

// 优化后的正则表达式模式
const M3U8_PATTERN = /\$https?:\/\/[^"'\s]+?\.m3u8/g;

// 添加自定义播放器URL
const CUSTOM_PLAYER_URL = 'player.html'; // 使用相对路径引用本地player.html

// 增加视频播放相关配置
const PLAYER_CONFIG = {
    autoplay: true,
    allowFullscreen: true,
    width: '100%',
    height: '600',
    timeout: 15000,  // 播放器加载超时时间
    filterAds: true,  // 是否启用广告过滤
    autoPlayNext: true,  // 默认启用自动连播功能
    adFilteringEnabled: true, // 默认开启分片广告过滤
    adFilteringStorage: 'adFilteringEnabled' // 存储广告过滤设置的键名
};

// 增加错误信息本地化
const ERROR_MESSAGES = {
    NETWORK_ERROR: '网络连接错误，请检查网络设置',
    TIMEOUT_ERROR: '请求超时，服务器响应时间过长',
    API_ERROR: 'API接口返回错误，请尝试更换数据源',
    PLAYER_ERROR: '播放器加载失败，请尝试其他视频源',
    UNKNOWN_ERROR: '发生未知错误，请刷新页面重试'
};

// 添加进一步安全设置
const SECURITY_CONFIG = {
    enableXSSProtection: true,  // 是否启用XSS保护
    sanitizeUrls: true,         // 是否清理URL
    maxQueryLength: 100,        // 最大搜索长度
    // allowedApiDomains 不再需要，因为所有请求都通过内部代理
};

// 添加多个自定义API源的配置
const CUSTOM_API_CONFIG = {
    separator: ',',           // 分隔符
    maxSources: 5,            // 最大允许的自定义源数量
    testTimeout: 5000,        // 测试超时时间(毫秒)
    namePrefix: 'Custom-',    // 自定义源名称前缀
    validateUrl: true,        // 验证URL格式
    cacheResults: true,       // 缓存测试结果
    cacheExpiry: 5184000000,  // 缓存过期时间(2个月)
    adultPropName: 'isAdult' // 用于标记成人内容的属性名
};

// 隐藏内置黄色采集站API的变量
const HIDE_BUILTIN_ADULT_APIS = false;
// 【自动拦截并修复 HTTP 海报图片为 HTTPS，确保缩略图 100% 显示】
(function fixImageHttpToHttps() {
    if (typeof window === 'undefined') return;
    const originalSetAttribute = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function(name, value) {
        if (name === 'src' && typeof value === 'string' && value.startsWith('http://')) {
            value = value.replace(/^http:\/\//i, 'https://');
        }
        return originalSetAttribute.call(this, name, value);
    };
})();

// ================= 服务端源合并（管理后台 /api/config） =================
// 后台在 Cloudflare KV 里保存的自定义源与禁用名单，通过 /api/config 下发。
// 同步先用 localStorage 缓存 'baofuServerSites' 立即合并（保证设置面板打开时就对），
// 再异步拉 /api/config 刷新缓存并合并本次新增的源。整段失败不影响原有功能。
(function mergeServerSites() {
    try {
        if (typeof window === 'undefined' || typeof API_SITES === 'undefined') return;

        function applyServerSites(data) {
            if (!data || typeof data !== 'object') return;
            var disabled = Array.isArray(data.disabled) ? data.disabled : [];
            var custom = Array.isArray(data.custom) ? data.custom : [];
            // 删掉被禁用的源（内置与自定义都按 key 删）
            disabled.forEach(function (key) {
                if (API_SITES[key]) delete API_SITES[key];
            });
            // 并入未被禁用的自定义源，已存在的 key 不重复加
            custom.forEach(function (site) {
                if (!site || !site.key || !site.api) return;
                if (disabled.indexOf(site.key) !== -1) return;
                if (!API_SITES[site.key]) {
                    var entry = { api: site.api, name: site.name || site.key };
                    if (site.detail) entry.detail = site.detail;
                    API_SITES[site.key] = entry;
                }
            });
            window.API_SITES = API_SITES;
        }

        // 1) 同步应用本地缓存
        try {
            var cached = localStorage.getItem('baofuServerSites');
            if (cached) applyServerSites(JSON.parse(cached));
        } catch (e) { /* 缓存损坏就忽略 */ }

        // 2) 异步刷新服务端最新配置
        if (typeof fetch === 'function') {
            fetch('/api/config', { headers: { 'Accept': 'application/json' } })
                .then(function (resp) { return resp.ok ? resp.json() : null; })
                .then(function (json) {
                    if (!json || !json.ok || !json.sources) return;
                    try {
                        localStorage.setItem('baofuServerSites', JSON.stringify(json.sources));
                    } catch (e) { /* 存储失败不影响合并 */ }
                    applyServerSites(json.sources);
                    window.__serverSitesUpdated = true;
                })
                .catch(function () { /* 拉取失败就用缓存/内置源，绝不影响原有功能 */ });
        }
    } catch (e) {
        // 合并逻辑绝不允许影响原有功能
    }
})();
