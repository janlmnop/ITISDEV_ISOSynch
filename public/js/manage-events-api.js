(() => {
  const form = document.getElementById('eventForm');
  const tableBody = document.getElementById('eventTableBody');
  const countLabel = document.getElementById('eventCount');
  const emptyMessage = document.getElementById('noEventsMessage');
  const submitButton = document.getElementById('submitBtn');
  const cancelButton = document.getElementById('cancelBtn');
  const categoryTagClass = { Meeting: 'work', 'Seminar/Workshop': 'personal', Gathering: 'entertainment' };
  const eventSearch = document.getElementById('eventSearch');
  const eventCategoryFilter = document.getElementById('eventCategoryFilter');
  const posterInput = document.getElementById('eventPoster');
  const posterStatus = document.getElementById('posterStatus');
  const posterPreview = document.getElementById('posterPreview');
  let events = [];
  let editingId = null;
  let pendingPosterDataUrl = ''; // newly-selected, already-compressed WebP for the next save
  const MAX_POSTER_BYTES = 5 * 1024 * 1024; // 5MB, matches the server-side limit

  // Role & Permissions (SCRUM-9): identify the caller's role to the server's
  // requireAdmin middleware, same pattern as admin.js.
  function currentUserRole() {
    const currentUser = JSON.parse(localStorage.getItem('currentUser') || 'null');
    return currentUser ? currentUser.role : '';
  }
  function adminHeaders(extra) {
    return Object.assign({ 'x-user-role': currentUserRole() }, extra || {});
  }

  // Search & Filter (SCRUM-12): build the query string from the search box /
  // category dropdown so the results match what's on screen.
  function eventsQuery() {
    const params = new URLSearchParams();
    if (eventSearch && eventSearch.value.trim()) params.set('search', eventSearch.value.trim());
    if (eventCategoryFilter && eventCategoryFilter.value) params.set('category', eventCategoryFilter.value);
    const qs = params.toString();
    return qs ? `?${qs}` : '';
  }

  // Image Optimization (SCRUM-23): resize + re-encode the chosen file to
  // WebP in the browser via <canvas> before it ever leaves the client, so
  // the upload itself is already compressed. Server double-checks the size.
  function compressImageToWebp(file, maxDimension = 1600, quality = 0.82) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const objectUrl = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(objectUrl);
        let { width, height } = img;
        if (width > maxDimension || height > maxDimension) {
          const scale = maxDimension / Math.max(width, height);
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/webp', quality));
      };
      img.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error('Could not read image')); };
      img.src = objectUrl;
    });
  }

  if (posterInput) {
    posterInput.addEventListener('change', async () => {
      const file = posterInput.files && posterInput.files[0];
      pendingPosterDataUrl = '';
      posterPreview.style.display = 'none';
      if (!file) { posterStatus.textContent = ''; return; }
      if (file.size > MAX_POSTER_BYTES) {
        posterStatus.textContent = 'File size too large.';
        posterInput.value = '';
        return;
      }
      posterStatus.textContent = 'Compressing…';
      try {
        pendingPosterDataUrl = await compressImageToWebp(file);
        posterPreview.src = pendingPosterDataUrl;
        posterPreview.style.display = '';
        const approxKb = Math.round((pendingPosterDataUrl.length * 0.75) / 1024);
        posterStatus.textContent = `Ready — compressed to WebP, ~${approxKb}KB`;
      } catch (error) {
        posterStatus.textContent = 'Could not process that image.';
      }
    });
  }

  function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
  }

  function formatDate(value) {
    return new Date(`${value}T00:00:00`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  }

  function formatTime(value) {
    const [hours, minutes] = value.split(':').map(Number);
    return `${hours % 12 || 12}:${String(minutes).padStart(2, '0')} ${hours >= 12 ? 'PM' : 'AM'}`;
  }

  function render() {
    countLabel.textContent = `${events.length} event${events.length === 1 ? '' : 's'} scheduled`;
    emptyMessage.style.display = events.length ? 'none' : 'block';
    tableBody.innerHTML = events.map(event => `
      <tr>
        <td>${event.posterImage ? `<img src="${escapeHtml(event.posterImage)}" alt="" style="width:56px;height:36px;object-fit:cover;border-radius:6px">` : '<span class="no-events" style="padding:0;font-size:11px">None</span>'}</td>
        <td><b>${escapeHtml(event.name)}</b></td>
        <td>${formatDate(event.date)} · ${formatTime(event.startTime)} – ${formatTime(event.endTime)}</td>
        <td>${escapeHtml(event.venue)}</td>
        <td><span class="tag ${categoryTagClass[event.category] || 'work'}">${escapeHtml(event.category)}</span></td>
        <td>${event.capacity}</td>
        <td><div class="action-buttons">
          <a class="view-btn" href="/event-details?id=${encodeURIComponent(event.id)}">View Event Details</a>
          <button class="edit-btn" type="button" data-edit-id="${escapeHtml(event.id)}">Edit</button>
        </div></td>
      </tr>`).join('');
  }

  async function loadEvents() {
    const response = await fetch(`/api/admin/events${eventsQuery()}`, { headers: adminHeaders() });
    if (!response.ok) throw new Error('Unable to load events');
    events = await response.json();
    events.sort((a, b) => new Date(`${a.date}T${a.startTime}`) - new Date(`${b.date}T${b.startTime}`));
    render();
  }

  async function migrateLegacyEvents() {
    let legacyEvents;
    try {
      legacyEvents = JSON.parse(localStorage.getItem('events') || '[]');
    } catch (error) {
      return;
    }
    if (!Array.isArray(legacyEvents)) return;
    const existingNames = new Set(events.map(event => String(event.name).trim().toLowerCase()));
    for (const legacyEvent of legacyEvents) {
      const name = String(legacyEvent.name || '').trim();
      if (!name || existingNames.has(name.toLowerCase())) continue;
      const payload = {
        name,
        date: legacyEvent.date,
        startTime: legacyEvent.startTime,
        endTime: legacyEvent.endTime,
        venue: String(legacyEvent.venue || '').trim(),
        category: legacyEvent.category || 'Meeting',
        capacity: Number(legacyEvent.capacity),
        description: String(legacyEvent.description || '').trim()
      };
      if (!payload.date || !payload.startTime || !payload.endTime || !payload.venue || !Number.isInteger(payload.capacity) || payload.capacity < 1) continue;
      const response = await fetch('/api/admin/events', { method: 'POST', headers: adminHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify(payload) });
      if (response.ok) existingNames.add(name.toLowerCase());
    }
  }

  function exitEditMode() {
    editingId = null;
    form.reset();
    submitButton.textContent = 'Add Event';
    cancelButton.classList.remove('show');
    pendingPosterDataUrl = '';
    if (posterInput) posterInput.value = '';
    if (posterStatus) posterStatus.textContent = '';
    if (posterPreview) posterPreview.style.display = 'none';
  }

  tableBody.addEventListener('click', event => {
    const button = event.target.closest('[data-edit-id]');
    if (!button) return;
    const item = events.find(candidate => String(candidate.id) === button.dataset.editId);
    if (!item) return;
    editingId = item.id;
    document.getElementById('eventName').value = item.name;
    document.getElementById('eventDate').value = item.date;
    document.getElementById('eventStartTime').value = item.startTime;
    document.getElementById('eventEndTime').value = item.endTime;
    document.getElementById('eventVenue').value = item.venue;
    document.getElementById('eventCategory').value = item.category;
    document.getElementById('eventCapacity').value = item.capacity;
    document.getElementById('eventDescription').value = item.description || '';
    pendingPosterDataUrl = '';
    if (posterInput) posterInput.value = '';
    if (item.posterImage && posterPreview) {
      posterPreview.src = item.posterImage;
      posterPreview.style.display = '';
      posterStatus.textContent = 'Current poster shown below — choose a new file to replace it.';
    } else if (posterPreview) {
      posterPreview.style.display = 'none';
      posterStatus.textContent = '';
    }
    submitButton.textContent = 'Save Changes';
    cancelButton.classList.add('show');
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  cancelButton.addEventListener('click', event => {
    event.stopImmediatePropagation();
    exitEditMode();
  }, true);

  // Capture the submit before the legacy localStorage handler so all changes use the API.
  form.addEventListener('submit', async event => {
    event.preventDefault();
    event.stopImmediatePropagation();
    const payload = {
      name: document.getElementById('eventName').value.trim(),
      date: document.getElementById('eventDate').value,
      startTime: document.getElementById('eventStartTime').value,
      endTime: document.getElementById('eventEndTime').value,
      venue: document.getElementById('eventVenue').value.trim(),
      category: document.getElementById('eventCategory').value,
      capacity: Number(document.getElementById('eventCapacity').value),
      description: document.getElementById('eventDescription').value.trim()
    };
    if (pendingPosterDataUrl) payload.posterImage = pendingPosterDataUrl;
    if (payload.endTime <= payload.startTime) {
      alert('End time must be after start time.');
      return;
    }
    try {
      const url = editingId ? `/api/admin/events/${encodeURIComponent(editingId)}` : '/api/admin/events';
      const response = await fetch(url, { method: editingId ? 'PUT' : 'POST', headers: adminHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify(payload) });
      if (!response.ok) throw new Error('Unable to save event');
      exitEditMode();
      await loadEvents();
    } catch (error) {
      alert('Unable to save the event. Please try again.');
    }
  }, true);

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

  (async () => {
    try {
      await loadEvents();
      await migrateLegacyEvents();
      await loadEvents();
    } catch (error) {
      emptyMessage.style.display = 'block';
      emptyMessage.textContent = 'Unable to load events. Please refresh and try again.';
    }
  })();
})();
