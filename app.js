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
let lastTasks = [];

function getStoredEmail() {
  try { return localStorage.getItem('lacleo_auth_user') || ''; } catch (e) { return ''; }
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
    headcount: l.headcount || '',
    revenue: l.revenue || '',
    trigger: l.trigger || '',
    hook: l.hook || '',
    icp: l.icp_score || l.icp || '',
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

  $('signOutBtn').addEventListener('click', (e) => { e.preventDefault(); onSignOut(); });
  $('jobForm').addEventListener('submit', onJobSubmit);
}

function go(view) {
  $('view-history').style.display = view === 'history' ? 'block' : 'none';
  $('view-leads').style.display = view === 'leads' ? 'block' : 'none';
  $('view-cockpit').style.display = view === 'cockpit' ? 'block' : 'none';
  ['history', 'leads', 'cockpit'].forEach((v) => {
    $('tab-' + v).classList.toggle('active', v === view);
    document.querySelector('[data-nav="' + v + '"]').classList.toggle('active', v === view);
  });
}

function toast(msg) {
  const t = $('toast');
  t.textContent = msg || 'Copied';
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 1800);
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
  const domain = (email.split('@')[1] || '').trim();
  if (domain) $('verifiedDomainLabel').textContent = domain + ' verified';

  refreshTaskList();
  listTimer = setInterval(refreshTaskList, 8000);
}

async function refreshTaskList() {
  try {
    const res = await fetch(statusEndpoint + '?email=' + encodeURIComponent(activeEmail));
    const data = await res.json();
    if (!data || !Array.isArray(data.tasks)) return;
    lastTasks = data.tasks;
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
  const body = $('historyBody');

  // metrics + tab/nav counts derived straight from the real task list
  const total = tasks.length;
  const doneTasks = tasks.filter(t => t.status === 'done');
  const processingTasks = tasks.filter(t => t.status === 'processing');
  const delivered = doneTasks.reduce((sum, t) => sum + (Number(t.lead_count) || 0), 0);
  $('metricTotal').textContent = String(total);
  $('metricDelivered').textContent = String(delivered);
  $('metricDeliveredSub').textContent = 'Across ' + doneTasks.length + ' completed run' + (doneTasks.length === 1 ? '' : 's');
  $('metricProcessing').textContent = String(processingTasks.length);
  $('tabCountHistory').textContent = String(total);
  $('navCountHistory').textContent = String(total);

  if (!tasks.length) {
    body.innerHTML = '<tr><td colspan="6"><div class="empty-hint">No runs yet — start your first search from "New Search".</div></td></tr>';
    return;
  }

  body.innerHTML = tasks.map(t => {
    let statusPill, reportCell, actionsCell;
    const when = new Date(t.created_at);
    const dateStr = isNaN(when) ? '' : when.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    const timeStr = isNaN(when) ? '' : when.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

    if (t.status === 'stopped') {
      statusPill = '<span class="status-pill stopped">&#9632; Stopped</span>';
    } else if (t.status === 'done') {
      statusPill = '<span class="status-pill done">&#10003; Done</span>';
    } else {
      statusPill = '<span class="status-pill processing">&#9679; ' + escapeHtml(t.stage || 'Researching') + '</span>';
    }

    if (t.status === 'done' || t.status === 'stopped') {
      reportCell = '<button class="btn-mini" data-view-job="' + escapeAttr(t.job_id) + '">&#128202; View</button>';
      actionsCell = '<button class="btn-mini primary" data-view-job="' + escapeAttr(t.job_id) + '">View leads</button><button class="btn-mini danger" data-delete-job="' + escapeAttr(t.job_id) + '">Delete</button>';
    } else {
      reportCell = '<span class="cell-sub">Not ready yet</span>';
      actionsCell = '<button class="btn-mini" data-stop-job="' + escapeAttr(t.job_id) + '">Stop</button><button class="btn-mini danger" data-delete-job="' + escapeAttr(t.job_id) + '">Delete</button>';
    }

    return '<tr>' +
      '<td><div class="cell-date">' + escapeHtml(dateStr) + '</div><div class="cell-sub">' + escapeHtml(timeStr) + '</div></td>' +
      '<td><div style="font-weight:600;color:var(--ink);">' + escapeHtml(t.stage || 'Lead search') + '</div><div class="cell-sub">' + escapeHtml(String(t.lead_count || 0)) + ' leads requested</div></td>' +
      '<td><span class="num" style="font-weight:700;color:var(--ink);">' + escapeHtml(String(t.lead_count || 0)) + '</span></td>' +
      '<td>' + statusPill + '</td>' +
      '<td>' + reportCell + '</td>' +
      '<td class="row-actions">' + actionsCell + '</td>' +
      '</tr>';
  }).join('');

  body.querySelectorAll('[data-view-job]').forEach(btn => btn.addEventListener('click', () => viewJobLeads(btn.dataset.viewJob)));
  body.querySelectorAll('[data-stop-job]').forEach(btn => btn.addEventListener('click', () => onStopClick(btn.dataset.stopJob)));
  body.querySelectorAll('[data-delete-job]').forEach(btn => btn.addEventListener('click', () => onDeleteClick(btn.dataset.deleteJob)));
}

async function onStopClick(jobId) {
  if (!confirm('Stop this run? Leads found so far will still be saved to the report.')) return;
  try {
    await fetch(stopEndpoint + '?job_id=' + encodeURIComponent(jobId));
    if (activeJobId === jobId) $('leadsViewSub').textContent = 'Stopping…';
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
  btn.textContent = 'Starting…';

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
      toast('Run started — watch it fill in below');
      startLiveRun(resData.job_id, count);
      refreshTaskList();
    }
  } catch (err) {
    console.error('submit failed', err);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Start research run →';
  }
}

function skeletonCardHTML(idx) {
  return '<div class="lead-card lead-card-blur" id="leadCard_' + idx + '">' +
    '<div class="blur-fill">' +
      '<div class="lead-top"><div class="lead-avatar">&middot;&middot;</div><div><h4 class="lead-name">Researching company</h4><p class="lead-role">Verifying role &bull; Company</p><span class="tenure-badge">&#10003; Current role verified</span></div></div>' +
      '<div class="firmo-strip"><div>Domain <b>&mdash;</b></div><div>Headcount <b>&mdash;</b></div><div>Revenue <b>&mdash;</b></div></div>' +
      '<div class="trigger-box"><div class="trigger-label">Verified buying trigger</div>Gathering evidence from independent sources before this is shown.</div>' +
      '<div class="hook-box">A tailored opening line will appear here once verified.</div>' +
      '<div class="lead-foot"><span class="icp-chip">ICP &mdash;</span><span class="li-link">LinkedIn &rarr;</span></div>' +
    '</div>' +
    '<div class="blur-tag"><div class="blur-tag-pill"><span class="mini-spin"></span>Verifying&hellip;</div></div>' +
  '</div>';
}

function realCardInner(n) {
  const avatar = n.photo
    ? '<img class="lead-avatar" src="' + escapeAttr(n.photo) + '" alt="">'
    : '<div class="lead-avatar">' + escapeHtml(initialsOf(n.name)) + '</div>';
  const firmo = '<div class="firmo-strip"><div>Domain <b>' + escapeHtml(n.domain || '—') + '</b></div><div>Headcount <b>' + escapeHtml(n.headcount || '—') + '</b></div><div>Revenue <b>' + escapeHtml(n.revenue || '—') + '</b></div></div>';
  const triggerText = n.trigger || n.hook || 'No buying trigger recorded for this lead.';
  const hookText = n.hook || n.trigger || '';
  const hookBox = hookText
    ? '<div class="hook-box"><button class="btn-copy" data-copy-hook="' + escapeAttr(hookText) + '">Copy</button>"' + escapeHtml(hookText) + '"</div>'
    : '';
  const liLink = n.li
    ? '<a class="li-link" href="' + escapeAttr(n.li) + '" target="_blank" rel="noopener">LinkedIn &rarr;</a>'
    : '<span class="li-link" style="color:var(--ink-muted);">No LinkedIn found</span>';
  const icpChip = n.icp ? '<span class="icp-chip">ICP ' + escapeHtml(String(n.icp)) + '</span>' : '<span class="icp-chip">ICP —</span>';

  return '<div class="lead-top">' + avatar +
      '<div><h4 class="lead-name">' + escapeHtml(n.name || 'Decision maker unavailable') + '</h4><p class="lead-role">' + escapeHtml([n.title, n.company].filter(Boolean).join(' • ')) + '</p><span class="tenure-badge">&#10003; Current role verified</span></div>' +
    '</div>' +
    firmo +
    '<div class="trigger-box"><div class="trigger-label">Verified buying trigger</div>' + escapeHtml(triggerText) + '</div>' +
    hookBox +
    '<div class="lead-foot">' + icpChip + liLink + '</div>';
}

function startLiveRun(jobId, targetCount) {
  if (pollTimer) clearInterval(pollTimer);
  activeJobId = jobId;
  revealedCount = 0;

  go('leads');
  $('leadsViewTitle').textContent = 'Verified leads — run in progress';
  $('leadsViewSub').textContent = 'Cards sharpen one by one as each candidate clears website, trigger and LinkedIn verification.';
  $('leadsSheetLink').style.visibility = 'hidden';

  const grid = $('cardsGrid');
  grid.innerHTML = '';
  for (let i = 0; i < targetCount; i++) grid.insertAdjacentHTML('beforeend', skeletonCardHTML(i));
  $('tabCountLeads').textContent = '0/' + targetCount;
  $('navCountLeads').textContent = '0/' + targetCount;

  pollTimer = setInterval(() => pollJobStatus(targetCount), 3000);
  pollJobStatus(targetCount);
}

async function pollJobStatus(targetCount) {
  if (!activeJobId) return;
  try {
    const res = await fetch(statusEndpoint + '?job_id=' + encodeURIComponent(activeJobId));
    const data = await res.json();

    if (data.stage) $('leadsViewSub').textContent = data.stage;

    const allLeads = Array.isArray(data.ready_leads) ? data.ready_leads : [];
    const verifiedLeads = allLeads.filter(l => l && String(l.dm_name || l.name || '').trim());
    while (revealedCount < verifiedLeads.length && revealedCount < targetCount) {
      revealCard(revealedCount, verifiedLeads[revealedCount]);
      revealedCount++;
      $('tabCountLeads').textContent = revealedCount + '/' + targetCount;
      $('navCountLeads').textContent = revealedCount + '/' + targetCount;
    }

    if (data.status === 'done' || data.status === 'stopped') {
      stopPolling();
      for (let i = revealedCount; i < targetCount; i++) {
        const card = document.getElementById('leadCard_' + i);
        if (card) card.remove();
      }
      $('leadsViewTitle').textContent = 'Verified leads — latest run';
      $('leadsViewSub').textContent = data.status === 'stopped'
        ? 'Stopped by user — showing what was verified before it stopped.'
        : 'Full profile per lead: current-role check, firmographics, the dated trigger behind the outreach, and a ready opener.';
      $('tabCountLeads').textContent = String(revealedCount);
      $('navCountLeads').textContent = String(revealedCount);
      if (data.sheet_url) {
        const link = $('leadsSheetLink');
        link.href = data.sheet_url;
        link.style.visibility = 'visible';
      }
      toast(data.status === 'stopped' ? 'Run stopped' : 'Report ready — Google Sheet generated');
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
  card.className = 'lead-card just-revealed';
  card.innerHTML = realCardInner(n);
  wireCopyButtons(card);
}

function wireCopyButtons(scope) {
  (scope || document).querySelectorAll('[data-copy-hook]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const text = btn.dataset.copyHook;
      try {
        await navigator.clipboard.writeText(text);
        toast('Hook copied to clipboard');
      } catch (e) {
        toast('Could not copy — select the text manually');
      }
    });
  });
}

async function viewJobLeads(jobId) {
  go('leads');
  stopPolling();
  $('leadsViewTitle').textContent = 'Verified leads — loading run…';
  $('leadsViewSub').textContent = 'Fetching this run’s verified leads.';
  $('leadsSheetLink').style.visibility = 'hidden';
  const grid = $('cardsGrid');
  grid.innerHTML = '<div class="empty-hint">Loading…</div>';

  try {
    const res = await fetch(statusEndpoint + '?job_id=' + encodeURIComponent(jobId));
    const data = await res.json();
    const leads = Array.isArray(data.ready_leads) ? data.ready_leads : [];

    $('leadsViewTitle').textContent = 'Verified leads — ' + (data.status === 'stopped' ? 'stopped run' : 'completed run');
    $('leadsViewSub').textContent = 'Full profile per lead: current-role check, firmographics, the dated trigger behind the outreach, and a ready opener.';
    $('tabCountLeads').textContent = String(leads.length);
    $('navCountLeads').textContent = String(leads.length);

    if (data.sheet_url) {
      const link = $('leadsSheetLink');
      link.href = data.sheet_url;
      link.style.visibility = 'visible';
    }

    if (!leads.length) {
      grid.innerHTML = '<div class="empty-hint">No lead details were saved for this run.' + (data.sheet_url ? ' Open the Google Sheet above for the full list.' : '') + '</div>';
      return;
    }

    grid.innerHTML = leads.map(raw => '<div class="lead-card">' + realCardInner(normalizeLead(raw)) + '</div>').join('');
    wireCopyButtons(grid);
  } catch (err) {
    console.error('viewJobLeads failed', err);
    grid.innerHTML = '<div class="empty-hint">Failed to load lead details.</div>';
  }
}

function stopPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
  activeJobId = null;
}

function escapeHtml(str) {
  return String(str == null ? '' : str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escapeAttr(str) { return escapeHtml(str); }

init();
