import { sha256 } from '../js/sha256.js';

// 本中间件做两件事：
// 1) 服务端访问密码门禁：设了密码时，未授权的“文档请求”只能拿到一个
//    自包含密码页，站点 HTML 根本不会下发（不再是前端弹窗遮挡）。
// 2) 把有效密码哈希注入 HTML 的 window.__ENV__.PASSWORD（原有逻辑）。
//
// 有效哈希 effectiveHash 的计算与 functions/api/site-login.js、
// functions/api/admin.js、functions/proxy/[[path]].js 保持一致：
//   KV tv:site.passwordHash 优先，否则 sha256(env.PASSWORD || '')，
//   空串表示未设密码。
// 站点授权 cookie：tv_site_auth = sha256(effectiveHash + ':baofu-site-v1')。

const SITE_COOKIE_NAME = 'tv_site_auth';
const SITE_TOKEN_SALT = ':baofu-site-v1';

async function getEffectiveHash(env) {
  try {
    if (env.TV_KV) {
      const rawSite = await env.TV_KV.get('tv:site');
      if (rawSite) {
        const site = JSON.parse(rawSite);
        if (site && site.passwordHash) {
          return site.passwordHash;
        }
      }
    }
  } catch (e) {
    // KV 读取失败时回退到环境变量密码，不影响页面打开
  }
  const password = env.PASSWORD || '';
  return password ? await sha256(password) : '';
}

async function getSiteToken(effectiveHash) {
  return sha256(effectiveHash + SITE_TOKEN_SALT);
}

function readCookie(request, name) {
  const header = request.headers.get('Cookie') || '';
  const parts = header.split(';');
  for (const part of parts) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) {
      return part.slice(eq + 1).trim();
    }
  }
  return '';
}

function isDocumentRequest(request) {
  if (request.method !== 'GET') return false;
  const dest = request.headers.get('Sec-Fetch-Dest') || '';
  if (dest === 'document') return true;
  const accept = request.headers.get('Accept') || '';
  return accept.includes('text/html');
}

function isGateExemptPath(pathname) {
  return pathname === '/admin.html'
    || pathname === '/js/admin.js'
    || pathname.startsWith('/api/')
    || pathname.startsWith('/proxy/');
}

// 自包含密码页：内联 CSS/JS，不引用任何外部资源，不包含站点内容，
// 也不包含 __ENV__ 哈希占位符。
function sitePasswordPage() {
  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>访问验证 - LibreTV</title>
<style>
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; background: #0a0a0a; color: #e5e5e5; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; display: flex; align-items: center; justify-content: center; padding: 20px; }
    .card { width: 100%; max-width: 360px; background: #141414; border: 1px solid #2a2a2a; border-radius: 14px; padding: 26px 22px; }
    h1 { font-size: 22px; margin: 0 0 6px; text-align: center; }
    h1 .pink { color: #ec4899; }
    .sub { color: #888; font-size: 13px; text-align: center; margin: 0 0 18px; }
    label { display: block; font-size: 13px; color: #aaa; margin-bottom: 6px; }
    input[type="password"] { width: 100%; background: #1d1d1d; border: 1px solid #333; border-radius: 8px; color: #fff; padding: 11px 12px; font-size: 15px; outline: none; }
    input:focus { border-color: #ec4899; }
    button { width: 100%; background: #db2777; color: #fff; border: none; border-radius: 8px; padding: 11px 16px; font-size: 15px; cursor: pointer; margin-top: 14px; }
    button:hover { background: #be185d; }
    button:disabled { opacity: .55; cursor: not-allowed; }
    .err { display: none; color: #fca5a5; background: #2e0505; border: 1px solid #7f1d1d; border-radius: 8px; padding: 9px 12px; font-size: 13.5px; margin-top: 12px; text-align: center; }
</style>
</head>
<body>
<div class="card">
    <h1>Libre<span class="pink">TV</span></h1>
    <p class="sub">本站已开启访问保护，请输入访问密码</p>
    <form id="gateForm">
        <label for="gatePassword">访问密码</label>
        <input type="password" id="gatePassword" placeholder="输入访问密码" autocomplete="current-password">
        <button type="submit" id="gateBtn">进入</button>
        <div class="err" id="gateErr">密码错误</div>
    </form>
</div>
<script>
(function () {
    var form = document.getElementById('gateForm');
    var input = document.getElementById('gatePassword');
    var btn = document.getElementById('gateBtn');
    var err = document.getElementById('gateErr');
    input.focus();
    form.addEventListener('submit', function (e) {
        e.preventDefault();
        var password = input.value;
        if (!password) return;
        btn.disabled = true;
        err.style.display = 'none';
        fetch('/api/site-login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: password })
        }).then(function (resp) {
            return resp.json().catch(function () { return null; }).then(function (data) {
                if (resp.ok && data && data.ok) {
                    try {
                        localStorage.setItem('passwordVerified', JSON.stringify({
                            verified: true,
                            timestamp: Date.now(),
                            passwordHash: data.hash || ''
                        }));
                        localStorage.setItem('passwordHash', data.hash || '');
                    } catch (ignore) { /* 忽略存储失败，进站 cookie 已种好 */ }
                    location.replace('/');
                } else {
                    err.textContent = (data && data.error) || '密码错误';
                    err.style.display = 'block';
                    btn.disabled = false;
                    input.value = '';
                    input.focus();
                }
            });
        }).catch(function () {
            err.textContent = '请求失败，请稍后重试';
            err.style.display = 'block';
            btn.disabled = false;
        });
    });
})();
</script>
</body>
</html>`;
  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

export async function onRequest(context) {
  const { request, env, next } = context;

  const effectiveHash = await getEffectiveHash(env);

  // —— 服务端门禁：设了密码才生效 ——
  if (effectiveHash && isDocumentRequest(request)) {
    const { pathname } = new URL(request.url);
    if (!isGateExemptPath(pathname)) {
      const cookieToken = readCookie(request, SITE_COOKIE_NAME);
      const expectedToken = await getSiteToken(effectiveHash);
      if (!cookieToken || cookieToken !== expectedToken) {
        return sitePasswordPage();
      }
    }
  }

  const response = await next();
  const contentType = response.headers.get("content-type") || "";

  if (contentType.includes("text/html")) {
    let html = await response.text();

    // 注入有效密码哈希（KV 后台密码优先、env 兜底，与门禁同一来源）
    html = html.replace('window.__ENV__.PASSWORD = "{{PASSWORD}}";',
      `window.__ENV__.PASSWORD = "${effectiveHash}";`);

    return new Response(html, {
      headers: response.headers,
      status: response.status,
      statusText: response.statusText,
    });
  }

  return response;
}
