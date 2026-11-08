// js/home.js
// 首页推荐分区（替代豆瓣热门）：数据来自 GET /api/home（服务端从资源站
// 苹果 CMS 拉取并按地区/类型分区分组，登录用户还会按其首页定制前置分区）。
// 卡片点击复用搜索结果同款的全局 showDetails(id, title, sourceCode)
// 打开详情/选集弹窗。已登录用户额外渲染「继续观看」行（/api/user 的 me）。
(function () {
    'use strict';

    function esc(s) {
        return String(s === null || s === undefined ? '' : s);
    }

    function formatMin(sec) {
        var m = Math.floor((Number(sec) || 0) / 60);
        return m > 0 ? m + ' 分钟' : Math.max(0, Math.floor(Number(sec) || 0)) + ' 秒';
    }

    function openDetails(source, id, title) {
        if (typeof window.showDetails === 'function') {
            window.showDetails(String(id), esc(title), String(source));
        }
    }

    function makeCard(item, sourceKey) {
        var card = document.createElement('div');
        card.className = 'home-card';
        card.style.cssText = 'flex:0 0 auto;width:104px;cursor:pointer;';
        var posterWrap = document.createElement('div');
        posterWrap.style.cssText = 'position:relative;width:104px;height:156px;border-radius:8px;overflow:hidden;background:#1a1a1a;';
        var img = document.createElement('img');
        img.loading = 'lazy';
        img.alt = esc(item.title);
        img.style.cssText = 'width:100%;height:100%;object-fit:cover;';
        img.referrerPolicy = 'no-referrer';
        img.onerror = function () {
            img.onerror = null;
            img.src = 'https://via.placeholder.com/208x312?text=' + encodeURIComponent('无封面');
        };
        img.src = item.poster || 'https://via.placeholder.com/208x312?text=' + encodeURIComponent('无封面');
        posterWrap.appendChild(img);
        if (item.remarks) {
            var badge = document.createElement('span');
            badge.textContent = esc(item.remarks);
            badge.style.cssText = 'position:absolute;left:0;bottom:0;max-width:100%;background:rgba(0,0,0,.72);color:#f9a8d4;font-size:10px;padding:1px 5px;border-top-right-radius:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
            posterWrap.appendChild(badge);
        }
        card.appendChild(posterWrap);
        var title = document.createElement('div');
        title.textContent = esc(item.title);
        title.style.cssText = 'margin-top:5px;font-size:12.5px;color:#eee;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;width:104px;';
        card.appendChild(title);
        var meta = document.createElement('div');
        var metaText = [item.type, item.year].filter(Boolean).join(' · ');
        meta.textContent = metaText;
        meta.style.cssText = 'font-size:11px;color:#888;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;width:104px;';
        card.appendChild(meta);
        card.addEventListener('click', function () { openDetails(sourceKey, item.id, item.title); });
        return card;
    }

    function makeSection(section, sourceKey) {
        var wrap = document.createElement('div');
        wrap.className = 'home-section';
        wrap.style.cssText = 'margin:18px 0;';
        var head = document.createElement('div');
        head.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;padding:0 2px;';
        var h = document.createElement('h3');
        h.textContent = section.title;
        h.style.cssText = 'font-size:16px;font-weight:700;color:#fff;';
        head.appendChild(h);
        wrap.appendChild(head);
        var row = document.createElement('div');
        row.style.cssText = 'display:flex;gap:10px;overflow-x:auto;padding-bottom:6px;-webkit-overflow-scrolling:touch;';
        (section.items || []).forEach(function (item) { row.appendChild(makeCard(item, sourceKey)); });
        wrap.appendChild(row);
        return wrap;
    }

    var HOME_LS_KEY = 'homeCacheV1';

    function renderSections(container, data) {
        var sourceKey = data.source ? data.source.key : '';
        container.innerHTML = '';
        (data.sections || []).forEach(function (section) {
            if (section.items && section.items.length) {
                container.appendChild(makeSection(section, sourceKey));
            }
        });
        return container.children.length > 0;
    }

    async function loadHome() {
        var container = document.getElementById('homeSections');
        if (!container) return;
        // 1) 先用上次成功缓存的推荐垫上（弱网/接口抖动时首页也不空着）
        var rendered = false;
        try {
            var cachedRaw = localStorage.getItem(HOME_LS_KEY);
            if (cachedRaw) {
                var cachedData = JSON.parse(cachedRaw);
                if (cachedData && cachedData.ok && Array.isArray(cachedData.sections) && cachedData.sections.length) {
                    rendered = renderSections(container, cachedData);
                }
            }
        } catch (ignore) { /* 本地缓存不可用就走网络 */ }
        if (!rendered) {
            container.innerHTML = '<div style="color:#888;font-size:13px;padding:12px 2px;">加载推荐中…</div>';
        }
        // 2) 再拉最新数据：最多 4 次，间隔递增；成功就存本地并重渲染
        var lastReason = '';
        var delays = [0, 1500, 3000, 5000];
        for (var attempt = 0; attempt < delays.length; attempt++) {
            if (delays[attempt] > 0) {
                await new Promise(function (r) { setTimeout(r, delays[attempt]); });
            }
            var data = null;
            try {
                var resp = await fetch('/api/home', { headers: { 'Accept': 'application/json' }, cache: 'no-store' });
                if (!resp.ok) {
                    lastReason = '服务器返回 ' + resp.status;
                } else {
                    data = await resp.json();
                }
            } catch (fetchErr) {
                lastReason = '网络请求失败' + (fetchErr && fetchErr.message ? '（' + fetchErr.message + '）' : '');
                data = null;
            }
            if (data && data.ok && Array.isArray(data.sections) && data.sections.length) {
                try { localStorage.setItem(HOME_LS_KEY, JSON.stringify(data)); } catch (ignore) {}
                renderSections(container, data);
                return;
            }
            if (data && data.error) lastReason = data.error;
            else if (data && !data.ok) lastReason = '接口未返回可用数据';
            else if (data) lastReason = '接口返回的分区为空';
        }
        // 3) 全失败：有垫底缓存就继续显示缓存；没有才报错，并写明原因方便定位
        if (!rendered) {
            container.innerHTML = '<div style="color:#f87171;font-size:13.5px;padding:12px 2px;">' +
                '推荐暂时加载不出来' + (lastReason ? '：' + esc(lastReason) : '') + '</div>';
        }
    }

    function renderContinue(history) {
        var container = document.getElementById('continueRow');
        if (!container || !history || !history.length) return;
        var section = document.createElement('div');
        section.className = 'home-section';
        section.style.cssText = 'margin:18px 0;';
        var h = document.createElement('h3');
        h.textContent = '继续观看';
        h.style.cssText = 'font-size:16px;font-weight:700;color:#fff;margin-bottom:8px;padding:0 2px;';
        section.appendChild(h);
        var row = document.createElement('div');
        row.style.cssText = 'display:flex;gap:10px;overflow-x:auto;padding-bottom:6px;-webkit-overflow-scrolling:touch;';
        history.slice(0, 12).forEach(function (entry) {
            var fakeItem = {
                id: entry.id, title: entry.title,
                poster: entry.poster, remarks: entry.episodeLabel || '',
                type: '', year: ''
            };
            var card = makeCard(fakeItem, entry.source);
            // 在卡片下补一行进度说明与进度条
            var info = document.createElement('div');
            info.textContent = '看到 ' + formatMin(entry.positionSec);
            info.style.cssText = 'font-size:11px;color:#f9a8d4;width:104px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
            var barBg = document.createElement('div');
            barBg.style.cssText = 'width:104px;height:3px;background:#333;border-radius:2px;margin-top:2px;';
            var bar = document.createElement('div');
            var pct = entry.positionSec > 0 ? Math.min(95, Math.round(entry.positionSec / 2700 * 100)) : 0;
            bar.style.cssText = 'height:100%;width:' + pct + '%;background:#ec4899;border-radius:2px;';
            barBg.appendChild(bar);
            // makeCard 已按 [海报, 标题, meta] 排版，把进度说明插到标题之后
            card.appendChild(info);
            card.appendChild(barBg);
            row.appendChild(card);
        });
        section.appendChild(row);
        container.appendChild(section);
        // 把「继续观看」整行挪到推荐分区之前展示
        var home = document.getElementById('homeSections');
        if (home && container.parentNode) {
            container.parentNode.insertBefore(container, home);
        }
    }

    async function loadContinue() {
        var container = document.getElementById('continueRow');
        if (!container) return;
        try {
            var resp = await fetch('/api/user', { headers: { 'Accept': 'application/json' } });
            var data = await resp.json();
            if (data && data.loggedIn && Array.isArray(data.history)) {
                renderContinue(data.history);
            }
        } catch (e) { /* 未登录或接口不可用时静默 */ }
    }

    // 从用户中心点「继续观看」跳回首页后，自动打开对应详情
    function checkPendingOpen() {
        try {
            var raw = localStorage.getItem('openDetail');
            if (!raw) return;
            localStorage.removeItem('openDetail');
            var pending = JSON.parse(raw);
            if (pending && pending.id && pending.source) {
                setTimeout(function () { openDetails(pending.source, pending.id, pending.title || ''); }, 600);
            }
        } catch (e) { /* 忽略 */ }
    }

    document.addEventListener('DOMContentLoaded', function () {
        loadHome();
        loadContinue();
        checkPendingOpen();
    });
})();
