// functions/api/track.js
// 观看/在线数据上报接口（Cloudflare Pages Function）。
// js/tracker.js 每隔一段时间把本地累计的在线秒数、播放进度批量上报到这里。
//
// POST {type:'flush', onlineDeltaSec, play:{...}|null}
// POST {type:'play-start', play:{...}}
// 没有有效用户会话时静默返回 {ok:true, ignored:true}，不报错（游客也照常上报）。
// 增量统一钳制到 0-600 秒，防止异常数据污染统计。
// 每次请求的 KV 写入 ≤4 次（用户记录、历史、热度最多各一次）。

import {
    hasKv, getSessionUser, saveUser, loadHistory, saveHistory,
    loadHot, saveHot, applyPlay
} from '../../js/userstore.js';

function jsonResponse(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store'
        }
    });
}

function clampDelta(value) {
    const n = Number(value);
    if (Number.isNaN(n) || n < 0) return 0;
    return Math.min(600, Math.floor(n));
}

export async function onRequestPost(context) {
    const { request, env } = context;

    if (!hasKv(env)) return jsonResponse({ ok: true, ignored: true });

    let body;
    try {
        body = await request.json();
    } catch (e) {
        return jsonResponse({ ok: true, ignored: true });
    }

    const session = await getSessionUser(env, request);
    if (!session) return jsonResponse({ ok: true, ignored: true });

    try {
        const type = body && body.type;
        const play = body && body.play && typeof body.play === 'object' ? body.play : null;
        const now = Date.now();
        const user = session.user;
        let userDirty = false;

        if (type === 'flush') {
            const onlineDelta = clampDelta(body.onlineDeltaSec);
            if (onlineDelta > 0) {
                user.onlineSec = (user.onlineSec || 0) + onlineDelta;
                userDirty = true;
            }
            user.lastSeenAt = now;
            userDirty = true;

            const watchDelta = play ? clampDelta(play.watchDeltaSec) : 0;
            if (play) {
                // 即使 watchDelta 为 0，flush 也要更新播放位置/集数
                const hist = await loadHistory(env, session.username);
                const hot = watchDelta > 0 ? await loadHot(env) : null;
                const changed = applyPlay(hist, hot, play, { now, watchDeltaSec: watchDelta });
                if (changed) {
                    await saveHistory(env, session.username, hist);
                    if (hot) await saveHot(env, hot);
                    if (watchDelta > 0) {
                        user.watchSec = (user.watchSec || 0) + watchDelta;
                        userDirty = true;
                    }
                }
            }
            if (userDirty) await saveUser(env, user);
            return jsonResponse({ ok: true });
        }

        if (type === 'play-start') {
            if (!play) return jsonResponse({ ok: true, ignored: true });
            const hist = await loadHistory(env, session.username);
            const hot = await loadHot(env);
            const changed = applyPlay(hist, hot, play, { now, isStart: true });
            if (changed) {
                await saveHistory(env, session.username, hist);
                await saveHot(env, hot);
            }
            user.lastSeenAt = now;
            await saveUser(env, user);
            return jsonResponse({ ok: true });
        }

        return jsonResponse({ ok: true, ignored: true });
    } catch (e) {
        // 上报失败不影响用户使用，静默吞掉
        return jsonResponse({ ok: true, ignored: true });
    }
}

export async function onRequest(context) {
    if (context.request.method === 'POST') return onRequestPost(context);
    return jsonResponse({ ok: true, ignored: true });
}
