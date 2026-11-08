// 管理后台前端逻辑（admin.html）
// 所有请求走 POST /api/admin，登录后用 token 调其余动作。
(function () {
    'use strict';

    var TOKEN_KEY = 'baofuAdminToken';
    var state = null;
    var bootstrapLogin = false; // 本次是否以引导模式（admin + 站点密码）登录

    function $(id) { return document.getElementById(id); }

    function getToken() {
        try { return sessionStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; }
    }
    function setToken(t) {
        try {
            if (t) sessionStorage.setItem(TOKEN_KEY, t);
            else sessionStorage.removeItem(TOKEN_KEY);
        } catch (e) { /* 忽略 */ }
    }

    function showMsg(el, text, kind) {
        if (!el) return;
        el.textContent = text || '';
        el.className = 'msg ' + (kind || 'info');
        if (!text) el.className = 'msg';
    }
    function globalMsg(text, kind) { showMsg($('globalMsg'), text, kind); }

    function esc(s) {
        return String(s === null || s === undefined ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    async function callAdmin(payload) {
        var resp = await fetch('/api/admin', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        var data = null;
        try { data = await resp.json(); } catch (e) { /* 非 JSON 响应 */ }
        if (!data) throw new Error('服务器返回异常（HTTP ' + resp.status + '）');
        return data;
    }

    async function authedCall(payload) {
        payload.token = getToken();
        var data = await callAdmin(payload);
        if (data && data.error && /未登录|登录已失效/.test(data.error)) {
            setToken('');
            showLogin();
            globalMsg('登录已失效，请重新登录。', 'err');
            throw new Error(data.error);
        }
        return data;
    }

    // ---------- 登录 ----------

    async function doLogin() {
        var username = $('loginUsername').value.trim();
        var password = $('loginPassword').value;
        if (!username) { globalMsg('先输入管理员账号（引导模式填 admin）。', 'err'); return; }
        if (!password) { globalMsg('先输入管理员密码（引导模式填站点访问密码）。', 'err'); return; }
        $('loginBtn').disabled = true;
        try {
            var data = await callAdmin({ action: 'login', username: username, password: password });
            if (!data.ok) {
                // 后端原文提示（如未设置 PASSWORD 的说明）原样显示
                globalMsg(data.message || data.error || '登录失败', 'err');
                return;
            }
            setToken(data.token);
            bootstrapLogin = !!data.bootstrap;
            globalMsg('', 'info');
            await enterAdmin();
        } catch (e) {
            globalMsg('登录请求失败：' + e.message, 'err');
        } finally {
            $('loginBtn').disabled = false;
        }
    }

    function showLogin() {
        $('loginCard').classList.remove('hidden');
        $('adminMain').classList.add('hidden');
    }

    async function enterAdmin() {
        $('loginCard').classList.add('hidden');
        $('adminMain').classList.remove('hidden');
        await refreshState();
    }

    // ---------- 状态渲染 ----------

    async function refreshState() {
        try {
            var data = await authedCall({ action: 'getState' });
            if (!data.ok) {
                globalMsg(data.message || data.error || '读取状态失败', 'err');
                return;
            }
            state = data;
            renderState();
            refreshUsers();
        } catch (e) {
            globalMsg('读取状态失败：' + e.message, 'err');
        }
    }

    function renderState() {
        if (!state) return;

        // ⓪ 管理员账号状态 + 引导模式警告
        var adminInfo = state.admin || { custom: false, username: null };
        $('adminAccountStatus').textContent = adminInfo.custom
            ? '已设置独立管理员账号：' + adminInfo.username
            : '尚未设置独立管理员账号（当前为引导模式：admin + 站点访问密码可登录）';
        if (adminInfo.custom && !$('adminUsername').value) {
            $('adminUsername').value = adminInfo.username || '';
        }
        var showBootstrapWarn = !adminInfo.custom && (bootstrapLogin || !!getToken());
        $('bootstrapWarn').classList.toggle('hidden', !showBootstrapWarn);

        $('passwordSource').textContent = state.hasKv
            ? (state.passwordSource === 'kv' ? '后台保存（KV）' : '部署平台环境变量 PASSWORD')
            : '部署平台环境变量 PASSWORD（KV 未绑定，后台改动无法保存）';
        if (typeof state.siteName === 'string' && !$('siteNameInput').value) {
            $('siteNameInput').value = state.siteName;
        }

        var kvWarn = $('kvWarn');
        if (!state.hasKv) {
            kvWarn.textContent = '尚未绑定 KV 命名空间（TV_KV），下面列表只能看，添加/禁用/改密码都无法保存。请在 Cloudflare Pages 项目「设置 → 函数 → KV 命名空间绑定」中绑定变量名 TV_KV（生产和预览都绑），重新部署后再回来。';
            kvWarn.classList.remove('hidden');
        } else {
            kvWarn.classList.add('hidden');
        }

        var disabled = (state.sources && state.sources.disabled) || [];
        renderSourceList($('customList'), (state.sources && state.sources.custom) || [], disabled, true);
        renderSourceList($('builtinList'), (state.sources && state.sources.builtins) || [], disabled, false);
    }

    function renderSourceList(container, list, disabled, isCustom) {
        container.innerHTML = '';
        if (!list.length) {
            container.innerHTML = '<p class="hint">' + (isCustom ? '还没有自定义源，用下面 ③ / ④ 添加。' : '无') + '</p>';
            return;
        }
        list.forEach(function (site) {
            var isDisabled = disabled.indexOf(site.key) !== -1;
            var item = document.createElement('div');
            item.className = 'source-item' + (isDisabled ? ' disabled' : '');
            var ops =
                '<button class="small secondary" data-act="test">测试</button>' +
                '<button class="small secondary" data-act="toggle">' + (isDisabled ? '启用' : '禁用') + '</button>' +
                (isCustom ? '<button class="small danger" data-act="delete">删除</button>' : '') +
                '<span class="test-result"></span>';
            item.innerHTML =
                '<div class="name">' + esc(site.name) + (isDisabled ? '（已禁用）' : '') + '</div>' +
                '<div class="api">' + esc(site.api) + '</div>' +
                '<div class="ops">' + ops + '</div>';

            var resultEl = item.querySelector('.test-result');
            item.querySelector('[data-act="test"]').addEventListener('click', async function () {
                resultEl.textContent = '测试中…';
                resultEl.className = 'test-result';
                try {
                    var data = await authedCall({ action: 'testSource', api: site.api });
                    if (data.ok) {
                        resultEl.textContent = '✅ 可用（搜到 ' + (data.count || 0) + ' 条' + (data.sampleTitle ? '，如《' + data.sampleTitle + '》' : '') + '）';
                        resultEl.className = 'test-result good';
                    } else {
                        resultEl.textContent = '❌ 不可用：' + (data.error || '未知错误');
                        resultEl.className = 'test-result bad';
                    }
                } catch (e) {
                    resultEl.textContent = '❌ 测试失败：' + e.message;
                    resultEl.className = 'test-result bad';
                }
            });
            item.querySelector('[data-act="toggle"]').addEventListener('click', async function () {
                try {
                    var data = await authedCall({ action: 'toggleSource', key: site.key, disabled: !isDisabled });
                    if (!data.ok) { globalMsg(data.message || data.error || '操作失败', 'err'); return; }
                    await refreshState();
                } catch (e) { globalMsg('操作失败：' + e.message, 'err'); }
            });
            var delBtn = item.querySelector('[data-act="delete"]');
            if (delBtn) {
                delBtn.addEventListener('click', async function () {
                    if (!confirm('确定删除源「' + site.name + '」？')) return;
                    try {
                        var data = await authedCall({ action: 'deleteSource', key: site.key });
                        if (!data.ok) { globalMsg(data.message || data.error || '删除失败', 'err'); return; }
                        await refreshState();
                    } catch (e) { globalMsg('删除失败：' + e.message, 'err'); }
                });
            }
            container.appendChild(item);
        });
    }

    // ---------- 各表单动作 ----------

    async function doSetAdmin() {
        var username = $('adminUsername').value.trim();
        var newPassword = $('adminNewPassword').value;
        if (username.length < 2) { globalMsg('管理员账号至少 2 个字符。', 'err'); return; }
        if (!newPassword || newPassword.length < 4) { globalMsg('管理员密码至少 4 位。', 'err'); return; }
        try {
            var data = await authedCall({ action: 'setAdmin', username: username, newPassword: newPassword });
            if (!data.ok) { globalMsg(data.message || data.error || '保存失败', 'err'); return; }
            if (data.token) setToken(data.token);
            bootstrapLogin = false;
            $('adminNewPassword').value = '';
            globalMsg('管理员账号已保存：' + username + '。之后登录后台只用这个账号，站点访问密码不能再进后台。', 'ok');
            await refreshState();
        } catch (e) { globalMsg('保存失败：' + e.message, 'err'); }
    }

    async function doSetPassword() {
        var newPassword = $('newPassword').value;
        if (!newPassword || newPassword.length < 4) { globalMsg('新密码至少 4 位。', 'err'); return; }
        try {
            var data = await authedCall({ action: 'setPassword', newPassword: newPassword });
            if (!data.ok) { globalMsg(data.message || data.error || '保存失败', 'err'); return; }
            if (data.token) setToken(data.token);
            $('newPassword').value = '';
            globalMsg('新访问密码已保存。下次打开网站用新密码进站；后台登录用管理员账号，不受影响。', 'ok');
            await refreshState();
        } catch (e) { globalMsg('保存失败：' + e.message, 'err'); }
    }

    async function doResetPassword() {
        if (!confirm('恢复为环境变量密码？后台保存的访问密码将被删除，之后打开网站用部署平台 PASSWORD 的值进站（后台管理员登录不受影响）。')) return;
        try {
            var data = await authedCall({ action: 'resetPassword' });
            if (!data.ok) { globalMsg(data.message || data.error || '操作失败', 'err'); return; }
            if (data.token) setToken(data.token);
            globalMsg(data.warning || '已恢复为环境变量密码。', data.warning ? 'err' : 'ok');
            await refreshState();
        } catch (e) { globalMsg('操作失败：' + e.message, 'err'); }
    }

    async function doSetSiteName() {
        try {
            var data = await authedCall({ action: 'setSiteName', siteName: $('siteNameInput').value.trim() });
            if (!data.ok) { globalMsg(data.message || data.error || '保存失败', 'err'); return; }
            globalMsg('站点名称已保存。', 'ok');
            await refreshState();
        } catch (e) { globalMsg('保存失败：' + e.message, 'err'); }
    }

    async function doAddSource() {
        var name = $('addName').value.trim();
        var api = $('addApi').value.trim();
        var detail = $('addDetail').value.trim();
        if (!name || !api) { showMsg($('addMsg'), '名称和 API 地址都要填。', 'err'); return; }
        try {
            var data = await authedCall({ action: 'addSource', name: name, api: api, detail: detail });
            if (!data.ok) { showMsg($('addMsg'), data.message || data.error || '添加失败', 'err'); return; }
            var text = '已添加「' + name + '」。';
            if (data.warning) text += ' ⚠️ ' + data.warning;
            showMsg($('addMsg'), text, 'ok');
            $('addName').value = ''; $('addApi').value = ''; $('addDetail').value = '';
            await refreshState();
        } catch (e) { showMsg($('addMsg'), '添加失败：' + e.message, 'err'); }
    }

    function batchSummaryText(data) {
        var text = '导入完成：新增 ' + (data.added || 0) + ' 个，跳过（重复） ' + (data.skipped || 0) + ' 个。';
        if (data.errors && data.errors.length) {
            text += '\n问题：\n- ' + data.errors.join('\n- ');
        }
        return text;
    }

    async function doBatchAdd() {
        var text = $('batchText').value;
        if (!text.trim()) { showMsg($('batchMsg'), '先粘贴要导入的内容。', 'err'); return; }
        try {
            var data = await authedCall({ action: 'batchAddSources', text: text });
            if (!data.ok) { showMsg($('batchMsg'), data.message || data.error || '导入失败', 'err'); return; }
            showMsg($('batchMsg'), batchSummaryText(data), data.added > 0 ? 'ok' : 'info');
            $('batchMsg').style.whiteSpace = 'pre-wrap';
            await refreshState();
        } catch (e) { showMsg($('batchMsg'), '导入失败：' + e.message, 'err'); }
    }

    async function doImportUrl() {
        var url = $('importUrl').value.trim();
        if (!url) { showMsg($('batchMsg'), '先填导入网址。', 'err'); return; }
        try {
            var data = await authedCall({ action: 'importFromUrl', url: url });
            if (!data.ok) { showMsg($('batchMsg'), data.message || data.error || '导入失败', 'err'); return; }
            showMsg($('batchMsg'), batchSummaryText(data), data.added > 0 ? 'ok' : 'info');
            $('batchMsg').style.whiteSpace = 'pre-wrap';
            await refreshState();
        } catch (e) { showMsg($('batchMsg'), '导入失败：' + e.message, 'err'); }
    }

    // ---------- ⑤ 用户管理 ----------

    function fmtDur(sec) {
        sec = Math.max(0, Math.floor(Number(sec) || 0));
        var h = Math.floor(sec / 3600);
        var m = Math.round((sec % 3600) / 60);
        if (m === 60) { h += 1; m = 0; }
        if (h > 0) return h + '小时' + m + '分';
        if (m > 0) return m + '分钟';
        return sec + '秒';
    }

    function fmtTime(ts) {
        if (!ts) return '-';
        try { return new Date(ts).toLocaleString('zh-CN', { hour12: false }); } catch (e) { return '-'; }
    }

    async function refreshUsers() {
        try {
            var data = await authedCall({ action: 'listUsers' });
            if (!data.ok) {
                $('userOverview').textContent = '用户列表读取失败：' + (data.message || data.error || '未知错误');
                return;
            }
            renderUsers(data);
        } catch (e) {
            $('userOverview').textContent = '用户列表读取失败：' + e.message;
        }
    }

    function renderUsers(data) {
        var overview = data.overview || { userCount: 0, totalWatchSec: 0, hot: [] };
        $('userOverview').textContent = '共 ' + (overview.userCount || 0) + ' 个注册用户 · 全站累计观看 ' + fmtDur(overview.totalWatchSec);
        $('toggleRegisterBtn').textContent = '注册开关：' + ((state && state.allowRegister === false) ? '已关闭' : '开放中');

        var hotEl = $('hotList');
        hotEl.innerHTML = '';
        var hot = overview.hot || [];
        if (!hot.length) {
            hotEl.innerHTML = '<p class="hint">还没有播放数据。</p>';
        } else {
            hot.forEach(function (h, i) {
                var div = document.createElement('div');
                div.className = 'hint';
                div.style.cssText = 'padding:3px 0;color:#ccc;';
                div.textContent = (i + 1) + '. 《' + (h.title || h.id || '') + '》播放 ' + (h.plays || 0) + ' 次 · 累计观看 ' + fmtDur(h.watchSec);
                hotEl.appendChild(div);
            });
        }

        var listEl = $('userList');
        listEl.innerHTML = '';
        var users = data.users || [];
        if (!users.length) {
            listEl.innerHTML = '<p class="hint">还没有注册用户。</p>';
            return;
        }
        users.forEach(function (u) {
            var item = document.createElement('div');
            item.className = 'source-item' + (u.disabled ? ' disabled' : '');
            var prefsText = '';
            if (u.prefs && ((u.prefs.areas || []).length || (u.prefs.kinds || []).length)) {
                prefsText = ' · 定制：' + [].concat(u.prefs.areas || [], u.prefs.kinds || []).join('/');
            }
            item.innerHTML =
                '<div class="name">' + esc(u.username) + (u.disabled ? '（已禁用）' : '') + '</div>' +
                '<div class="api">登录 ' + (u.loginCount || 0) + ' 次 · 在线 ' + fmtDur(u.onlineSec) +
                ' · 观看 ' + fmtDur(u.watchSec) + '<br>最近活跃：' + esc(fmtTime(u.lastSeenAt)) + esc(prefsText) + '</div>' +
                '<div class="ops">' +
                '<button class="small secondary" data-act="detail">详情</button>' +
                '<button class="small secondary" data-act="toggle">' + (u.disabled ? '启用' : '禁用') + '</button>' +
                '<button class="small secondary" data-act="reset">重置密码</button>' +
                '<button class="small danger" data-act="del">删除</button>' +
                '</div>';
            item.querySelector('[data-act="detail"]').addEventListener('click', function () { showUserDetail(u.username); });
            item.querySelector('[data-act="toggle"]').addEventListener('click', async function () {
                try {
                    var d = await authedCall({ action: 'userSetDisabled', username: u.username, disabled: !u.disabled });
                    if (!d.ok) { globalMsg(d.message || d.error || '操作失败', 'err'); return; }
                    await refreshUsers();
                } catch (e) { globalMsg('操作失败：' + e.message, 'err'); }
            });
            item.querySelector('[data-act="reset"]').addEventListener('click', async function () {
                var np = prompt('给用户「' + u.username + '」设置新密码（至少 4 位）：');
                if (!np) return;
                try {
                    var d = await authedCall({ action: 'userResetPassword', username: u.username, newPassword: np });
                    if (!d.ok) { globalMsg(d.message || d.error || '重置失败', 'err'); return; }
                    globalMsg('已重置「' + u.username + '」的密码。', 'ok');
                } catch (e) { globalMsg('重置失败：' + e.message, 'err'); }
            });
            item.querySelector('[data-act="del"]').addEventListener('click', async function () {
                if (!confirm('确定删除用户「' + u.username + '」？其观看历史会一并删除。')) return;
                try {
                    var d = await authedCall({ action: 'userDelete', username: u.username });
                    if (!d.ok) { globalMsg(d.message || d.error || '删除失败', 'err'); return; }
                    $('userDetail').classList.add('hidden');
                    await refreshUsers();
                } catch (e) { globalMsg('删除失败：' + e.message, 'err'); }
            });
            listEl.appendChild(item);
        });
    }

    async function showUserDetail(username) {
        var box = $('userDetail');
        box.classList.remove('hidden');
        box.innerHTML = '<p class="hint">加载「' + esc(username) + '」的详情…</p>';
        try {
            var data = await authedCall({ action: 'userDetail', username: username });
            if (!data.ok) { box.innerHTML = '<p class="hint">读取失败：' + esc(data.message || data.error || '') + '</p>'; return; }
            var u = data.user || {};
            var prefs = u.prefs || { areas: [], kinds: [] };
            var html = '<div class="group-title" style="margin-top:0;">用户详情：' + esc(u.username) + '</div>' +
                '<p class="hint">注册：' + esc(fmtTime(u.createdAt)) + ' · 登录 ' + (u.loginCount || 0) + ' 次 · 最近登录：' + esc(fmtTime(u.lastLoginAt)) +
                '<br>累计在线 ' + fmtDur(u.onlineSec) + ' · 累计观看 ' + fmtDur(u.watchSec) +
                '<br>首页定制 — 地区：' + esc((prefs.areas || []).join('、') || '未设置') +
                '；类型：' + esc((prefs.kinds || []).join('、') || '未设置') + '</p>';
            var history = data.history || [];
            if (!history.length) {
                html += '<p class="hint">暂无观看历史。</p>';
            } else {
                html += '<div class="group-title">观看历史（' + history.length + ' 条）</div>';
                history.forEach(function (h) {
                    var ep = h.episodeLabel || (h.episode ? '第' + h.episode + '集' : '');
                    html += '<div class="hint" style="padding:4px 0;border-bottom:1px solid #222;color:#ccc;">《' + esc(h.title || h.id || '') + '》' +
                        (ep ? ' ' + esc(ep) : '') +
                        ' · 看到 ' + fmtDur(h.positionSec) +
                        ' · 累计观看 ' + fmtDur(h.watchedSec) +
                        ' · 播放 ' + (h.plays || 0) + ' 次' +
                        '<br><span style="color:#777;">最后观看：' + esc(fmtTime(h.lastAt)) + '</span></div>';
                });
            }
            box.innerHTML = html;
        } catch (e) {
            box.innerHTML = '<p class="hint">读取失败：' + esc(e.message) + '</p>';
        }
    }

    async function doToggleRegister() {
        var allow = !(state && state.allowRegister === false);
        try {
            var data = await authedCall({ action: 'setAllowRegister', allow: !allow });
            if (!data.ok) { globalMsg(data.message || data.error || '设置失败', 'err'); return; }
            if (state) state.allowRegister = data.allowRegister;
            $('toggleRegisterBtn').textContent = '注册开关：' + (data.allowRegister ? '开放中' : '已关闭');
            globalMsg(data.allowRegister ? '注册已开放。' : '注册已关闭，新用户不能再注册（已有用户不受影响）。', 'ok');
        } catch (e) { globalMsg('设置失败：' + e.message, 'err'); }
    }

    // ---------- 绑定与初始化 ----------

    function bind() {
        $('loginBtn').addEventListener('click', doLogin);
        $('loginUsername').addEventListener('keydown', function (e) { if (e.key === 'Enter') doLogin(); });
        $('loginPassword').addEventListener('keydown', function (e) { if (e.key === 'Enter') doLogin(); });
        $('setAdminBtn').addEventListener('click', doSetAdmin);
        $('setPasswordBtn').addEventListener('click', doSetPassword);
        $('resetPasswordBtn').addEventListener('click', doResetPassword);
        $('setSiteNameBtn').addEventListener('click', doSetSiteName);
        $('refreshStateBtn').addEventListener('click', refreshState);
        $('refreshUsersBtn').addEventListener('click', refreshUsers);
        $('toggleRegisterBtn').addEventListener('click', doToggleRegister);
        $('addSourceBtn').addEventListener('click', doAddSource);
        $('batchAddBtn').addEventListener('click', doBatchAdd);
        $('importUrlBtn').addEventListener('click', doImportUrl);
        $('logoutBtn').addEventListener('click', function () {
            setToken('');
            bootstrapLogin = false;
            showLogin();
            globalMsg('已退出登录。', 'info');
        });
    }

    document.addEventListener('DOMContentLoaded', function () {
        bind();
        if (getToken()) {
            enterAdmin().catch(function () { showLogin(); });
        } else {
            showLogin();
        }
    });
})();
