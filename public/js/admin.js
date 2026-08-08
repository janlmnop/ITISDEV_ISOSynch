document.addEventListener('DOMContentLoaded', () => {
  const eventsTbody = document.querySelector('#eventsTable tbody');
  const usersTbody = document.querySelector('#usersTable tbody');
  const eventsView = document.getElementById('eventsView');
  const usersView = document.getElementById('usersView');
  const analyticsView = document.getElementById('analyticsView');
  const navUsers = document.getElementById('nav-users');
  const navAnalytics = document.getElementById('nav-analytics');
  const pageTitle = document.getElementById('pageTitle');
  const eventSearch = document.getElementById('eventSearch');
  const eventCategoryFilter = document.getElementById('eventCategoryFilter');

  function esc(s){ return String(s||'').replace(/[&<>\"]/g, c=> ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

  // Role & Permissions (SCRUM-9): every /api/admin/* call must identify the
  // caller's role so the server's requireAdmin middleware can authorize it.
  function currentUserRole(){
    const currentUser = JSON.parse(localStorage.getItem('currentUser')||'null');
    return currentUser ? currentUser.role : '';
  }
  function adminHeaders(extra){
    return Object.assign({ 'x-user-role': currentUserRole() }, extra || {});
  }

  // Search & Filter (SCRUM-12): build the query string from the current
  // search box / category dropdown values.
  function eventsQuery(){
    const params = new URLSearchParams();
    if (eventSearch && eventSearch.value.trim()) params.set('search', eventSearch.value.trim());
    if (eventCategoryFilter && eventCategoryFilter.value) params.set('category', eventCategoryFilter.value);
    const qs = params.toString();
    return qs ? `?${qs}` : '';
  }

  async function loadEvents(){
    const res = await fetch(`/api/admin/events${eventsQuery()}`, { headers: adminHeaders() });
    const items = await res.json();
    eventsTbody.innerHTML = '';
    for (const e of items) {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${esc(e.name)}</td><td>${esc(e.organizer||'')}</td><td>${esc(e.date||'')}</td><td>${esc(e.venue||'')}</td><td>${esc(e.status||'')}</td><td><a class="view-btn" href="/event-details?id=${encodeURIComponent(e.id)}">View</a> <button class="delete-btn" data-id="${e.id}">Delete</button></td>`;
      eventsTbody.appendChild(tr);
    }
  }

  async function loadUsers(){
    const res = await fetch('/api/admin/users', { headers: adminHeaders() });
    const items = await res.json();
    usersTbody.innerHTML = '';
    for (const u of items) {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${esc(u.firstName+' '+u.lastName)}</td><td>${esc(u.email)}</td><td>${esc(u.course||'')}</td><td>${esc(u.role||'member')}</td><td><button class="delete-user" data-id="${u.id}">Delete</button></td>`;
      usersTbody.appendChild(tr);
    }
  }

  // Event Analytics (SCRUM-18): signups, per-event turnout rate, and
  // category popularity, rendered with the same progress-bar styling
  // already used for registration slots on the event details page.
  async function loadAnalytics(){
    const res = await fetch('/api/admin/analytics', { headers: adminHeaders() });
    if (!res.ok) {
      document.getElementById('turnoutList').innerHTML = '<p class="no-events">Unable to load analytics.</p>';
      return;
    }
    const data = await res.json();
    document.getElementById('statTotalSignups').textContent = data.totalSignups;
    document.getElementById('statAvgTurnout').textContent = data.avgTurnoutRate + '%';
    document.getElementById('statEventCount').textContent = data.eventCount;

    const turnoutList = document.getElementById('turnoutList');
    turnoutList.innerHTML = data.perEvent.length ? data.perEvent.map(e => `
      <div style="margin-bottom:14px">
        <div class="slots-row"><span>${esc(e.name)} <span class="tag work">${esc(e.category||'')}</span></span><b>${e.filled}/${e.capacity} (${e.turnoutRate}%)</b></div>
        <div class="progress-track"><div class="progress-fill" style="width:${Math.min(e.turnoutRate,100)}%"></div></div>
      </div>`).join('') : '<p class="no-events">No events yet.</p>';

    const maxSignups = Math.max(1, ...data.categoryPopularity.map(c => c.totalSignups));
    const categoryList = document.getElementById('categoryList');
    categoryList.innerHTML = data.categoryPopularity.length ? data.categoryPopularity.map(c => `
      <div style="margin-bottom:14px">
        <div class="slots-row"><span>${esc(c.category)}</span><b>${c.totalSignups} signups · ${c.eventCount} event${c.eventCount===1?'':'s'}</b></div>
        <div class="progress-track"><div class="progress-fill" style="width:${Math.round((c.totalSignups/maxSignups)*100)}%"></div></div>
      </div>`).join('') : '<p class="no-events">No events yet.</p>';
  }

  function setActive(view) {

    navUsers.classList.remove('active');
    navAnalytics.classList.remove('active');

    usersView.style.display = 'none';
    analyticsView.style.display = 'none';

    if (view === 'analytics') {

        navAnalytics.classList.add('active');

        analyticsView.style.display = '';

        pageTitle.textContent = 'Event Analytics';

        loadAnalytics();

    } else {

        navUsers.classList.add('active');

        usersView.style.display = '';

        pageTitle.textContent = 'User Management';

        loadUsers();
    }
}

  document.body.addEventListener('click', async (ev) => {
    const btn = ev.target.closest('button'); if (!btn) return;
    if (btn.classList.contains('delete-btn')){
      if (!confirm('Delete event?')) return;
      const id = btn.dataset.id;
      const currentUser = JSON.parse(localStorage.getItem('currentUser')||'null');
      const moderator = currentUser ? (currentUser.firstName+' '+currentUser.lastName) : 'unknown';
      await fetch(`/api/admin/events/${id}`, { method:'DELETE', headers: adminHeaders({'Content-Type':'application/json'}), body: JSON.stringify({ moderator }) });
      loadEvents();
    }
    if (btn.classList.contains('delete-user')){
      if (!confirm('Delete user?')) return;
      const id = btn.dataset.id;
      const currentUser = JSON.parse(localStorage.getItem('currentUser')||'null');
      const moderator = currentUser ? (currentUser.firstName+' '+currentUser.lastName) : 'unknown';
      await fetch(`/api/admin/users/${id}`, { method:'DELETE', headers: adminHeaders({'Content-Type':'application/json'}), body: JSON.stringify({ moderator }) });
      loadUsers();
    }
  });

  // Search & Filter (SCRUM-12): re-query on input (debounced) / change.
  let searchDebounce;
  if (eventSearch) {
    eventSearch.addEventListener('input', () => {
      clearTimeout(searchDebounce);
      searchDebounce = setTimeout(loadEvents, 250);
    });
  }
  if (eventCategoryFilter) {
    eventCategoryFilter.addEventListener('change', loadEvents);
  }

  // hash navigation
  function navigate() {

    const h = (location.hash || '#users').replace('#', '');

    setActive(
        h === 'analytics'
            ? 'analytics'
            : 'users'
    );
}
  window.addEventListener('hashchange', navigate);
  navigate();
});
