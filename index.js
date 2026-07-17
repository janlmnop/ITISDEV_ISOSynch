const express = require('express');
const path = require('path');
const fs = require('fs');
const app = express();
const port = 3000;

// Serve static files (images, css, client js) from /public
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(path.join(__dirname, 'views')));
app.use(express.json());

const dataDir = path.join(__dirname, 'data');
const eventsFile = path.join(dataDir, 'events.json');
const usersFile = path.join(dataDir, 'users.json');
const modFile = path.join(dataDir, 'moderation.json');

async function ensureDataFiles() {
  try { await fs.promises.mkdir(dataDir, { recursive: true }); } catch (e) {}
  const starterEvents = () => [{
      id: 'general-assembly-2026',
      name: 'General Assembly',
      date: '2026-07-18',
      startTime: '17:00',
      endTime: '19:00',
      venue: 'G106',
      category: 'Gathering',
      capacity: 60,
      description: "All members are required to attend this term's General Assembly. We'll be covering the annual budget review, upcoming project pitches, and open floor announcements.",
      organizer: 'ISO Events Head',
      status: 'published',
      registrations: []
    }];
  if (!fs.existsSync(eventsFile) || (await fs.promises.readFile(eventsFile, 'utf8')).trim() === '[]') {
    await fs.promises.writeFile(eventsFile, JSON.stringify(starterEvents(), null, 2), 'utf8');
  }
  if (!fs.existsSync(usersFile)) await fs.promises.writeFile(usersFile, '[]', 'utf8');
  if (!fs.existsSync(modFile)) await fs.promises.writeFile(modFile, '[]', 'utf8');
}

async function readJson(file) {
  await ensureDataFiles();
  const raw = await fs.promises.readFile(file, 'utf8');
  return JSON.parse(raw || '[]');
}

async function writeJson(file, data) {
  await ensureDataFiles();
  await fs.promises.writeFile(file, JSON.stringify(data, null, 2), 'utf8');
}

async function appendModeration(entry) {
  const arr = await readJson(modFile);
  arr.push(entry);
  await writeJson(modFile, arr);
}

// Public events (only published)
app.get('/api/events', async (req, res) => {
  try {
    const events = await readJson(eventsFile);
    res.json(events.filter(e => e.status === 'published'));
  } catch (err) { res.status(500).json({ error: 'failed' }); }
});

app.get('/api/events/:id', async (req, res) => {
  try {
    const events = await readJson(eventsFile);
    const event = events.find(e => String(e.id) === String(req.params.id) && e.status === 'published');
    if (!event) return res.status(404).json({ error: 'not found' });
    res.json(event);
  } catch (err) { res.status(500).json({ error: 'failed' }); }
});

app.post('/api/events/:id/registrations', async (req, res) => {
  try {
    const userId = req.body && req.body.userId;
    if (!userId) return res.status(400).json({ error: 'missing user' });

    const [events, users] = await Promise.all([readJson(eventsFile), readJson(usersFile)]);
    const event = events.find(e => String(e.id) === String(req.params.id) && e.status === 'published');
    const user = users.find(u => String(u.id) === String(userId) && u.status !== 'deleted');
    if (!event || !user) return res.status(404).json({ error: 'not found' });

    event.registrations = Array.isArray(event.registrations) ? event.registrations : [];
    if (event.registrations.some(id => String(id) === String(userId))) {
      return res.json({ registered: true, alreadyRegistered: true, filled: event.registrations.length, capacity: Number(event.capacity) });
    }
    if (event.registrations.length >= Number(event.capacity)) return res.status(409).json({ error: 'full' });

    event.registrations.push(userId);
    await writeJson(eventsFile, events);
    res.status(201).json({ registered: true, filled: event.registrations.length, capacity: Number(event.capacity) });
  } catch (err) { res.status(500).json({ error: 'failed' }); }
});

// Admin: master list of drafted/published events (no deleted)
app.get('/api/admin/events', async (req, res) => {
  try {
    const events = await readJson(eventsFile);
    res.json(events.filter(e => e.status === 'published' || e.status === 'draft'));
  } catch (err) { res.status(500).json({ error: 'failed' }); }
});

app.post('/api/admin/events', async (req, res) => {
  try {
    const { name, date, startTime, endTime, venue, category, capacity, description } = req.body || {};
    if (![name, date, startTime, endTime, venue, category].every(value => typeof value === 'string' && value.trim()) || !Number.isInteger(Number(capacity)) || Number(capacity) < 1) {
      return res.status(400).json({ error: 'invalid event' });
    }
    if (endTime <= startTime) return res.status(400).json({ error: 'invalid time range' });
    const events = await readJson(eventsFile);
    const event = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, name: name.trim(), date, startTime, endTime, venue: venue.trim(), category, capacity: Number(capacity), description: String(description || '').trim(), organizer: req.body.organizer || 'ISO Events Head', status: 'published', registrations: [] };
    events.push(event);
    await writeJson(eventsFile, events);
    res.status(201).json(event);
  } catch (err) { res.status(500).json({ error: 'failed' }); }
});

app.put('/api/admin/events/:id', async (req, res) => {
  try {
    const events = await readJson(eventsFile);
    const event = events.find(e => String(e.id) === String(req.params.id) && e.status !== 'deleted');
    if (!event) return res.status(404).json({ error: 'not found' });
    const { name, date, startTime, endTime, venue, category, capacity, description } = req.body || {};
    if (![name, date, startTime, endTime, venue, category].every(value => typeof value === 'string' && value.trim()) || !Number.isInteger(Number(capacity)) || Number(capacity) < (event.registrations || []).length || endTime <= startTime) {
      return res.status(400).json({ error: 'invalid event' });
    }
    Object.assign(event, { name: name.trim(), date, startTime, endTime, venue: venue.trim(), category, capacity: Number(capacity), description: String(description || '').trim() });
    await writeJson(eventsFile, events);
    res.json(event);
  } catch (err) { res.status(500).json({ error: 'failed' }); }
});

// Admin users list
app.get('/api/admin/users', async (req, res) => {
  try {
    const users = await readJson(usersFile);
    res.json(users.filter(u => u.status !== 'deleted'));
  } catch (err) { res.status(500).json({ error: 'failed' }); }
});

// Admin delete event (mark deleted + log)
app.delete('/api/admin/events/:id', async (req, res) => {
  try {
    const events = await readJson(eventsFile);
    const idx = events.findIndex(e => String(e.id) === String(req.params.id));
    if (idx === -1) return res.status(404).json({ error: 'not found' });
    events[idx].status = 'deleted';
    await writeJson(eventsFile, events);
    const moderator = req.body.moderator || req.get('x-moderator') || 'unknown';
    await appendModeration({ action: 'delete_event', eventId: req.params.id, moderator, timestamp: new Date().toISOString() });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'failed' }); }
});

// Admin delete user (mark deleted + log)
app.delete('/api/admin/users/:id', async (req, res) => {
  try {
    const users = await readJson(usersFile);
    const idx = users.findIndex(u => String(u.id) === String(req.params.id));
    if (idx === -1) return res.status(404).json({ error: 'not found' });
    users[idx].status = 'deleted';
    await writeJson(usersFile, users);
    const moderator = req.body.moderator || req.get('x-moderator') || 'unknown';
    await appendModeration({ action: 'delete_user', userId: req.params.id, moderator, timestamp: new Date().toISOString() });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'failed' }); }
});

// Simple auth endpoint
app.post('/api/authenticate', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'missing credentials' });
    const users = await readJson(usersFile);
    const user = users.find(u => String(u.email).toLowerCase() === String(email).toLowerCase() && u.password === password && u.status !== 'deleted');
    if (!user) return res.status(401).json({ error: 'invalid' });
    const { password: _p, ...safe } = user;
    res.json(safe);
  } catch (err) { res.status(500).json({ error: 'failed' }); }
});

app.post('/api/register', async (req, res) => {
  try {
    const { firstName, lastName, email, mobile, course, year, password } = req.body || {};
    if (![firstName, lastName, email, mobile, course, year, password].every(value => typeof value === 'string' && value.trim())) {
      return res.status(400).json({ error: 'missing required fields' });
    }
    if (!/^09\d{9}$/.test(mobile)) return res.status(400).json({ error: 'invalid mobile' });
    if (password.length < 8) return res.status(400).json({ error: 'invalid password' });

    const users = await readJson(usersFile);
    const normalizedEmail = email.trim().toLowerCase();
    if (users.some(user => String(user.email).toLowerCase() === normalizedEmail && user.status !== 'deleted')) {
      return res.status(409).json({ error: 'email already registered' });
    }
    const user = { id: Date.now().toString(), firstName: firstName.trim(), lastName: lastName.trim(), email: normalizedEmail, mobile, course, year, password, profilePicture: '', status: 'active' };
    users.push(user);
    await writeJson(usersFile, users);
    const { password: _password, ...safeUser } = user;
    res.status(201).json(safeUser);
  } catch (err) { res.status(500).json({ error: 'failed' }); }
});

// =========================
// Profile Management
// =========================

// Get a user's profile
app.get('/api/profile/:id', async (req, res) => {
  try {
    const users = await readJson(usersFile);

    const user = users.find(
      u => String(u.id) === String(req.params.id) && u.status !== 'deleted'
    );

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const { password, ...safeUser } = user;
    res.json(safeUser);

  } catch (err) {
    res.status(500).json({ error: 'Failed to load profile' });
  }
});

// Update a user's profile
app.put('/api/profile/:id', async (req, res) => {
  try {

    const {
      firstName,
      lastName,
      mobile,
      course,
      year,
      profilePicture
    } = req.body;

    if (
      !firstName ||
      !lastName ||
      !mobile ||
      !course ||
      !year
    ) {
      return res.status(400).json({
        error: 'Missing required fields'
      });
    }

    if (!/^09\d{9}$/.test(mobile)) {
      return res.status(400).json({
        error: 'Invalid mobile number'
      });
    }

    const users = await readJson(usersFile);

    const user = users.find(
      u => String(u.id) === String(req.params.id) && u.status !== 'deleted'
    );

    if (!user) {
      return res.status(404).json({
        error: 'User not found'
      });
    }

    user.firstName = firstName.trim();
    user.lastName = lastName.trim();
    user.mobile = mobile;
    user.course = course;
    user.year = year;
    user.profilePicture = profilePicture || '';

    await writeJson(usersFile, users);

    const { password, ...safeUser } = user;

    res.json(safeUser);

  } catch (err) {
    res.status(500).json({
      error: 'Failed to update profile'
    });
  }
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'login.html'));
});

app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'login.html'));
});

app.get('/register', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'register.html'));
});

app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'index.html'));
});

app.get('/profile', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'profile.html'));
});

app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'admin.html'));
});

app.get('/manage-events', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'manage-events.html'));
});

app.get('/event-details', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'event-details.html'));
});

app.listen(port, () => {
  console.log(`App listening on port ${port}`);
});
