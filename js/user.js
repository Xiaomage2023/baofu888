// js/user.js
// 用户中心（user.html）逻辑：登录/注册、我的数据、首页定制、观看历史、改密码。
// 接口：GET /api/user（me）、POST /api/user（register/login/logout/setPrefs/changePassword）。
(function () {
    'use strict';

    var AREAS = ['国产', '港台', '日韩', '欧美', '泰国', '其他'];
    var KINDS = ['电影', '电视剧', '动漫', '综艺'];
    var mode = 'login'; // login | register
    var me = null;
    var selectedAreas = new Set();
    var selectedKinds = new Set();

    function $(id) { return document.getElementById(id); }

    function esc(s) {
        return String(s === null || s === undefined ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function showMsg(text, kind) {
        var el = $('globalMsg');
        el.textContent = text || '';
        el.className = 'msg ' + (text ? (kind || 'info') : '');
    }

    function fmtDur(sec) {
        sec = Math.max(0, Math.floor(Number(sec) || 0));
        var h = Math.floor(sec / 3600);
        var m = Math.round((sec % 3600) / 60);
        if (m === 60) { h += 1; m = 0; }
        if (h > 0) return h + '小时' + m + '分';
        if (m > 0) return m + '分钟';
        return sec + '秒';
    }

    function fmtMin(sec) {
        var m = Math.floor((Number(sec) || 0) / 60);
        return m > 0 ? m + ' 分钟' : Math.floor(Number(sec) || 0) + ' 秒';
    }

    function fmtTime(ts) {
        if (!ts) return '-';
        try { return new Date(ts).toLocaleString('zh-CN', { hour12: false }); } catch (e) { return '-'; }
    }

    async function postUser(payload) {
        var resp = await fetch('/api/user', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        var data = null;
        try { data = await resp.json(); } catch (e) { /* 非 JSON */ }
        if (!data) throw new Error('服务器返回异常（HTTP ' + resp.status + '）');
        return data;
    }

    async function loadMe() {
        var resp = await fetch('/api/user', { headers: { 'Accept': 'application/json' } });
        var data = await resp.json();
        if (data && data.loggedIn) {
            me = data;
            renderMain();
        } else {
            me = null;
            $('authCard').classList.remove('hidden');
            $('userMain').classList.add('hidden');
        }
    }

    // ---------- 登录/注册 ----------

    function setMode(next) {
        mode = next;
        $('tabLogin').classList.toggle('active', mode === 'login');
        $('tabRegister').classList.toggle('active', mode === 'register');
        $('authSubmitBtn').textContent = mode === 'login' ? '登录' : '注册并登录';
        $('authPassword').setAttribute('autocomplete', mode === 'login' ? 'current-password' : 'new-password');
    }

    async function doAuth() {
        var username = $('authUsername').value.trim();
        var password = $('authPassword').value;
        if (!username || !password) { showMsg('用户名和密码都要填。', 'err'); return; }
        $('authSubmitBtn').disabled = true;
        try {
            var data = await postUser({ action: mode === 'login' ? 'login' : 'register', username: username, password: password });
            if (!data.ok) {
                showMsg(data.message || data.error || '失败，请重试', 'err');
                return;
            }
            showMsg((mode === 'login' ? '登录成功' : '注册成功，已自动登录') + '，欢迎回来，' + username + '。', 'ok');
            $('authPassword').value = '';
            await loadMe();
        } catch (e) {
            showMsg('请求失败：' + e.message, 'err');
        } finally {
            $('authSubmitBtn').disabled = false;
        }
    }

    // ---------- 登录后渲染 ----------

    function renderMain() {
        $('authCard').classList.add('hidden');
        $('userMain').classList.remove('hidden');
        $('helloUser').textContent = me.username;
        var stats = me.stats || {};
        $('statLoginCount').textContent = stats.loginCount || 0;
        $('statLastLogin').textContent = fmtTime(stats.lastLoginAt);
        $('statOnline').textContent = fmtDur(stats.onlineSec);
        $('statWatch').textContent = fmtDur(stats.watchSec);

        selectedAreas = new Set((me.prefs && me.prefs.areas) || []);
        selectedKinds = new Set((me.prefs && me.prefs.kinds) || []);
        renderChips($('areaChips'), AREAS, selectedAreas);
        renderChips($('kindChips'), KINDS, selectedKinds);
        renderHistory(me.history || []);
    }

    function renderChips(container, values, selected) {
        container.innerHTML = '';
        values.forEach(function (v) {
            var chip = document.createElement('button');
            chip.type = 'button';
            chip.className = 'chip' + (selected.has(v) ? ' on' : '');
            chip.textContent = v;
            chip.addEventListener('click', function () {
                if (selected.has(v)) selected.delete(v);
                else selected.add(v);
                chip.classList.toggle('on', selected.has(v));
            });
            container.appendChild(chip);
        });
    }

    function renderHistory(history) {
        var container = $('historyList');
        container.innerHTML = '';
        if (!history.length) {
            container.innerHTML = '<p class="hint">还没有观看记录，去首页挑一部看吧。</p>';
            return;
        }
        history.forEach(function (entry) {
            var item = document.createElement('div');
            item.className = 'hist-item';
            var img = document.createElement('img');
            img.loading = 'lazy';
            img.referrerPolicy = 'no-referrer';
            img.alt = '';
            img.onerror = function () { img.onerror = null; img.src = 'https://via.placeholder.com/104x156?text=' + encodeURIComponent('无封面'); };
            img.src = entry.poster || 'https://via.placeholder.com/104x156?text=' + encodeURIComponent('无封面');
            item.appendChild(img);
            var body = document.createElement('div');
            body.style.cssText = 'flex:1;min-width:0;';
            var epText = entry.episodeLabel || (entry.episode ? '第' + entry.episode + '集' : '');
            body.innerHTML =
                '<div class="t">' + esc(entry.title || '未知视频') + '</div>' +
                '<div class="m">' +
                (epText ? esc(epText) + ' · ' : '') +
                '看到 ' + fmtMin(entry.positionSec) +
                ' · 累计观看 ' + fmtMin(entry.watchedSec) +
                '<br>最后观看：' + esc(fmtTime(entry.lastAt)) +
                '</div>';
            var btn = document.createElement('button');
            btn.className = 'small';
            btn.textContent = '继续观看';
            btn.addEventListener('click', function () {
                try {
                    localStorage.setItem('openDetail', JSON.stringify({
                        source: entry.source, id: entry.id, title: entry.title || ''
                    }));
                } catch (e) { /* 忽略 */ }
                window.location.href = 'index.html';
            });
            body.appendChild(btn);
            item.appendChild(body);
            container.appendChild(item);
        });
    }

    // ---------- 其他动作 ----------

    async function doSavePrefs() {
        try {
            var data = await postUser({
                action: 'setPrefs',
                prefs: { areas: Array.from(selectedAreas), kinds: Array.from(selectedKinds) }
            });
            if (!data.ok) { showMsg(data.message || data.error || '保存失败', 'err'); return; }
            showMsg('首页定制已保存，回到首页就能看到新的推荐顺序。', 'ok');
        } catch (e) { showMsg('保存失败：' + e.message, 'err'); }
    }

    async function doChangePassword() {
        var oldPassword = $('oldPassword').value;
        var newPassword = $('newPassword').value;
        if (!oldPassword || !newPassword) { showMsg('原密码和新密码都要填。', 'err'); return; }
        try {
            var data = await postUser({ action: 'changePassword', oldPassword: oldPassword, newPassword: newPassword });
            if (!data.ok) { showMsg(data.message || data.error || '改密码失败', 'err'); return; }
            $('oldPassword').value = ''; $('newPassword').value = '';
            showMsg('密码已修改。', 'ok');
        } catch (e) { showMsg('改密码失败：' + e.message, 'err'); }
    }

    async function doLogout() {
        try { await postUser({ action: 'logout' }); } catch (e) { /* 忽略 */ }
        me = null;
        $('userMain').classList.add('hidden');
        $('authCard').classList.remove('hidden');
        showMsg('已退出登录。', 'info');
    }

    document.addEventListener('DOMContentLoaded', function () {
        $('tabLogin').addEventListener('click', function () { setMode('login'); });
        $('tabRegister').addEventListener('click', function () { setMode('register'); });
        $('authSubmitBtn').addEventListener('click', doAuth);
        $('authPassword').addEventListener('keydown', function (e) { if (e.key === 'Enter') doAuth(); });
        $('savePrefsBtn').addEventListener('click', doSavePrefs);
        $('changePasswordBtn').addEventListener('click', doChangePassword);
        $('logoutBtn').addEventListener('click', doLogout);
        loadMe().catch(function () {
            $('authCard').classList.remove('hidden');
        });
    });
})();
