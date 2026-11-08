// 管理后台前端逻辑（admin.html）
// 所有请求走 POST /api/admin，登录后用 token 调其余动作。
(function () {
    'use strict';

    var TOKEN_KEY = 'baofuAdminToken';
    var state = null;

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
        var password = $('loginPassword').value;
        if (!password) { globalMsg('先输入访问密码。', 'err'); return; }
        $('loginBtn').disabled = true;
        try {
            var data = await callAdmin({ action: 'login', password: password });
            if (!data.ok) {
                // 后端原文提示（如未设置 PASSWORD 的说明）原样显示
                globalMsg(data.message || data.error || '登录失败', 'err');
                return;
            }
            setToken(data.token);
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
        } catch (e) {
            globalMsg('读取状态失败：' + e.message, 'err');
        }
    }

    function renderState() {
        if (!state) return;
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

    async function doSetPassword() {
        var newPassword = $('newPassword').value;
        if (!newPassword || newPassword.length < 4) { globalMsg('新密码至少 4 位。', 'err'); return; }
        try {
            var data = await authedCall({ action: 'setPassword', newPassword: newPassword });
            if (!data.ok) { globalMsg(data.message || data.error || '保存失败', 'err'); return; }
            if (data.token) setToken(data.token);
            $('newPassword').value = '';
            globalMsg('新密码已保存。下次打开网站和登录后台都用新密码。', 'ok');
            await refreshState();
        } catch (e) { globalMsg('保存失败：' + e.message, 'err'); }
    }

    async function doResetPassword() {
        if (!confirm('恢复为环境变量密码？后台保存的密码将被删除，之后用部署平台 PASSWORD 的值登录。')) return;
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

    // ---------- 绑定与初始化 ----------

    function bind() {
        $('loginBtn').addEventListener('click', doLogin);
        $('loginPassword').addEventListener('keydown', function (e) { if (e.key === 'Enter') doLogin(); });
        $('setPasswordBtn').addEventListener('click', doSetPassword);
        $('resetPasswordBtn').addEventListener('click', doResetPassword);
        $('setSiteNameBtn').addEventListener('click', doSetSiteName);
        $('refreshStateBtn').addEventListener('click', refreshState);
        $('addSourceBtn').addEventListener('click', doAddSource);
        $('batchAddBtn').addEventListener('click', doBatchAdd);
        $('importUrlBtn').addEventListener('click', doImportUrl);
        $('logoutBtn').addEventListener('click', function () {
            setToken('');
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
