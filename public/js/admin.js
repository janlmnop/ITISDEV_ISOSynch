document.addEventListener('DOMContentLoaded', () => {
  const eventsTbody = document.querySelector('#eventsTable tbody');
  const usersTbody = document.querySelector('#usersTable tbody');
  const eventsView = document.getElementById('eventsView');
  const usersView = document.getElementById('usersView');
  const navEvents = document.getElementById('nav-events');
  const navUsers = document.getElementById('nav-users');
  const pageTitle = document.getElementById('pageTitle');

  function esc(s){ return String(s||'').replace(/[&<>\"]/g, c=> ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

  async function loadEvents(){
    const res = await fetch('/api/admin/events');
    const items = await res.json();
    eventsTbody.innerHTML = '';
    for (const e of items) {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${esc(e.title)}</td><td>${esc(e.organizer||'')}</td><td>${esc(e.date||'')}</td><td>${esc(e.location||'')}</td><td>${esc(e.status||'')}</td><td><button class="view-btn" data-id="${e.id}">View</button> <button class="delete-btn" data-id="${e.id}">Delete</button></td>`;
      eventsTbody.appendChild(tr);
    }
  }

  async function loadUsers(){
    const res = await fetch('/api/admin/users');
    const items = await res.json();
    usersTbody.innerHTML = '';
    for (const u of items) {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${esc(u.firstName+' '+u.lastName)}</td><td>${esc(u.email)}</td><td>${esc(u.course||'')}</td><td>${esc(u.role||'user')}</td><td><button class="delete-user" data-id="${u.id}">Delete</button></td>`;
      usersTbody.appendChild(tr);
    }
  }

  function setActive(view){
    if (view==='users'){
      navUsers.classList.add('active'); navEvents.classList.remove('active');
      usersView.style.display = ''; eventsView.style.display='none'; pageTitle.textContent='User Management';
      loadUsers();
    } else {
      navEvents.classList.add('active'); navUsers.classList.remove('active');
      eventsView.style.display = ''; usersView.style.display='none'; pageTitle.textContent='Event Management';
      loadEvents();
    }
  }

  document.body.addEventListener('click', async (ev) => {
    const btn = ev.target.closest('button'); if (!btn) return;
    if (btn.classList.contains('delete-btn')){
      if (!confirm('Delete event?')) return;
      const id = btn.dataset.id;
      const currentUser = JSON.parse(localStorage.getItem('currentUser')||'null');
      const moderator = currentUser ? (currentUser.firstName+' '+currentUser.lastName) : 'unknown';
      await fetch(`/api/admin/events/${id}`, { method:'DELETE', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ moderator }) });
      loadEvents();
    }
    if (btn.classList.contains('delete-user')){
      if (!confirm('Delete user?')) return;
      const id = btn.dataset.id;
      const currentUser = JSON.parse(localStorage.getItem('currentUser')||'null');
      const moderator = currentUser ? (currentUser.firstName+' '+currentUser.lastName) : 'unknown';
      await fetch(`/api/admin/users/${id}`, { method:'DELETE', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ moderator }) });
      loadUsers();
    }
  });

  // hash navigation
  function navigate(){
    const h = (location.hash || '#events').replace('#','');
    setActive(h==='users' ? 'users' : 'events');
  }
  window.addEventListener('hashchange', navigate);
  navigate();
});
