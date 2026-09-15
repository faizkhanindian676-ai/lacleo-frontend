const submitEndpoint = 'https://primary-production-8f0b.up.railway.app/webhook/lead-generate-submit';
const statusEndpoint = 'https://primary-production-8f0b.up.railway.app/webhook/lead-status';
const stopEndpoint = 'https://primary-production-8f0b.up.railway.app/webhook/stop-job';
const deleteEndpoint = 'https://primary-production-8f0b.up.railway.app/webhook/delete-job';

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

function normalizeLead(l) {
  l = l || {};
  return {
    company: l.company || l.domain || '',
    domain: l.domain || '',
    name: l.name || l.dm_name || '',
    title: l.title || l.dm_title || '',
    li: l.li || l.dm_linkedin || '',
    location: l.location || '',
    trigger: l.trigger || '',
    hook: l.hook || '',
    icp: l.icp_score || '',
    photo: l.photo || ''
  };
}

function initialsOf(name) {
  return (name || '').split(' ').filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?';
}

function init() {
  const existing = getStoredEmail();
  if (!existing) {
    window.location.href = 'index.html';
    return;
  }
  enterDashboard(existing);

  $('signOutBtn').addEventListener('click', onSignOut);
  $('jobForm').addEventListener('submit', onJobSubmit);
  $('closeLeadsModal').addEventListener('click', closeLeadsCart);
  $('leadsModal').addEventListener('click', (e) => { if (e.target.id === 'leadsModal') closeLeadsCart(); });
}

function onSignOut() {
  stopPolling();
  clearStoredEmail();
  activeEmail = null;
  window.location.href = 'index.html';
}

function enterDashboard(email) {
  activeEmail = email;
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
    let badge;
    if (t.status === 'stopped') badge = '<span class="badge stopped">Stopped</span>';
    else if (t.status === 'done') badge = '<span class="badge done">Done</span>';
    else badge = '<span class="badge processing">Processing</span>';

    const viewBtn = (t.status === 'done' || t.status === 'stopped')
      ? `<button class="view-leads-btn" data-job-id="${escapeAttr(t.job_id)}">View Leads</button>`
      : '';
    const stopBtn = t.status === 'processing'
      ? `<button class="stop-btn" data-job-id="${escapeAttr(t.job_id)}">Stop</button>`
      : '';
    const deleteBtn = `<button class="delete-btn" data-job-id="${escapeAttr(t.job_id)}">Delete</button>`;
    return `
      <div class="task-row">
        <div class="t-main">
          <div class="t-icp">${escapeHtml(t.stage || 'Lead search')} &middot; ${t.lead_count || 0} leads</div>
          <div class="t-stage">${escapeHtml(new Date(t.created_at).toLocaleString())}</div>
        </div>
        <div class="t-right">${badge}${viewBtn}${stopBtn}${deleteBtn}</div>
      </div>`;
  }).join('');

  list.querySelectorAll('.view-leads-btn').forEach(btn => {
    btn.addEventListener('click', () => openLeadsCart(btn.dataset.jobId));
  });
  list.querySelectorAll('.stop-btn').forEach(btn => {
    btn.addEventListener('click', () => onStopClick(btn.dataset.jobId));
  });
  list.querySelectorAll('.delete-btn').forEach(btn => {
    btn.addEventListener('click', () => onDeleteClick(btn.dataset.jobId));
  });
}

async function onStopClick(jobId) {
  if (!confirm('Stop this run? Leads found so far will still be saved to the report.')) return;
  try {
    await fetch(stopEndpoint + '?job_id=' + encodeURIComponent(jobId));
    if (activeJobId === jobId) $('liveStage').textContent = 'Stopping...';
    refreshTaskList();
  } catch (err) {
    console.error('stopJob failed', err);
  }
}

async function onDeleteClick(jobId) {
  if (!confirm('Delete this run permanently? This cannot be undone.')) return;
  try {
    await fetch(deleteEndpoint + '?job_id=' + encodeURIComponent(jobId));
    if (activeJobId === jobId) {
      stopPolling();
      $('livePanel').hidden = true;
    }
    refreshTaskList();
  } catch (err) {
    console.error('deleteJob failed', err);
  }
}

async function onJobSubmit(e) {
  e.preventDefault();
  const icp = $('icpIn').value.trim();
  const count = parseInt($('formCount').value, 10) || 5;
  const minicp = parseInt($('formMinIcp').value, 10) || 90;
  const dm = $('formDm').checked;
  const maxli = $('formMaxli').checked;
  if (!icp) return;

  const btn = $('btnSubmit');
  btn.disabled = true;
  btn.textContent = 'Starting...';

  try {
    const params = new URLSearchParams();
    params.append('email', activeEmail);
    params.append('icp', icp);
    params.append('count', count);
    params.append('minicp', minicp);
    if (dm) params.append('dm', 'yes');
    if (maxli) params.append('maxli', 'yes');
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
      $('formMinIcp').value = 90;
      $('formDm').checked = true;
      $('formMaxli').checked = true;
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
        <div class="lc-top">
          <div class="lc-avatar">?</div>
          <div class="lc-info">
            <div class="company">Researching...</div>
            <div class="dm">-</div>
          </div>
        </div>
        <div class="meta">-</div>
        <div class="lc-trigger"></div>
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

    const allLeads = Array.isArray(data.ready_leads) ? data.ready_leads : [];
    const verifiedLeads = allLeads.filter(l => l && String(l.dm_name || l.name || '').trim());
    while (revealedCount < verifiedLeads.length && revealedCount < targetCount) {
      revealCard(revealedCount, verifiedLeads[revealedCount]);
      revealedCount++;
    }
    const pct = Math.min(100, Math.round((revealedCount / targetCount) * 100));
    $('liveProgress').style.width = pct + '%';

    if (data.status === 'done' || data.status === 'stopped') {
      stopPolling();
      for (let i = revealedCount; i < targetCount; i++) {
        const card = document.getElementById('leadCard_' + i);
        if (card) card.classList.remove('blurry');
      }
      $('liveStage').textContent = data.status === 'stopped' ? 'Stopped by user' : 'Done — your report is ready';
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
  const n = normalizeLead(lead);
  card.classList.remove('blurry');
  const avatarEl = card.querySelector('.lc-avatar');
  if (avatarEl) {
    if (n.photo) {
      avatarEl.outerHTML = `<img class="lc-avatar" src="${escapeAttr(n.photo)}" alt="">`;
    } else {
      avatarEl.textContent = initialsOf(n.name);
    }
  }
  card.querySelector('.company').textContent = n.company || 'Unknown company';
  card.querySelector('.dm').textContent = [n.name, n.title].filter(Boolean).join(' — ') || 'Decision maker unavailable';
  card.querySelector('.meta').textContent = n.location || n.domain || '';
  const triggerEl = card.querySelector('.lc-trigger');
  if (triggerEl) triggerEl.textContent = n.trigger || n.hook || '';
  const badge = card.querySelector('.icp-badge');
  if (badge) badge.textContent = n.icp ? (n.icp + '%') : '';
  if (n.li) {
    card.style.cursor = 'pointer';
    card.onclick = () => window.open(n.li, '_blank', 'noopener');
  }
}

async function openLeadsCart(jobId) {
  const modal = $('leadsModal');
  $('modalSheetLink').innerHTML = '';
  $('modalLeadsList').innerHTML = '<div class="empty-hint">Loading...</div>';
  modal.hidden = false;
  try {
    const res = await fetch(statusEndpoint + '?job_id=' + encodeURIComponent(jobId));
    const data = await res.json();
    if (data.sheet_url) {
      $('modalSheetLink').innerHTML = `<a href="${escapeAttr(data.sheet_url)}" target="_blank" rel="noopener">Open full report (Google Sheet) &rarr;</a>`;
    }
    const leads = Array.isArray(data.ready_leads) ? data.ready_leads : [];
    if (!leads.length) {
      $('modalLeadsList').className = '';
      $('modalLeadsList').innerHTML = '<div class="empty-hint">No lead details were saved for this run — open the Google Sheet above for the full list.</div>';
      return;
    }
    $('modalLeadsList').className = 'leads-grid';
    $('modalLeadsList').innerHTML = leads.map(raw => {
      const n = normalizeLead(raw);
      const avatar = n.photo
        ? `<img class="ldc-avatar" src="${escapeAttr(n.photo)}" alt="">`
        : `<div class="ldc-avatar">${escapeHtml(initialsOf(n.name))}</div>`;
      const liLink = n.li ? `<a class="ldc-li" href="${escapeAttr(n.li)}" target="_blank" rel="noopener">LinkedIn &rarr;</a>` : '';
      const insight = (n.trigger || n.hook) ? `<div class="ldc-trigger">${escapeHtml(n.trigger || n.hook)}</div>` : '';
      return `
        <div class="lead-detail-card">
          <div class="ldc-top">
            ${avatar}
            <div>
              <div class="ldc-name">${escapeHtml(n.name || 'Decision maker unavailable')}</div>
              <div class="ldc-title">${escapeHtml(n.title || '')}</div>
            </div>
          </div>
          <div class="ldc-company">${escapeHtml(n.company)}</div>
          <div class="ldc-meta">${escapeHtml([n.location, n.domain].filter(Boolean).join(' · '))}</div>
          ${insight}
          ${liLink}
        </div>`;
    }).join('');
  } catch (err) {
    console.error('openLeadsCart failed', err);
    $('modalLeadsList').innerHTML = '<div class="empty-hint">Failed to load lead details.</div>';
  }
}

function closeLeadsCart() {
  $('leadsModal').hidden = true;
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
