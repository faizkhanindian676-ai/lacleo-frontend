const submitEndpoint = 'https://primary-production-8f0b.up.railway.app/webhook/lead-generate-submit';
const statusEndpoint = 'https://primary-production-8f0b.up.railway.app/webhook/lead-status';

const freeDoms = ['gmail.com','yahoo.com','hotmail.com','outlook.com','live.com','icloud.com','aol.com','mail.com','proton.me','protonmail.com','zoho.com'];

const $ = (id) => document.getElementById(id);

let activeEmail = null;
let pollTimer = null;
let listTimer = null;
let activeJobId = null;
let revealedCount = 0;

function getStoredEmail() {
  try { return localStorage.getItem('lacleo_auth_user') || ''; } catch (e) { return ''; }
}
function setStoredEmail(email) {
  try { localStorage.setItem('lacleo_auth_user', email); } catch (e) {}
}
function clearStoredEmail() {
  try { localStorage.removeItem('lacleo_auth_user'); } catch (e) {}
}

function init() {
  const existing = getStoredEmail();
  if (existing) {
    enterDashboard(existing);
  } else {
    $('viewLogin').hidden = false;
    $('viewDashboard').hidden = true;
  }

$('loginForm').addEventListener('submit', onLoginSubmit);
  $('signOutBtn').addEventListener('click', onSignOut);
  $('jobForm').addEventListener('submit', onJobSubmit);
}

function onLoginSubmit(e) {
  e.preventDefault();
  const email = $('emailIn').value.trim();
  const err = $('domainErr');
  err.style.display = 'none';

if (!email || !email.includes('@')) {
  err.style.display = 'block';
  return;
}
  const dom = email.split('@')[1].toLowerCase().trim();
  if (freeDoms.includes(dom)) {
    err.style.display = 'block';
    return;
  }
  setStoredEmail(email);
  enterDashboard(email);
}

function onSignOut() {
  stopPolling();
  clearStoredEmail();
  activeEmail = null;
  $('viewDashboard').hidden = true;
  $('viewLogin').hidden = false;
}

function enterDashboard(email) {
  activeEmail = email;
  $('viewLogin').hidden = true;
  $('viewDashboard').hidden = false;
  $('userEmailLabel').textContent = email;
  $('userAvatar').textContent = email.slice(0, 2).toUpperCase();

refreshTaskList();
  listTimer = setInterval(refreshTaskList, 8000);
}
async function refreshTaskList() {
  try {
    const res = await fetch(statusEndpoint + '?email=' + encodeURIComponent(activeEmail));
    const data = await res.json();
    if (!data || !Array.isArray(data.tasks)) return;
    renderTaskList(data.tasks);

  if (!activeJobId) {
    const inFlight = data.tasks.find(t => t.status === 'processing');
    if (inFlight) startLiveRun(inFlight.job_id, inFlight.lead_count || 5);
  }
  } catch (err) {
    console.error('refreshTaskList failed', err);
  }
}

function renderTaskList(tasks) {
  const list = $('taskList');
  if (!tasks.length) {
    list.innerHTML = '<div class="empty-hint">No runs yet — start your first search above.</div>';
    return;
  }
  list.innerHTML = tasks.map(t => {
    const isDone = t.status === 'done';
    const badge = isDone
    ? '<span class="badge done">Done</span>'
      : '<span class="badge processing">Processing</span>';
    const link = (isDone && t.sheet_url)
    ? `<a class="sheet-link" href="${escapeAttr(t.sheet_url)}" target="_blank" rel="noopener">Open Report &rarr;</a>`
      : '';
    return `
    <div class="task-row">
    <div class="t-main">
    <div class="t-icp">${escapeHtml(t.stage || 'Lead search')} &middot; ${t.lead_count || 0} leads</div>
    <div class="t-stage">${escapeHtml(new Date(t.created_at).toLocaleString())}</div>
    </div>
    <div class="t-right">${badge}${link}</div>
    </div>`;
  }).join('');
}
async function onJobSubmit(e) {
  e.preventDefault();
  const icp = $('icpIn').value.trim();
  const count = parseInt($('formCount').value, 10) || 5;
  if (!icp) return;

const btn = $('btnSubmit');
  btn.disabled = true;
  btn.textContent = 'Starting...';

try {
  const params = new URLSearchParams();
  params.append('email', activeEmail);
  params.append('icp', icp);
  params.append('count', count);
  params.append('minicp', '85');
  params.append('maxli', 'yes');
  params.append('format', 'json');

  const resp = await fetch(submitEndpoint, {
    method: 'POST',
    headers: { 'Accept': 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString()
  });
  const resData = await resp.json();
  if (resData && resData.job_id) {
    $('jobForm').reset();
    $('formCount').value = 5;
    startLiveRun(resData.job_id, count);
    refreshTaskList();
  }
} catch (err) {
  console.error('submit failed', err);
} finally {
  btn.disabled = false;
  btn.textContent = 'Run Search →';
}
}
function startLiveRun(jobId, targetCount) {
  if (pollTimer) clearInterval(pollTimer);
  activeJobId = jobId;
  revealedCount = 0;

const panel = $('livePanel');
  panel.hidden = false;
  $('liveStage').textContent = 'Starting...';
  $('liveProgress').style.width = '0%';

const grid = $('cardsGrid');
  grid.innerHTML = '';
  for (let i = 0; i < targetCount; i++) {
    const card = document.createElement('div');
    card.className = 'lead-card blurry';
    card.id = 'leadCard_' + i;
    card.innerHTML = `
    <div class="scan-laser"></div>
    <div class="icp-badge">--</div>
    <div class="card-content">
    <div class="company">Researching...</div>
    <div class="dm">-</div>
    <div class="meta">-</div>
    </div>`;
    grid.appendChild(card);
  }

pollTimer = setInterval(() => pollJobStatus(targetCount), 3000);
  pollJobStatus(targetCount);
}
async function pollJobStatus(targetCount) {
  if (!activeJobId) return;
  try {
    const res = await fetch(statusEndpoint + '?job_id=' + encodeURIComponent(activeJobId));
    const data = await res.json();

  if (data.stage) $('liveStage').textContent = data.stage;

  const leads = Array.isArray(data.ready_leads) ? data.ready_leads : [];
    while (revealedCount < leads.length && revealedCount < targetCount) {
      revealCard(revealedCount, leads[revealedCount]);
      revealedCount++;
    }
    const pct = Math.min(100, Math.round((revealedCount / targetCount) * 100));
    $('liveProgress').style.width = pct + '%';

  if (data.status === 'done') {
    stopPolling();
    for (let i = revealedCount; i < targetCount; i++) {
      const card = document.getElementById('leadCard_' + i);
      if (card) card.classList.remove('blurry');
    }
    $('liveStage').textContent = 'Done — your report is ready';
    if (data.sheet_url) {
      const link = document.createElement('a');
      link.href = data.sheet_url;
      link.target = '_blank';
      link.rel = 'noopener';
      link.className = 'sheet-link';
      link.style.display = 'block';
      link.style.marginTop = '14px';
      link.textContent = 'Open full report (Google Sheet) →';
      $('livePanel').appendChild(link);
    }
    refreshTaskList();
  }
  } catch (err) {
    console.error('pollJobStatus failed', err);
  }
}
function revealCard(idx, lead) {
  const card = document.getElementById('leadCard_' + idx);
  if (!card) return;
  card.classList.remove('blurry');
  card.querySelector('.company').textContent = lead.company || lead.domain || 'Unknown company';
  card.querySelector('.dm').textContent = [lead.dm_name, lead.dm_title].filter(Boolean).join(' — ') || 'Decision maker unavailable';
  card.querySelector('.meta').textContent = lead.location || lead.domain || '';
  const badge = card.querySelector('.icp-badge');
  if (badge) badge.textContent = lead.icp_score ? (lead.icp_score + '%') : '';
  if (lead.dm_linkedin) {
    card.style.cursor = 'pointer';
    card.onclick = () => window.open(lead.dm_linkedin, '_blank', 'noopener');
  }
}

function stopPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
  activeJobId = null;
}

function escapeHtml(str) {
  return String(str == null ? '' : str).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function escapeAttr(str) { return escapeHtml(str); }

init();
