// ============ API 请求封装 ============
const API = (() => {
  let token = localStorage.getItem('oj_token') || '';

  function setToken(t) {
    token = t;
    if (t) localStorage.setItem('oj_token', t);
    else localStorage.removeItem('oj_token');
  }

  async function req(method, url, body) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = 'Bearer ' + token;

    let r;
    try {
      r = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      throw new Error('网络连接失败，服务器还活着吗？');
    }

    let data = {};
    try { data = await r.json(); } catch (e) { /* 非 JSON 响应 */ }

    // 未登录拦截：自动弹登录框（登录/注册接口除外）
    if (r.status === 401 && !url.includes('/api/login') && !url.includes('/api/register')) {
      openAuthModal();
      throw new Error(data.msg || '请先登录');
    }
    if (!r.ok || data.ok === false) throw new Error(data.msg || '请求失败(' + r.status + ')');
    return data;
  }

  return {
    get token() { return token; },
    setToken,
    get: (u) => req('GET', u),
    post: (u, b) => req('POST', u, b),
    put: (u, b) => req('PUT', u, b),
    del: (u) => req('DELETE', u),
  };
})();