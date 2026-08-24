// ============ 登录 / 注册模态框 ============
let authCallback = null;   // 登录成功后的回调用（比如未登录点提交）
let authTab = 'login';

function openAuthModal(tab = 'login') {
  document.getElementById('auth-modal').classList.remove('hidden');
  switchAuthTab(tab);
  const nameEl = document.getElementById('auth-username');
  setTimeout(() => nameEl.focus(), 50);
}

function closeAuthModal() {
  document.getElementById('auth-modal').classList.add('hidden');
  document.getElementById('auth-error').textContent = '';
}

function switchAuthTab(tab) {
  authTab = tab;
  document.querySelectorAll('.auth-tab').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === tab);
  });
  const btn = document.getElementById('auth-submit-btn');
  btn.textContent = tab === 'login' ? '登 录' : '注 册';
  document.getElementById('auth-password').autocomplete =
    tab === 'login' ? 'current-password' : 'new-password';
  document.getElementById('auth-error').textContent = '';
}

// 返回 false 阻止表单默认提交
async function handleAuthSubmit(e) {
  e.preventDefault();
  const name = document.getElementById('auth-username').value.trim();
  const pass = document.getElementById('auth-password').value;
  const errEl = document.getElementById('auth-error');
  errEl.textContent = '';

  if (name.length < 3 || name.length > 32) { errEl.textContent = '用户名长度须为 3-32 字符'; return false; }
  if (pass.length < 6 || pass.length > 64) { errEl.textContent = '密码长度须为 6-64 字符'; return false; }

  try {
    const url = authTab === 'login' ? '/api/login' : '/api/register';
    const data = await API.post(url, { username: name, password: pass });
    API.setToken(data.token);
    closeAuthModal();
    document.getElementById('auth-username').value = '';
    document.getElementById('auth-password').value = '';
    await refreshUser();
    if (authCallback) { const cb = authCallback; authCallback = null; cb(); }
    alert('欢迎，' + data.username + '！' + (authTab === 'register' ? ' 注册成功，送 0 积分，快去刷题。' : ''));
  } catch (err) {
    errEl.textContent = err.message;
  }
  return false;
}

// ============ 通用确认框 ============
let confirmOk = null;
function openConfirmModal(text, onOk) {
  confirmOk = onOk;
  document.getElementById('confirm-text').textContent = text;
  document.getElementById('confirm-modal').classList.remove('hidden');
}
function closeConfirmModal() {
  confirmOk = null;
  document.getElementById('confirm-modal').classList.add('hidden');
}