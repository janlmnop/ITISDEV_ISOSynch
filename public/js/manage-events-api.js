(() => {
  const form = document.getElementById('eventForm');
  const tableBody = document.getElementById('eventTableBody');
  const countLabel = document.getElementById('eventCount');
  const emptyMessage = document.getElementById('noEventsMessage');
  const submitButton = document.getElementById('submitBtn');
  const cancelButton = document.getElementById('cancelBtn');
  const categoryTagClass = { Meeting: 'work', 'Seminar/Workshop': 'personal', Gathering: 'entertainment' };
  let events = [];
  let editingId = null;

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
    const response = await fetch('/api/admin/events');
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
      const response = await fetch('/api/admin/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (response.ok) existingNames.add(name.toLowerCase());
    }
  }

  function exitEditMode() {
    editingId = null;
    form.reset();
    submitButton.textContent = 'Add Event';
    cancelButton.classList.remove('show');
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
    if (payload.endTime <= payload.startTime) {
      alert('End time must be after start time.');
      return;
    }
    try {
      const url = editingId ? `/api/admin/events/${encodeURIComponent(editingId)}` : '/api/admin/events';
      const response = await fetch(url, { method: editingId ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (!response.ok) throw new Error('Unable to save event');
      exitEditMode();
      await loadEvents();
    } catch (error) {
      alert('Unable to save the event. Please try again.');
    }
  }, true);

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
