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
      <span>👋 <span class="u-name">${escapeHtml(state.user.username)}</span></span>
      <span class="pts">⭐ ${state.user.points}</span>
      <button class="btn-link" data-action="logout">退出登录</button>`;
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
  else if (section === 'shop') renderShop(page);
  else if (section === 'admin') renderAdmin(page);
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
        ${btn}
      </div>`;
    }).join('');
    page.innerHTML = `<h1 class="page-title">班级</h1>${
      cards || '<div class="empty">暂无班级，让管理员建一个吧</div>'}`;
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
    const [stats, problems, anns, trainings, classes, shop] = await Promise.all([
      API.get('/api/admin/stats'),
      API.get('/api/problems'),
      API.get('/api/announcements'),
      API.get('/api/trainings'),
      API.get('/api/classes'),
      API.get('/api/shop'),
    ]);
    adminData = {
      stats, problems: problems.problems, anns: anns.announcements,
      trainings: trainings.trainings, classes: classes.classes, shop: shop.items,
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
    </div>
    <div class="admin-panel" id="apanel-problems">${adminProblemPanel()}</div>
    <div class="admin-panel" id="apanel-anns">${adminAnnPanel()}</div>
    <div class="admin-panel" id="apanel-trainings">${adminTrainingPanel()}</div>
    <div class="admin-panel" id="apanel-classes">${adminClassPanel()}</div>
    <div class="admin-panel" id="apanel-shop">${adminShopPanel()}</div>`;
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

    case 'submit-code': submitCode(parseInt(el.dataset.id)); break;
    case 'buy-item': buyItem(parseInt(el.dataset.id)); break;
    case 'join-class': joinClass(parseInt(el.dataset.id), el.dataset.code); break;
    case 'leave-class': leaveClass(parseInt(el.dataset.id)); break;

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