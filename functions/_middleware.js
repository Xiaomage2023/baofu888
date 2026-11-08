import { sha256 } from '../js/sha256.js';

export async function onRequest(context) {
  const { request, env, next } = context;
  const response = await next();
  const contentType = response.headers.get("content-type") || "";
  
  if (contentType.includes("text/html")) {
    let html = await response.text();
    
    // 处理普通密码：有效哈希优先用 KV 中后台保存的密码（tv:site.passwordHash），
    // 没有时回退到环境变量 PASSWORD 的哈希
    const password = env.PASSWORD || "";
    let passwordHash = "";
    try {
      if (env.TV_KV) {
        const rawSite = await env.TV_KV.get('tv:site');
        if (rawSite) {
          const site = JSON.parse(rawSite);
          if (site && site.passwordHash) {
            passwordHash = site.passwordHash;
          }
        }
      }
    } catch (e) {
      // KV 读取失败时回退到环境变量密码，不影响页面打开
    }
    if (!passwordHash && password) {
      passwordHash = await sha256(password);
    }
    html = html.replace('window.__ENV__.PASSWORD = "{{PASSWORD}}";', 
      `window.__ENV__.PASSWORD = "${passwordHash}";`);
    
    return new Response(html, {
      headers: response.headers,
      status: response.status,
      statusText: response.statusText,
    });
  }
  
  return response;
}