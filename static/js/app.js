// ============ 比特 OJ 前端主逻辑（SPA 路由 + 渲染） ============

const state = { user: null };

// ---------- 工具 ----------
function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
const $ = (id) => document.getElementById(id);

// ---------- 用户与导航 ----------
async function refreshUser() {
  try {
    const r = await fetch('/api/me', {
      headers: API.token ? { 'Authorization': 'Bearer ' + API.token } : {},
    });
    if (r.ok) {
      const d = await r.json();
      state.user = d.user;
    } else state.user = null;
  } catch (e) { state.user = null; }
  navUpdate();
  return state.user;
}

function navUpdate() {
  const el = $('nav-user');
  const adminNav = $('nav-admin');
  if (state.user) {
    adminNav.style.display = state.user.role === 'admin' ? '' : 'none';
    el.innerHTML = `
      <a href="#/me" style="color:inherit;text-decoration:none"><span class="u-name">👋 ${escapeHtml(state.user.username)}</span></a>
      <span class="pts">⭐ ${state.user.points}</span>
      <button class="btn-link" data-action="logout">退出登录</button>
      <button class="btn-link" data-action="delete-account" style="color:#dc2626">注销账号</button>`;
  } else {
    adminNav.style.display = 'none';
    el.innerHTML = '<button class="btn btn-primary btn-sm" data-action="show-login">登录 / 注册</button>';
  }
}

// ---------- 登录拦截 ----------
function requireLogin(cb) {
  if (!API.token) { authCallback = cb; openAuthModal(); return false; }
  return true;
}

// ---------- 路由 ----------
function router() {
  const hash = location.hash || '#/problems';
  const parts = hash.replace(/^#\//, '').split('/');
  const section = parts[0] || 'problems';
  const page = $('page');
  disposeEditor();

  document.querySelectorAll('.nav-links a').forEach(a =>
    a.classList.toggle('active', a.dataset.nav === section));

  if (section === 'problem' && parts[1]) renderProblem(parseInt(parts[1]), page);
  else if (section === 'problems') renderProblems(page);
  else if (section === 'submissions') renderSubmissions(page);
  else if (section === 'rank') renderRank(page);
  else if (section === 'trainings') renderTrainings(page);
  else if (section === 'announcements') renderAnnouncements(page);
  else if (section === 'classes') renderClasses(page);
  else if (section === 'class' && parts[1]) renderClass(parseInt(parts[1]), page);
  else if (section === 'shop') renderShop(page);
  else if (section === 'admin') renderAdmin(page);
  else if (section === 'files') renderFiles(page);
  else if (section === 'me') renderMyProfile(page);
  else if (section === 'ai') renderAiChat(page);
  else page.innerHTML = '<div class="empty">404，页面被婆罗门搬走了。回 <a href="#/problems">题库</a></div>';
  window.scrollTo(0, 0);
}

// ---------- 题库 ----------
async function renderProblems(page) {
  page.innerHTML = '<div class="empty">加载中…</div>';
  let data;
  try { data = await API.get('/api/problems'); }
  catch (e) { page.innerHTML = `<div class="empty">${escapeHtml(e.message)}</div>`; return; }

  const rows = data.problems.map(p => `
    <tr>
      <td>${p.id}</td>
      <td><a class="link" href="#/problem/${p.id}">${escapeHtml(p.title)}</a> ${p.solved ? '✅' : ''}</td>
      <td><span class="diff-badge diff-${Math.min(p.difficulty, 4)}">难度 ${p.difficulty}</span></td>
      <td>${(p.tags || []).map(t => `<span class="tag">${escapeHtml(t)}</span>`).join('')}</td>
    </tr>`).join('');

  page.innerHTML = `
    <h1 class="page-title">题库</h1>
    <div class="card">
      <table>
        <thead><tr><th>#</th><th>题目</th><th>难度</th><th>标签</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="4" class="empty">暂无题目，等管理员投喂吧</td></tr>'}</tbody>
      </table>
    </div>`;
}

// ---------- 个人主页 ----------
async function renderMyProfile(page) {
  if (!requireLogin(() => renderMyProfile(page))) return;
  page.innerHTML = '<div class="empty">加载中…</div>';
  try {
    const data = await API.get('/api/me/profile');
    const u = data.user, t = data.tier;
    const subRoman = t.sub === 3 ? '' : ' ' + ['I','II','III'][t.sub];
    const tierName = t.name + subRoman;
    const pct = t.next_rr > t.prev_rr ? Math.min(100, Math.round((t.rr - t.prev_rr) * 100 / (t.next_rr - t.prev_rr))) : 100;
    const progressText = t.next_rr > t.rr ? '还差 ' + (t.next_rr - t.rr) + ' RR 到下一段位' : '已得超凡入圣';
    const heatColor = data.heat > 20 ? '#ef4444' : data.heat > 5 ? '#f59e0b' : '#94a3b8';
    page.innerHTML = `
      <h1 class="page-title">个人主页</h1>
      <div class="card">
        <div style="display:flex;align-items:center;gap:20px;flex-wrap:wrap">
          <div style="width:72px;height:72px;border-radius:50%;background:${t.color};color:#fff;display:flex;align-items:center;justify-content:center;font-size:32px;font-weight:bold">${escapeHtml(u.username.charAt(0).toUpperCase())}</div>
          <div style="flex:1;min-width:200px">
            <h2 style="margin:0">${escapeHtml(u.username)}</h2>
            <p style="margin:6px 0;color:#6b7280;font-style:italic">${data.signature ? '"' + escapeHtml(data.signature) + '"' : '（这家伙很懒，什么也没写）'}</p>
            <span style="background:${t.color};color:#fff;padding:4px 12px;border-radius:12px;font-weight:bold">${escapeHtml(tierName)}</span>
          </div>
        </div>
      </div>

      <div class="card">
        <h3>🏆 段位进度</h3>
        <div style="margin:12px 0;height:24px;background:#e5e7eb;border-radius:12px;overflow:hidden">
          <div style="width:${pct}%;height:100%;background:${t.color};transition:width 0.3s"></div>
        </div>
        <p>${t.rr} / ${t.next_rr} RR · ${progressText}</p>
        <p style="font-size:12px;color:#9ca3af">阈值：黑铁0 · 青铜600 · 白银900 · 黄金1200 · 铂金1500 · 钻石1800 · 战神2100 · 不朽2400 · 超凡入圣2700+</p>
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px">
        <div class="stat-card"><div class="num">${u.points}</div><div class="lbl">⭐ 积分</div></div>
        <div class="stat-card"><div class="num">${u.solved}</div><div class="lbl">✅ AC题数</div></div>
        <div class="stat-card"><div class="num" style="color:${heatColor}">🔥 ${data.heat}</div><div class="lbl">做题热度(7天)</div></div>
        <div class="stat-card"><div class="num">${data.heat_breakdown.submissions_7d}</div><div class="lbl">7天提交</div></div>
      </div>

      <div class="card">
        <h3>✏️ 修改个性签名</h3>
        <div style="display:flex;gap:8px">
          <input id="signature-input" value="${escapeHtml(data.signature)}" placeholder="来一句帅气的个性签名" maxlength="200" style="flex:1">
          <button class="btn btn-primary" data-action="save-signature">保存</button>
        </div>
      </div>
      <div class="card">
        <h3>🤖 AI 助手设置</h3>
        <p class="muted">填入你自己的 AI API Key（支持 DeepSeek 等 OpenAI 兼容服务），就可以在『AI 助手』里使用，费用由你的 Key 计费，不走积分。</p>
        <div style="display:flex;gap:8px">
          <input id="ai-key-input" type="password" value="" placeholder="sk-... 你的 API Key" style="flex:1">
          <button class="btn btn-primary" data-action="save-ai-key">保存 Key</button>
          <button class="btn" data-action="clear-ai-key">清除</button>
        </div>
        <p class="muted" id="ai-key-status" style="margin-top:6px;font-size:12px"></p>
      </div>
    `;
    // 加载 AI key 状态
    try {
      const st = await API.get('/api/ai/status');
      const el = document.getElementById('ai-key-status');
      if (el) el.textContent = st.configured ? '✅ 已配置 API Key（' + st.model + '）' : '⚠️ 尚未配置 API Key';
    } catch (e) { /* 忽略 */ }
  } catch (e) {
    page.innerHTML = '<div class="empty">' + escapeHtml(e.message) + '</div>';
  }
}

async function renderAiChat(page) {
  if (!requireLogin(() => renderAiChat(page))) return;
  page.innerHTML = `
    <h1 class="page-title">🤖 AI 助手</h1>
    <div class="card" id="ai-chat-box" style="height:420px;overflow-y:auto;display:flex;flex-direction:column;gap:10px;padding:14px">
      <div class="ai-msg ai-bot">你好！我是比特 OJ 的 AI 助手，可以帮你解答 C++ / 算法问题。先在「个人主页 → AI助手设置」填入你自己的 API Key 哦。</div>
    </div>
    <div style="display:flex;gap:8px;margin-top:10px">
      <input id="ai-input" placeholder="问点什么…（比如：解释什么是递归）" style="flex:1;padding:10px" onkeydown="if(event.key==='Enter'){aiSend();}">
      <button class="btn btn-primary" data-action="ai-send">发送</button>
    </div>
    <p class="muted" id="ai-status" style="margin-top:6px;font-size:12px"></p>
  `;
  // 显示配置状态
  try {
    const st = await API.get('/api/ai/status');
    if (!st.configured) {
      addAiMsg('⚠️ 你还没配置 API Key，去 <a href="#/me">个人主页 → AI 助手设置</a> 里填入吧。', 'ai-bot');
    }
  } catch (e) { /* 忽略 */ }
  window.__aiInputEl = document.getElementById('ai-input');
}

function addAiMsg(text, cls) {
  const box = document.getElementById('ai-chat-box');
  if (!box) return;
  const d = document.createElement('div');
  d.className = 'ai-msg ' + (cls || 'ai-bot');
  d.innerHTML = text;
  box.appendChild(d);
  box.scrollTop = box.scrollHeight;
}

async function aiSend() {
  const input = document.getElementById('ai-input');
  if (!input) return;
  const msg = input.value.trim();
  if (!msg) return;
  addAiMsg(escapeHtml(msg), 'ai-user');
  input.value = '';
  addAiMsg('思考中…', 'ai-bot');
  const status = $('ai-status');
  status.textContent = '';
  try {
    const r = await API.post('/api/ai/chat', { message: msg });
    // 替换最后一条“思考中”为回答
    const box = document.getElementById('ai-chat-box');
    const last = box ? box.querySelector('.ai-msg:last-child') : null;
    if (last && last.textContent === '思考中…') {
      last.innerHTML = escapeHtml(r.reply).replace(/\n/g, '<br>');
    } else {
      addAiMsg(escapeHtml(r.reply).replace(/\n/g, '<br>'), 'ai-bot');
    }
    status.textContent = '本次消耗约 ' + r.used + ' token（费用由你的 Key 计费）';
  } catch (e) {
    const box = document.getElementById('ai-chat-box');
    const last = box ? box.querySelector('.ai-msg:last-child') : null;
    if (last && last.textContent === '思考中…') last.remove();
    addAiMsg('❌ ' + escapeHtml(e.message), 'ai-bot');
  }
}

async function saveAiKey() {
  const input = $('ai-key-input');
  if (!input) return;
  const key = input.value.trim();
  if (!key) { alert('请输入 API Key'); return; }
  try {
    await API.patch('/api/ai/key', { api_key: key });
    alert('✅ API Key 已保存');
    input.value = '';
    renderMyProfile($('page'));
  } catch (e) { alert(e.message); }
}

async function clearAiKey() {
  try {
    await API.patch('/api/ai/key', { api_key: '' });
    alert('API Key 已清除');
    renderMyProfile($('page'));
  } catch (e) { alert(e.message); }
}

async function saveSignature() {
  const input = $('signature-input');
  if (!input) return;
  const sig = input.value.trim();
  try {
    await API.patch('/api/me', { signature: sig });
    alert('✅ 签名已修改');
    renderMyProfile($('page'));
  } catch (e) {
    alert(e.message);
  }
}

// ---------- 网盘 ----------
function formatSize(b) {
  if (b < 1024) return b + ' B';
  if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
  return (b / 1024 / 1024).toFixed(1) + ' MB';
}

async function renderFiles(page) {
  page.innerHTML = '<div class="empty">加载中…</div>';
  try {
    const data = await API.get('/api/files');
    const files = data.files || [];
    const used = data.used || 0;
    const quota = data.quota || 0;
    const singleMax = data.single_max || 20*1024*1024;
    const rows = files.length ? '<table class="data-table"><thead><tr><th>文件名</th><th>大小</th><th>上传者</th><th>下载</th><th>时间</th><th>操作</th></tr></thead><tbody>' +
      files.map(f => {
        const canDel = state.user && (state.user.role === 'admin' || state.user.username === f.uploaded_by);
        return '<tr>' +
          '<td>' + escapeHtml(f.filename) + '</td>' +
          '<td>' + formatSize(f.size) + '</td>' +
          '<td>' + escapeHtml(f.uploaded_by) + '</td>' +
          '<td>' + (f.downloads || 0) + '</td>' +
          '<td class="muted">' + escapeHtml(f.uploaded_at) + '</td>' +
          '<td><a class="btn btn-sm" href="/api/files/' + f.id + '/download" download>⬇️ 下载</a>' +
          (canDel ? ' <button class="btn btn-danger btn-sm" data-action="del-file" data-fid="' + f.id + '">删除</button>' : '') +
          '</td></tr>';
      }).join('') + '</tbody></table>' : '<div class="empty">还没有文件，上传第一个吧</div>';
    page.innerHTML =
      '<h1 class="page-title">📁 网盘</h1>' +
      '<div class="card"><h3>上传文件（最大 ' + formatSize(singleMax) + '）</h3>' +
        '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">' +
          '<input type="file" id="file-input" style="flex:1">' +
          '<button class="btn btn-primary" data-action="upload-file">📤 上传</button>' +
          '<span class="muted" id="upload-status"></span>' +
        '</div>' +
        '<p class="muted" style="margin-top:6px;font-size:12px">已用 ' + formatSize(used) + ' / ' + formatSize(quota) + '（你的角色：' + (data.role||'user') + '）</p>' +
        '</div>' +
      '<div class="card"><h3>文件列表 (' + files.length + ')</h3>' + rows + '</div>';
  } catch (e) {
    page.innerHTML = '<div class="empty">' + escapeHtml(e.message) + '</div>';
  }
}

async function uploadFile() {
  if (!requireLogin(() => uploadFile())) return;
  const input = $('file-input');
  if (!input || !input.files || !input.files[0]) { alert('请先选文件'); return; }
  const file = input.files[0];
  // 检查单文件大小（动态读取 limits）
  try {
    const info = await API.get('/api/files');
    if (file.size > (info.single_max || 20*1024*1024)) {
      alert('文件超过 ' + formatSize(info.single_max||20*1024*1024) + ' 限制');
      return;
    }
  } catch (e) { /* 取不到 limits 也不挡 */ }
  const status = $('upload-status');
  status.textContent = '上传中…';
  try {
    const fd = new FormData();
    fd.append('file', file);
    const r = await fetch('/api/files/upload', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + API.token },
      body: fd
    });
    const d = await r.json();
    if (!r.ok || d.ok === false) throw new Error(d.msg || ('上传失败 ' + r.status));
    status.textContent = '✅ ' + file.name + ' 上传成功';
    input.value = '';
    renderFiles($('page'));
  } catch (e) {
    status.textContent = '❌ ' + e.message;
  }
}

async function deleteFile(fid) {
  if (!confirm('确定删除这个文件？')) return;
  try {
    await API.del('/api/files/' + fid);
    renderFiles($('page'));
  } catch (e) {
    alert(e.message);
  }
}

// ---------- 题目详情 + 提交 ----------
async function renderProblem(id, page) {
  page.innerHTML = '<div class="empty">加载中…</div>';
  let data;
  try { data = await API.get('/api/problems/' + id); }
  catch (e) { page.innerHTML = `<div class="empty">${escapeHtml(e.message)}</div>`; return; }
  const p = data.problem;

  page.innerHTML = `
    <div class="card">
      <h2>#${p.id} ${escapeHtml(p.title)}</h2>
      <div class="problem-meta">
        <span>时间限制 <b>${p.time_limit}s</b></span>
        <span>内存限制 <b>${p.memory_limit}MB</b></span>
        <span>难度 <b>${p.difficulty}</b></span>
      </div>
      <h3>题目描述</h3><div class="desc-text">${escapeHtml(p.description)}</div>
      <h3>输入格式</h3><div class="desc-text">${escapeHtml(p.input_desc)}</div>
      <h3>输出格式</h3><div class="desc-text">${escapeHtml(p.output_desc)}</div>
      <h3>样例</h3>
      ${(p.samples || []).map((s, i) => `
        <div><b>样例 ${i + 1} 输入</b></div>
        <div class="sample-box">${escapeHtml(s.input)}</div>
        <div><b>样例 ${i + 1} 输出</b></div>
        <div class="sample-box">${escapeHtml(s.output)}</div>`).join('')}
      <h3>提交代码（Monaco，Consolas，回车自动缩进）</h3>
      <div id="code-editor" class="editor-wrap"></div>
      <button class="btn btn-primary" data-action="submit-code" data-id="${p.id}">🚀 提交评测</button>
      <div id="result-panel"></div>
    </div>`;

  try {
    await createEditor($('code-editor'));
  } catch (e) {
    $('result-panel').innerHTML = `<div class="detail-box">${escapeHtml(e.message)}</div>`;
  }
}

async function submitCode(pid) {
  if (!requireLogin(() => submitCode(pid))) return;
  const code = getEditorCode();
  if (!code.trim()) { alert('代码是空的，婆罗门都没东西搬！'); return; }
  const panel = $('result-panel');
  const btn = document.querySelector('[data-action="submit-code"]');
  panel.innerHTML = '<div class="empty">⌛ 判题中，婆罗门正在一刻不停地搬盘子…</div>';
  if (btn) btn.disabled = true;
  try {
    const r = await API.post('/api/submit', { problem_id: pid, code });
    const cls = 'badge badge-' + r.status.toLowerCase();
    panel.innerHTML = `
      <div class="card" style="margin-top:12px">
        <div class="result-line">结果：<span class="${cls}">${r.status}</span>
          　耗时 <b>${r.time_ms}ms</b>　内存 <b>${r.memory_kb}KB</b></div>
        ${r.detail ? `<div class="detail-box">${escapeHtml(r.detail)}</div>` : ''}
        ${r.status === 'AC' ? '<div class="muted" style="margin-top:8px">🎉 AC！+10 积分到手（首 AC）。</div>' : ''}
      </div>`;
    await refreshUser();
  } catch (e) {
    panel.innerHTML = `<div class="detail-box">${escapeHtml(e.message)}</div>`;
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ---------- 提交记录 ----------
async function renderSubmissions(page) {
  if (!requireLogin(() => renderSubmissions(page))) { page.innerHTML = ''; return; }
  page.innerHTML = '<div class="empty">加载中…</div>';
  try {
    const isAdmin = state.user && state.user.role === 'admin';
    const data = await API.get('/api/submissions' + (isAdmin ? '?all=1' : ''));
    const rows = data.submissions.map(s => `
      <tr>
        <td>${s.id}</td>
        <td>${escapeHtml(s.username)}</td>
        <td><a class="link" href="#/problem/${s.problem_id}">${escapeHtml(s.title)}</a></td>
        <td><span class="badge badge-${s.status.toLowerCase()}">${s.status}</span></td>
        <td>${s.time_ms}ms</td>
        <td>${s.memory_kb}KB</td>
        <td>${escapeHtml(s.created_at)}</td>
      </tr>`).join('');
    page.innerHTML = `
      <h1 class="page-title">提交记录${isAdmin ? '（全部用户）' : ''}</h1>
      <div class="card"><table>
        <thead><tr><th>#</th><th>用户</th><th>题目</th><th>状态</th><th>耗时</th><th>内存</th><th>时间</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="7" class="empty">还没有提交，快去当第一个吃螃蟹的人</td></tr>'}</tbody>
      </table></div>`;
  } catch (e) {
    page.innerHTML = `<div class="empty">${escapeHtml(e.message)}</div>`;
  }
}

// ---------- 排行榜 ----------
async function renderRank(page) {
  page.innerHTML = '<div class="empty">加载中…</div>';
  try {
    const data = await API.get('/api/ranklist');
    const top3 = ['🥇', '🥈', '🥉'];
    const podium = data.ranklist.slice(0, 3).map((u, i) => `
      <div class="p-item">
        <span class="p-icon">${top3[i]}</span>
        <span class="p-name">${escapeHtml(u.username)}</span><br>
        <span class="muted">${u.solved} 题 · ${u.points} 分</span>
      </div>`).join('');
    const rows = data.ranklist.map(u => `
      <tr>
        <td>${u.rank}</td><td>${escapeHtml(u.username)}</td>
        <td>${u.solved}</td><td>${u.points}</td>
      </tr>`).join('');
    page.innerHTML = `
      <h1 class="page-title">排行榜</h1>
      <div class="card">${podium ? `<div class="rank-podium">${podium}</div>` : ''}
        <table>
          <thead><tr><th>名次</th><th>用户</th><th>AC 题数</th><th>积分</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="4" class="empty">榜上无人，都去刷题了？</td></tr>'}</tbody>
        </table>
      </div>`;
  } catch (e) {
    page.innerHTML = `<div class="empty">${escapeHtml(e.message)}</div>`;
  }
}

// ---------- 训练 ----------
async function renderTrainings(page) {
  page.innerHTML = '<div class="empty">加载中…</div>';
  try {
    const data = await API.get('/api/trainings');
    const cards = data.trainings.map(t => `
      <div class="card">
        <h2>${escapeHtml(t.title)}</h2>
        <p class="desc-text">${escapeHtml(t.description)}</p>
        <p class="muted">收录题目：</p>
        <p>${(t.problems || []).map(p =>
          `<a class="link" href="#/problem/${p.id}">${escapeHtml(p.title)}</a>`).join(' &nbsp;·&nbsp; ') || '（空的）'}</p>
      </div>`).join('');
    page.innerHTML = `<h1 class="page-title">训练</h1>${
      cards || '<div class="empty">暂无训练计划</div>'}`;
  } catch (e) {
    page.innerHTML = `<div class="empty">${escapeHtml(e.message)}</div>`;
  }
}

// ---------- 公告 ----------
async function renderAnnouncements(page) {
  page.innerHTML = '<div class="empty">加载中…</div>';
  try {
    const data = await API.get('/api/announcements');
    const cards = data.announcements.map(a => `
      <div class="card">
        <h2>📢 ${escapeHtml(a.title)}</h2>
        <p class="desc-text">${escapeHtml(a.content)}</p>
        <p class="muted">${escapeHtml(a.created_at)}</p>
      </div>`).join('');
    page.innerHTML = `<h1 class="page-title">公告</h1>${
      cards || '<div class="empty">暂无公告</div>'}`;
  } catch (e) {
    page.innerHTML = `<div class="empty">${escapeHtml(e.message)}</div>`;
  }
}

// ---------- 班级 ----------
async function renderClasses(page) {
  page.innerHTML = '<div class="empty">加载中…</div>';
  try {
    const data = await API.get('/api/classes');
    const cards = data.classes.map(c => {
      const btn = c.joined
        ? `<button class="btn btn-danger btn-sm" data-action="leave-class" data-id="${c.id}">退出班级</button>`
        : `<button class="btn btn-primary btn-sm" data-action="join-class" data-id="${c.id}" data-code="${escapeHtml(c.invite_code)}">加入班级</button>`;
      return `
      <div class="card">
        <h2>🏫 ${escapeHtml(c.name)}</h2>
        <p class="desc-text">${escapeHtml(c.description)}</p>
        <p class="muted">邀请码：<b>${escapeHtml(c.invite_code)}</b> · 成员 ${c.member_count} 人${c.joined ? ' · 你已加入 ✅' : ''}</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          ${btn}
          <a class="btn btn-sm" href="#/class/${c.id}">进入班级 →</a>
        </div>
      </div>`;
    }).join('');
    page.innerHTML = `<h1 class="page-title">班级</h1>
      <div style="margin-bottom:12px">
        ${(state.user && (state.user.role === 'admin' || state.user.role === 'class_admin'))
          ? '<button class="btn btn-primary" data-action="admin-add-class-prompt">＋ 创建班级</button>'
          : ''}
      </div>
      ${cards || '<div class="empty">暂无班级，让管理员建一个吧</div>'}`;
  } catch (e) {
    page.innerHTML = `<div class="empty">${escapeHtml(e.message)}</div>`;
  }
}

async function joinClass(id, code) {
  if (!requireLogin(() => joinClass(id, code))) return;
  try {
    const r = await API.post('/api/classes/join', { invite_code: code });
    alert('✅ 已加入『' + r.class_name + '』');
    await refreshUser();
    renderClasses($('page'));
  } catch (e) { alert(e.message); }
}

async function leaveClass(id) {
  try {
    await API.post('/api/classes/leave', { id });
    alert('已退出班级');
    renderClasses($('page'));
  } catch (e) { alert(e.message); }
}

// ========== 班级详情页 ==========
async function renderClass(cid, page) {
  page.innerHTML = '<div class="empty">加载中…</div>';
  try {
    const d = await API.get('/api/class/' + cid);
    const cls = d.class;
    const isAdmin = cls.is_admin;
    const adminBtn = (action, text, extra = '') =>
      `<button class="btn btn-primary btn-sm" data-action="${action}" data-cid="${cid}" ${extra}>${text}</button>`;

    const probRows = d.problems.map(p => `
      <tr>
        <td><a class="link" href="#/problem/${p.id}">#${p.id} ${escapeHtml(p.title)}</a></td>
        <td><span class="diff-badge diff-${Math.min(p.difficulty, 4)}">L${p.difficulty}</span></td>
        ${isAdmin ? `<td><button class="btn btn-danger btn-sm" data-action="class-del-problem" data-cid="${cid}" data-pid="${p.id}">移除</button></td>` : ''}
      </tr>`).join('');

    const renderList = (arr, type) => arr.map(x => `
      <div class="card" style="margin-top:8px">
        <h3 style="margin:0">${escapeHtml(x.title)}</h3>
        ${x.description ? `<p class="desc-text" style="margin:4px 0">${escapeHtml(x.description)}</p>` : ''}
        ${x.deadline ? `<p class="muted">截止：${escapeHtml(x.deadline)}</p>` : ''}
        ${x.start || x.end ? `<p class="muted">${escapeHtml(x.start || '?')} ~ ${escapeHtml(x.end || '?')}</p>` : ''}
        <p class="muted">题目数：${(x.problems || []).length}</p>
        ${isAdmin ? `<button class="btn btn-danger btn-sm" data-action="class-del-${type}" data-cid="${cid}" data-tid="${x.id}">删除</button>` : ''}
      </div>`).join('');

    const memberList = cls.members.map(m => `<span class="tag">${escapeHtml(m)}</span>`).join(' ') || '<span class="muted">暂无成员</span>';

    page.innerHTML = `
      <h1 class="page-title">🏫 ${escapeHtml(cls.name)}</h1>
      <div class="card">
        <p class="desc-text">${escapeHtml(cls.description || '(暂无描述)')}</p>
        <p class="muted">邀请码：<b style="color:#f59e0b">${escapeHtml(cls.invite_code)}</b> · 成员 ${cls.members.length} 人${cls.joined ? ' · 你已加入 ✅' : ''}${isAdmin ? ' · 你是管理员 👑' : ''}</p>
        <a class="btn btn-sm" href="#/classes">← 返回班级列表</a>
      </div>

      <div class="card">
        <h2>👥 成员 (${cls.members.length})</h2>
        <div style="line-height:2">${memberList}</div>
      </div>

      <div class="card">
        <h2>📚 班级题库 (${d.problems.length}) ${isAdmin ? adminBtn('class-add-problem', '+ 添加题目', 'data-prompt="输入题目ID"') : ''}</h2>
        ${d.problems.length ? `<table class="data-table">
          <thead><tr><th>题目</th><th>难度</th>${isAdmin ? '<th>操作</th>' : ''}</tr></thead>
          <tbody>${probRows}</tbody>
        </table>` : '<div class="empty">题库还是空的，管理员可以加题进来</div>'}
      </div>

      <div class="card">
        <h2>🏆 比赛 (${d.contests.length}) ${isAdmin ? adminBtn('class-add-contest', '+ 创建比赛') : ''}</h2>
        ${d.contests.length ? renderList(d.contests, 'contest') : '<div class="empty">暂无比赛</div>'}
      </div>

      <div class="card">
        <h2>🎯 训练 (${d.trainings.length}) ${isAdmin ? adminBtn('class-add-training', '+ 创建训练') : ''}</h2>
        ${d.trainings.length ? renderList(d.trainings, 'training') : '<div class="empty">暂无训练</div>'}
      </div>

      <div class="card">
        <h2>📝 作业 (${d.homeworks.length}) ${isAdmin ? adminBtn('class-add-homework', '+ 创建作业') : ''}</h2>
        ${d.homeworks.length ? renderList(d.homeworks, 'homework') : '<div class="empty">暂无作业</div>'}
      </div>
    `;
  } catch (e) {
    page.innerHTML = `<div class="empty">${escapeHtml(e.message)}</div>`;
  }
}

async function classAddProblem(cid) {
  const pid = prompt('输入要添加到班级题库的题目ID：');
  if (!pid) return;
  try {
    await API.post(`/api/admin/class/${cid}/problem`, { problem_id: parseInt(pid) });
    renderClass(cid, $('page'));
  } catch (e) { alert(e.message); }
}
async function classDelProblem(cid, pid) {
  openConfirmModal('从班级题库移除这道题？', async () => {
    try { await API.del(`/api/admin/class/${cid}/problem/${pid}`); renderClass(cid, $('page')); }
    catch (e) { alert(e.message); }
  });
}
async function classAddContest(cid) {
  const title = prompt('比赛名称：'); if (!title) return;
  const problemsStr = prompt('题目ID列表（逗号分隔，如 4,5,6）：'); if (!problemsStr) return;
  const problems = problemsStr.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n));
  try {
    await API.post(`/api/admin/class/${cid}/contest`, { title, problems });
    renderClass(cid, $('page'));
  } catch (e) { alert(e.message); }
}
async function classDelContest(cid, tid) {
  openConfirmModal('删除这个比赛？', async () => {
    try { await API.del(`/api/admin/class/${cid}/contest/${tid}`); renderClass(cid, $('page')); }
    catch (e) { alert(e.message); }
  });
}
async function classAddTraining(cid) {
  const title = prompt('训练名称：'); if (!title) return;
  const description = prompt('训练描述（可留空）：') || '';
  const problemsStr = prompt('题目ID列表（逗号分隔）：'); if (!problemsStr) return;
  const problems = problemsStr.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n));
  try {
    await API.post(`/api/admin/class/${cid}/training`, { title, description, problems });
    renderClass(cid, $('page'));
  } catch (e) { alert(e.message); }
}
async function classDelTraining(cid, tid) {
  openConfirmModal('删除这个训练？', async () => {
    try { await API.del(`/api/admin/class/${cid}/training/${tid}`); renderClass(cid, $('page')); }
    catch (e) { alert(e.message); }
  });
}
async function classAddHomework(cid) {
  const title = prompt('作业名称：'); if (!title) return;
  const deadline = prompt('截止日期（可留空）：') || '';
  const problemsStr = prompt('题目ID列表（逗号分隔）：'); if (!problemsStr) return;
  const problems = problemsStr.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n));
  try {
    await API.post(`/api/admin/class/${cid}/homework`, { title, deadline, problems });
    renderClass(cid, $('page'));
  } catch (e) { alert(e.message); }
}
async function classDelHomework(cid, tid) {
  openConfirmModal('删除这个作业？', async () => {
    try { await API.del(`/api/admin/class/${cid}/homework/${tid}`); renderClass(cid, $('page')); }
    catch (e) { alert(e.message); }
  });
}

// ---------- 商城 ----------
async function renderShop(page) {
  page.innerHTML = '<div class="empty">加载中…</div>';
  try {
    const data = await API.get('/api/shop');
    const cards = data.items.map(it => `
      <div class="shop-card">
        <div class="shop-icon">${escapeHtml(it.icon)}</div>
        <div><b>${escapeHtml(it.name)}</b></div>
        <div class="muted">${escapeHtml(it.description)}</div>
        <div class="shop-price">⭐ ${it.price} 积分</div>
        <div class="muted" style="margin-bottom:10px">库存 ${it.stock}</div>
        <button class="btn btn-primary btn-sm" data-action="buy-item" data-id="${it.id}"
          ${it.stock <= 0 ? 'disabled' : ''}>购买</button>
      </div>`).join('');

    let mine = '';
    if (API.token) {
      try {
        const m = await API.get('/api/shop/mine');
        mine = `<div class="card"><h3>🧳 我的物品</h3>
          ${m.items.length ? `<table><thead><tr><th>物品</th><th>花费</th><th>时间</th></tr></thead><tbody>
            ${m.items.map(x => `<tr><td>${escapeHtml(x.item_name)}</td><td>${x.price} 分</td><td>${escapeHtml(x.created_at)}</td></tr>`).join('')}
          </tbody></table>` : '<p class="muted">还没买东西，积分攒着下崽吗？</p>'}
        </div>`;
      } catch (e) { /* 忽略 */ }
    }
    page.innerHTML = `
      <h1 class="page-title">商城</h1>
      <div class="shop-grid">${cards || '<div class="empty">货架空空</div>'}</div>
      <div style="height:16px"></div>${mine}`;
  } catch (e) {
    page.innerHTML = `<div class="empty">${escapeHtml(e.message)}</div>`;
  }
}

async function buyItem(itemId) {
  if (!requireLogin(() => buyItem(itemId))) return;
  try {
    const r = await API.post('/api/shop/buy', { item_id: itemId });
    alert('🎉 买到了『' + r.item_name + '』，剩余 ' + r.points_left + ' 积分');
    await refreshUser();
    renderShop($('page'));
  } catch (e) { alert(e.message); }
}

// ---------- 管理后台 ----------
let adminData = null;
let currentAdminTab = 'problems';
let adminEditingId = null;

async function renderAdmin(page) {
  if (!requireLogin(() => renderAdmin(page))) { page.innerHTML = ''; return; }
  let u = state.user;
  if (!u) u = await refreshUser();
  if (!u || u.role !== 'admin') {
    page.innerHTML = '<div class="empty">🔒 这是管理员的房间，闲人免进。</div>';
    return;
  }
  page.innerHTML = '<div class="empty">加载中…</div>';
  try {
    const [stats, problems, anns, trainings, classes, shop, users] = await Promise.all([
      API.get('/api/admin/stats'),
      API.get('/api/problems'),
      API.get('/api/announcements'),
      API.get('/api/trainings'),
      API.get('/api/classes'),
      API.get('/api/shop'),
      API.get('/api/admin/users'),
    ]);
    adminData = {
      stats, problems: problems.problems, anns: anns.announcements,
      trainings: trainings.trainings, classes: classes.classes, shop: shop.items, users: users.users,
    };
  } catch (e) {
    page.innerHTML = `<div class="empty">${escapeHtml(e.message)}</div>`;
    return;
  }
  const st = adminData.stats;
  page.innerHTML = `
    <h1 class="page-title">🛠 管理后台</h1>
    <div class="stats-grid">
      <div class="stat-card"><div class="num">${st.users}</div><div class="lbl">用户</div></div>
      <div class="stat-card"><div class="num">${st.problems}</div><div class="lbl">题目</div></div>
      <div class="stat-card"><div class="num">${st.submissions}</div><div class="lbl">提交</div></div>
      <div class="stat-card"><div class="num">${st.accepted}</div><div class="lbl">AC</div></div>
    </div>
    <div class="admin-tabs">
      <button class="btn" data-action="admin-tab" data-atab="problems">题目管理</button>
      <button class="btn" data-action="admin-tab" data-atab="anns">公告</button>
      <button class="btn" data-action="admin-tab" data-atab="trainings">训练</button>
      <button class="btn" data-action="admin-tab" data-atab="classes">班级</button>
      <button class="btn" data-action="admin-tab" data-atab="shop">商城</button>
      <button class="btn" data-action="admin-tab" data-atab="users">用户与角色</button>
      <button class="btn" data-action="admin-tab" data-atab="points">⭐ 发放积分</button>
    </div>
    <div class="admin-panel" id="apanel-problems">${adminProblemPanel()}</div>
    <div class="admin-panel" id="apanel-anns">${adminAnnPanel()}</div>
    <div class="admin-panel" id="apanel-trainings">${adminTrainingPanel()}</div>
    <div class="admin-panel" id="apanel-classes">${adminClassPanel()}</div>
    <div class="admin-panel" id="apanel-shop">${adminShopPanel()}</div>
    <div class="admin-panel" id="apanel-users">${adminUsersPanel()}</div>
    <div class="admin-panel" id="apanel-points">${adminPointsPanel()}</div>`;
  switchAdminTab(currentAdminTab);
}

function switchAdminTab(tab) {
  currentAdminTab = tab;
  document.querySelectorAll('.admin-tabs .btn').forEach(b =>
    b.classList.toggle('active', b.dataset.atab === tab));
  document.querySelectorAll('.admin-panel').forEach(p => p.classList.remove('show'));
  const el = $('apanel-' + tab);
  if (el) el.classList.add('show');
}

function adminProblemPanel() {
  const ps = adminData.problems;
  return `
    <div class="card">
      <h3 id="admin-form-title">新增题目</h3>
      <div class="form-grid">
        <div><label>题目标题 *</label><input id="p-title" placeholder="如：A+B Problem"></div>
        <div><label>难度 (1-4)</label><input id="p-diff" type="number" min="1" max="4" value="1"></div>
        <div><label>时间限制（秒）</label><input id="p-time" type="number" min="1" value="1"></div>
        <div><label>内存限制（MB）</label><input id="p-mem" type="number" min="16" value="256"></div>
        <div style="grid-column:1/-1"><label>题目描述</label><textarea id="p-desc"></textarea></div>
        <div style="grid-column:1/-1"><label>输入格式</label><textarea id="p-input"></textarea></div>
        <div style="grid-column:1/-1"><label>输出格式</label><textarea id="p-output"></textarea></div>
        <div><label>标签（逗号分隔）</label><input id="p-tags" placeholder="递推, 递归"></div>
        <div><label>样例（JSON）</label>
          <textarea id="p-samples">[{"input":"1 2","output":"3"}]</textarea></div>
        <div style="grid-column:1/-1"><label>测试点（JSON，格式 [{"input":"...","output":"..."}]，含 \n）</label>
          <textarea id="p-testcases">[{"input":"1 2\\n","output":"3\\n"}]</textarea></div>
      </div>
      <button class="btn btn-primary" data-action="admin-save-problem">保存题目</button>
      <button class="btn" id="admin-cancel-edit" data-action="admin-cancel-edit" style="display:none">取消编辑</button>
    </div>
    <div class="card">
      <h3>📦 JSON 批量导入</h3>
      <p class="muted">格式：{"problems":[{title, description, input_desc, output_desc, samples, time_limit, memory_limit, difficulty, tags, testcases}]}，samples 和 testcases 都是 [{input,output}] 数组。</p>
      <textarea id="p-import" placeholder='{"problems":[{"title":"样例题","description":"...","input_desc":"...","output_desc":"...","samples":[],"testcases":[{"input":"1","output":"1"}]}]}'></textarea>
      <button class="btn btn-primary" data-action="admin-import">导入</button>
    </div>
    <div class="card">
      <h3>题目列表（${ps.length} 道）</h3>
      <table>
        <thead><tr><th>#</th><th>标题</th><th>难度</th><th>操作</th></tr></thead>
        <tbody>
          ${ps.map(p => `<tr>
            <td>${p.id}</td><td>${escapeHtml(p.title)}</td>
            <td>${p.difficulty}</td>
            <td>
              <button class="btn btn-sm" data-action="admin-edit-problem" data-id="${p.id}">编辑</button>
              <button class="btn btn-danger btn-sm" data-action="admin-del-problem" data-id="${p.id}">删除</button>
            </td></tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

function adminAnnPanel() {
  return `
    <div class="card">
      <h3>发布公告</h3>
      <label>标题 *</label><input id="a-title">
      <label>内容</label><textarea id="a-content"></textarea>
      <button class="btn btn-primary" data-action="admin-add-ann">发布</button>
    </div>
    <div class="card"><h3>已有公告</h3>
      <table><thead><tr><th>标题</th><th>时间</th><th>操作</th></tr></thead><tbody>
        ${adminData.anns.map(a => `<tr>
          <td>${escapeHtml(a.title)}</td><td>${escapeHtml(a.created_at)}</td>
          <td><button class="btn btn-danger btn-sm" data-action="admin-del-ann" data-id="${a.id}">删除</button></td>
        </tr>`).join('')}
      </tbody></table>
    </div>`;
}

function adminTrainingPanel() {
  return `
    <div class="card">
      <h3>新建训练</h3>
      <label>训练名 *</label><input id="t-title">
      <label>描述</label><textarea id="t-desc"></textarea>
      <label>题目 ID（逗号分隔，如 1,2,3）</label><input id="t-pids" placeholder="1,2,3">
      <button class="btn btn-primary" data-action="admin-add-training">创建</button>
    </div>
    <div class="card"><h3>已有训练</h3>
      <table><thead><tr><th>名称</th><th>题目</th><th>操作</th></tr></thead><tbody>
        ${adminData.trainings.map(t => `<tr>
          <td>${escapeHtml(t.title)}</td>
          <td>${(t.problems || []).map(p => escapeHtml(p.title)).join('、') || '无'}</td>
          <td><button class="btn btn-danger btn-sm" data-action="admin-del-training" data-id="${t.id}">删除</button></td>
        </tr>`).join('')}
      </tbody></table>
    </div>`;
}

function adminClassPanel() {
  return `
    <div class="card">
      <h3>新建班级</h3>
      <div class="form-grid">
        <div><label>班级名 *</label><input id="c-name"></div>
        <div><label>邀请码</label><input id="c-code" placeholder="如 CPLUS1"></div>
      </div>
      <label>描述</label><textarea id="c-desc"></textarea>
      <button class="btn btn-primary" data-action="admin-add-class">创建</button>
    </div>
    <div class="card"><h3>已有班级</h3>
      <table><thead><tr><th>名称</th><th>邀请码</th><th>成员</th><th>操作</th></tr></thead><tbody>
        ${adminData.classes.map(c => `<tr>
          <td>${escapeHtml(c.name)}</td><td>${escapeHtml(c.invite_code)}</td>
          <td>${c.member_count} 人</td>
          <td><button class="btn btn-danger btn-sm" data-action="admin-del-class" data-id="${c.id}">删除</button></td>
        </tr>`).join('')}
      </tbody></table>
    </div>`;
}

function adminUsersPanel() {
  const roleBadge = r => {
    if (r === 'admin') return '<span class="tag" style="background:#dc2626;color:#fff">超级管理员</span>';
    if (r === 'class_admin') return '<span class="tag" style="background:#f59e0b;color:#fff">班级管理员</span>';
    return '<span class="tag">普通用户</span>';
  };
  return `
    <div class="card">
      <h3>用户与角色</h3>
      <p class="muted">说明：<b>超级管理员</b>拥有所有权限；<b>班级管理员</b>仅能创建/管理班级，无法进入此后台。</p>
      <table><thead><tr><th>ID</th><th>用户名</th><th>角色</th><th>积分</th><th>AC数</th><th>注册时间</th><th>操作</th></tr></thead><tbody>
        ${adminData.users.map(u => `<tr>
          <td>#${u.id}</td>
          <td>${escapeHtml(u.username)}</td>
          <td>${roleBadge(u.role)}</td>
          <td>${u.points}</td>
          <td>${u.solved}</td>
          <td>${escapeHtml(u.created_at)}</td>
          <td>
            <select data-action="change-role" data-uid="${u.id}" data-username="${escapeHtml(u.username)}">
              <option value="user" ${u.role==='user'?'selected':''}>普通用户</option>
              <option value="class_admin" ${u.role==='class_admin'?'selected':''}>班级管理员</option>
              <option value="admin" ${u.role==='admin'?'selected':''}>超级管理员</option>
            </select>
            <button class="btn btn-danger btn-sm" data-action="admin-del-user" data-id="${u.id}" data-username="${escapeHtml(u.username)}" style="margin-left:6px">删除</button>
          </td>
        </tr>`).join('')}
      </tbody></table>
    </div>`;
}

async function grantPoints() {
  const amount = parseInt($('pts-amount').value);
  if (!amount || amount <= 0) { alert('请输入积分数（大于 0）'); return; }
  const ids = [];
  document.querySelectorAll('.pts-chk:checked').forEach(c => ids.push(parseInt(c.dataset.uid)));
  if (!ids.length) { alert('请先勾选用户'); return; }
  if (!confirm('确认给 ' + ids.length + ' 位用户每人发放 ' + amount + ' 积分？')) return;
  const status = $('pts-status');
  status.textContent = '发放中…';
  try {
    const r = await API.post('/api/admin/points/grant', { user_ids: ids, points: amount });
    status.textContent = '✅ 已给 ' + r.granted + ' 人各发 ' + r.points + ' 积分';
    await renderAdmin($('page'));
  } catch (e) {
    status.textContent = '❌ ' + e.message;
  }
}

function adminPointsPanel() {
  const rows = adminData.users.map(u => `
    <tr>
      <td><input type="checkbox" class="pts-chk" data-uid="${u.id}"></td>
      <td>#${u.id}</td>
      <td>${escapeHtml(u.username)}</td>
      <td>${u.role === 'admin' ? '<span class="tag" style="background:#dc2626;color:#fff">管理员</span>' : u.role === 'class_admin' ? '<span class="tag" style="background:#f59e0b;color:#fff">班级管理员</span>' : '<span class="tag">普通</span>'}</td>
      <td>${u.points}</td>
    </tr>`).join('');
  return `
    <div class="card">
      <h3>⭐ 批量发放积分</h3>
      <p class="muted">勾选用户（支持全选），填积分数量，一键发放。排行榜和商城即时生效。</p>
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:10px;flex-wrap:wrap">
        <button class="btn btn-sm" data-action="pts-select-all">☑️ 全选</button>
        <button class="btn btn-sm" data-action="pts-select-none">⬜ 全不选</button>
        <label style="margin-left:8px">积分数量</label>
        <input id="pts-amount" type="number" min="1" value="10" style="width:90px">
        <button class="btn btn-primary" data-action="pts-grant">💰 发放积分</button>
        <span class="muted" id="pts-status"></span>
      </div>
      <table><thead><tr><th>选择</th><th>ID</th><th>用户名</th><th>角色</th><th>当前积分</th></tr></thead><tbody>${rows}</tbody></table>
    </div>`;
}

function adminShopPanel() {
  return `
    <div class="card">
      <h3>上架商品</h3>
      <div class="form-grid">
        <div><label>名称 *</label><input id="s-name"></div>
        <div><label>图标（emoji）</label><input id="s-icon" value="🎁"></div>
        <div><label>价格（积分）</label><input id="s-price" type="number" min="0" value="10"></div>
        <div><label>库存</label><input id="s-stock" type="number" min="0" value="100"></div>
      </div>
      <label>描述</label><textarea id="s-desc"></textarea>
      <button class="btn btn-primary" data-action="admin-add-item">上架</button>
    </div>
    <div class="card"><h3>商品列表</h3>
      <table><thead><tr><th>图标</th><th>名称</th><th>价格</th><th>库存</th><th>操作</th></tr></thead><tbody>
        ${adminData.shop.map(it => `<tr>
          <td>${escapeHtml(it.icon)}</td><td>${escapeHtml(it.name)}</td>
          <td>${it.price}</td><td>${it.stock}</td>
          <td><button class="btn btn-danger btn-sm" data-action="admin-del-item" data-id="${it.id}">删除</button></td>
        </tr>`).join('')}
      </tbody></table>
    </div>`;
}

async function adminSaveProblem() {
  const v = (id) => $(id).value.trim();
  const title = v('p-title');
  if (!title) { alert('标题不能为空'); return; }
  const parseArr = (s) => {
    try { const j = JSON.parse(s || '[]'); return Array.isArray(j) ? j : null; } catch { return null; }
  };
  const samples = parseArr(v('p-samples'));
  const testcases = parseArr(v('p-testcases'));
  if (samples === null) { alert('样例 JSON 格式不对'); return; }
  if (testcases === null) { alert('测试点 JSON 格式不对'); return; }
  const body = {
    title,
    description: v('p-desc'),
    input_desc: v('p-input'),
    output_desc: v('p-output'),
    time_limit: parseInt(v('p-time')) || 1,
    memory_limit: parseInt(v('p-mem')) || 256,
    difficulty: parseInt(v('p-diff')) || 1,
    tags: v('p-tags').split(/[,，]/).map(s => s.trim()).filter(Boolean),
    samples,
    testcases,
  };
  try {
    if (adminEditingId) await API.put('/api/admin/problem/' + adminEditingId, body);
    else await API.post('/api/admin/problem', body);
    alert('✅ 题目已保存');
    adminResetProblemForm();
    await renderAdmin($('page'));
  } catch (e) { alert(e.message); }
}

async function adminEditProblem(id) {
  try {
    const d = await API.get('/api/problems/' + id);
    const p = d.problem;
    adminEditingId = p.id;
    $('p-title').value = p.title || '';
    $('p-diff').value = p.difficulty || 1;
    $('p-time').value = p.time_limit || 1;
    $('p-mem').value = p.memory_limit || 256;
    $('p-desc').value = p.description || '';
    $('p-input').value = p.input_desc || '';
    $('p-output').value = p.output_desc || '';
    $('p-tags').value = (p.tags || []).join(',');
    $('p-samples').value = JSON.stringify(p.samples || []);
    $('p-testcases').value = JSON.stringify(p.testcases || []);
    $('admin-form-title').textContent = '编辑题目 #' + p.id;
    $('admin-cancel-edit').style.display = '';
    switchAdminTab('problems');
    window.scrollTo(0, 0);
  } catch (e) { alert(e.message); }
}

function adminResetProblemForm() {
  adminEditingId = null;
  ['p-title', 'p-desc', 'p-input', 'p-output', 'p-tags'].forEach(id => $(id).value = '');
  $('p-diff').value = 1; $('p-time').value = 1; $('p-mem').value = 256;
  $('p-samples').value = '[{"input":"1 2","output":"3"}]';
  $('p-testcases').value = '[{"input":"1 2\\n","output":"3\\n"}]';
  $('admin-form-title').textContent = '新增题目';
  $('admin-cancel-edit').style.display = 'none';
}

// ---------- 全局事件委托 ----------
document.addEventListener('change', async (e) => {
  if (e.target.dataset.action === 'change-role') {
    const uid = parseInt(e.target.dataset.uid);
    const username = e.target.dataset.username;
    const role = e.target.value;
    const roleName = role === 'admin' ? '超级管理员' : role === 'class_admin' ? '班级管理员' : '普通用户';
    if (!confirm(`将 ${username} 设置为 ${roleName}？`)) {
      // 撤销选择
      e.target.value = adminData.users.find(u => u.id === uid)?.role || 'user';
      return;
    }
    try {
      await API.post(`/api/admin/user/${uid}/role`, { role });
      alert('✅ 角色已更新');
      await renderAdmin($('page'));
    } catch (err) { alert(err.message); e.target.value = 'user'; }
  }
});

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const act = el.dataset.action;

  switch (act) {
    case 'show-login': openAuthModal(); break;

    case 'logout':
      API.post('/api/logout').catch(() => {});
      API.setToken('');
      state.user = null;
      location.hash = '#/problems';
      refreshUser();
      break;

    case 'delete-account':
      openConfirmModal('⚠️ 确定注销账号吗？\n此操作不可恢复：你的提交记录、积分、所在班级成员身份都将被清除。', async () => {
        try {
          await API.post('/api/account/delete');
          alert('账号已注销');
          API.setToken('');
          state.user = null;
          location.hash = '#/problems';
          refreshUser();
        } catch (err) { alert(err.message); }
      });
      break;

    case 'submit-code': submitCode(parseInt(el.dataset.id)); break;
    case 'buy-item': buyItem(parseInt(el.dataset.id)); break;
    case 'join-class': joinClass(parseInt(el.dataset.id), el.dataset.code); break;
    case 'leave-class': leaveClass(parseInt(el.dataset.id)); break;
    case 'class-add-problem': classAddProblem(parseInt(el.dataset.cid)); break;
    case 'class-del-problem': classDelProblem(parseInt(el.dataset.cid), parseInt(el.dataset.pid)); break;
    case 'class-add-contest': classAddContest(parseInt(el.dataset.cid)); break;
    case 'class-del-contest': classDelContest(parseInt(el.dataset.cid), parseInt(el.dataset.tid)); break;
    case 'class-add-training': classAddTraining(parseInt(el.dataset.cid)); break;
    case 'class-del-training': classDelTraining(parseInt(el.dataset.cid), parseInt(el.dataset.tid)); break;
    case 'class-add-homework': classAddHomework(parseInt(el.dataset.cid)); break;
    case 'class-del-homework': classDelHomework(parseInt(el.dataset.cid), parseInt(el.dataset.tid)); break;

    case 'admin-tab': switchAdminTab(el.dataset.atab); break;
    case 'admin-save-problem': adminSaveProblem(); break;
    case 'admin-cancel-edit': adminResetProblemForm(); break;
    case 'admin-import': adminImport(); break;
    case 'admin-edit-problem': adminEditProblem(parseInt(el.dataset.id)); break;

    case 'admin-del-problem':
      openConfirmModal('确定删除这道题吗？', async () => {
        try { await API.del('/api/admin/problem/' + el.dataset.id); await renderAdmin($('page')); }
        catch (err) { alert(err.message); }
      });
      break;

    case 'admin-add-ann': adminAddAnn(); break;
    case 'admin-del-user':
      openConfirmModal('确定删除用户『' + el.dataset.username + '』吗？此操作不可恢复！', async () => {
        try { await API.del('/api/admin/user/' + el.dataset.id); await renderAdmin($('page')); }
        catch (err) { alert(err.message); }
      });
      break;
    case 'admin-del-ann':
      openConfirmModal('确定删除这条公告吗？', async () => {
        try { await API.del('/api/admin/announcement/' + el.dataset.id); await renderAdmin($('page')); }
        catch (err) { alert(err.message); }
      });
      break;

    case 'admin-add-training': adminAddTraining(); break;
    case 'admin-del-training':
      openConfirmModal('确定删除这个训练吗？', async () => {
        try { await API.del('/api/admin/training/' + el.dataset.id); await renderAdmin($('page')); }
        catch (err) { alert(err.message); }
      });
      break;

    case 'admin-add-class': adminAddClass(); break;
    case 'save-signature': saveSignature(); break;
    case 'save-ai-key': saveAiKey(); break;
    case 'clear-ai-key': clearAiKey(); break;
    case 'ai-send': aiSend(); break;
    case 'upload-file': uploadFile(); break;
    case 'del-file': deleteFile(el.dataset.fid); break;
    case 'pts-select-all':
      document.querySelectorAll('.pts-chk').forEach(c => c.checked = true);
      break;
    case 'pts-select-none':
      document.querySelectorAll('.pts-chk').forEach(c => c.checked = false);
      break;
    case 'pts-grant': grantPoints(); break;
    case 'admin-add-class-prompt': adminAddClassPrompt(); break;
    case 'change-role': /* select.change 事件处理在下方 */ break;
    case 'admin-del-class':
      openConfirmModal('确定删除这个班级吗？', async () => {
        try { await API.del('/api/admin/class/' + el.dataset.id); await renderAdmin($('page')); }
        catch (err) { alert(err.message); }
      });
      break;

    case 'admin-add-item': adminAddItem(); break;
    case 'admin-del-item':
      openConfirmModal('确定下架这个商品吗？', async () => {
        try { await API.del('/api/admin/shop-item/' + el.dataset.id); await renderAdmin($('page')); }
        catch (err) { alert(err.message); }
      });
      break;
  }
});

async function adminImport() {
  const txt = $('p-import').value.trim();
  if (!txt) { alert('先粘贴 JSON 再导入'); return; }
  let j;
  try { j = JSON.parse(txt); } catch { alert('JSON 解析失败，检查一下格式'); return; }
  try {
    const r = await API.post('/api/admin/problems/import', j);
    alert('✅ 成功导入 ' + r.added + ' 道题');
    await renderAdmin($('page'));
  } catch (e) { alert(e.message); }
}

async function adminAddAnn() {
  const title = $('a-title').value.trim();
  if (!title) { alert('标题不能为空'); return; }
  try {
    await API.post('/api/admin/announcement', { title, content: $('a-content').value });
    alert('已发布');
    await renderAdmin($('page'));
  } catch (e) { alert(e.message); }
}

async function adminAddTraining() {
  const title = $('t-title').value.trim();
  if (!title) { alert('训练名不能为空'); return; }
  const pids = $('t-pids').value.split(/[,，]/).map(s => parseInt(s.trim())).filter(n => !isNaN(n));
  try {
    await API.post('/api/admin/training', { title, description: $('t-desc').value, problem_ids: pids });
    alert('已创建');
    await renderAdmin($('page'));
  } catch (e) { alert(e.message); }
}

async function adminAddClass() {
  const name = $('c-name').value.trim();
  if (!name) { alert('班级名不能为空'); return; }
  try {
    await API.post('/api/admin/class', {
      name, description: $('c-desc').value, invite_code: $('c-code').value.trim(),
    });
    alert('已创建');
    await renderAdmin($('page'));
  } catch (e) { alert(e.message); }
}

async function adminAddClassPrompt() {
  const name = prompt('班级名：'); if (!name) return;
  const invite_code = prompt('邀请码（可留空）：') || '';
  const description = prompt('班级描述（可留空）：') || '';
  try {
    const r = await API.post('/api/admin/class', { name, invite_code, description });
    alert('✅ 已创建班级');
    renderClasses($('page'));
  } catch (e) { alert(e.message); }
}

async function adminAddItem() {
  const name = $('s-name').value.trim();
  if (!name) { alert('商品名不能为空'); return; }
  try {
    await API.post('/api/admin/shop-item', {
      name,
      description: $('s-desc').value,
      price: parseInt($('s-price').value) || 0,
      icon: $('s-icon').value.trim() || '🎁',
      stock: parseInt($('s-stock').value) || 0,
    });
    alert('已上架');
    await renderAdmin($('page'));
  } catch (e) { alert(e.message); }
}

// ---------- 启动 ----------
window.addEventListener('DOMContentLoaded', async () => {
  $('confirm-ok').addEventListener('click', () => {
    if (confirmOk) { const cb = confirmOk; cb(); }
    closeConfirmModal();
  });
  await refreshUser();
  window.addEventListener('hashchange', router);
  if (!location.hash) location.hash = '#/problems';
  router();
});