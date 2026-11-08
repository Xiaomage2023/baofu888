// js/tracker.js
// 观看/在线数据采集（所有前台页面引入）。
// - 在线时长：页面可见时每秒累计，每 300 秒（或页面隐藏/关闭时）批量上报。
// - 播放页（player.html）：从 URL 参数取 source/id/title/集数，监听 video
//   的播放状态累计观看秒数与当前进度，play 时上报一次 play-start。
// 上报走 POST /api/track；未登录时服务端会静默忽略，所以游客也照常发。
// 全程 try/catch，任何异常都不允许影响页面与播放。
(function () {
    'use strict';
    try {
        var FLUSH_INTERVAL_MS = 300 * 1000;

        var onlinePending = 0;   // 待上报的在线秒数
        var watchPending = 0;    // 待上报的观看秒数（仅播放页）
        var positionSec = 0;     // 当前播放位置（秒）
        var isPlaying = false;
        var playInfo = null;     // {source,id,title,poster,episode,episodeLabel}
        var playStartSentFor = '';

        function isPlayerPage() {
            return window.location.pathname.indexOf('player.html') !== -1;
        }

        function collectPlayInfo() {
            if (!isPlayerPage()) return null;
            try {
                var params = new URLSearchParams(window.location.search);
                var index = parseInt(params.get('index') || '0', 10);
                if (isNaN(index) || index < 0) index = 0;
                var title = params.get('title') || '';
                if (!title) {
                    try { title = localStorage.getItem('currentVideoTitle') || ''; } catch (e) { /* 忽略 */ }
                }
                var source = params.get('source') || '';
                var id = params.get('id') || '';
                if (!source && !id) {
                    try { source = localStorage.getItem('currentSourceCode') || ''; } catch (e) { /* 忽略 */ }
                }
                if (!id && !title) return null;
                return {
                    source: source,
                    id: id,
                    title: title,
                    poster: '',
                    episode: index + 1,
                    episodeLabel: '第' + (index + 1) + '集'
                };
            } catch (e) {
                return null;
            }
        }

        function postTrack(payload, useBeacon) {
            try {
                var body = JSON.stringify(payload);
                if (useBeacon && navigator.sendBeacon) {
                    var blob = new Blob([body], { type: 'application/json' });
                    if (navigator.sendBeacon('/api/track', blob)) return;
                }
                fetch('/api/track', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: body,
                    keepalive: true
                }).catch(function () { /* 上报失败静默 */ });
            } catch (e) { /* 静默 */ }
        }

        function sendPlayStart() {
            if (!playInfo || !playInfo.id) return;
            var key = playInfo.source + ':' + playInfo.id + ':' + playInfo.episode;
            if (playStartSentFor === key) return;
            playStartSentFor = key;
            postTrack({
                type: 'play-start',
                play: {
                    source: playInfo.source, id: playInfo.id, title: playInfo.title,
                    poster: playInfo.poster, episode: playInfo.episode,
                    episodeLabel: playInfo.episodeLabel, positionSec: 0
                }
            }, false);
        }

        function flush(useBeacon) {
            var payload = {
                type: 'flush',
                onlineDeltaSec: onlinePending,
                play: null
            };
            if (playInfo && playInfo.id) {
                payload.play = {
                    source: playInfo.source, id: playInfo.id, title: playInfo.title,
                    poster: playInfo.poster, episode: playInfo.episode,
                    episodeLabel: playInfo.episodeLabel,
                    positionSec: positionSec,
                    watchDeltaSec: watchPending
                };
            }
            if (payload.onlineDeltaSec <= 0 && !payload.play) return;
            onlinePending = 0;
            watchPending = 0;
            postTrack(payload, useBeacon);
        }

        function hookVideo() {
            var video = document.querySelector('video');
            if (!video || video.__trackerHooked) return;
            video.__trackerHooked = true;
            video.addEventListener('play', function () {
                isPlaying = true;
                // 集数可能在播放器内切换，刷新一次播放信息
                var fresh = collectPlayInfo();
                if (fresh) playInfo = fresh;
                sendPlayStart();
            });
            video.addEventListener('pause', function () { isPlaying = false; });
            video.addEventListener('ended', function () { isPlaying = false; });
        }

        function tick() {
            try {
                if (document.visibilityState === 'visible') {
                    onlinePending += 1;
                }
                if (isPlayerPage()) {
                    if (!playInfo) playInfo = collectPlayInfo();
                    hookVideo();
                    var video = document.querySelector('video');
                    if (video && isPlaying && !video.paused && !video.ended) {
                        watchPending += 1;
                        var ct = Math.floor(video.currentTime || 0);
                        if (ct >= 0) positionSec = ct;
                    }
                }
            } catch (e) { /* 静默 */ }
        }

        playInfo = collectPlayInfo();
        setInterval(tick, 1000);
        setInterval(function () { flush(false); }, FLUSH_INTERVAL_MS);
        document.addEventListener('visibilitychange', function () {
            if (document.visibilityState === 'hidden') flush(true);
        });
        window.addEventListener('pagehide', function () { flush(true); });
    } catch (e) {
        // 采集模块绝不影响页面
    }
})();
