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
  if (!fs.existsSync(eventsFile)) await fs.promises.writeFile(eventsFile, '[]', 'utf8');
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

// Admin: master list of drafted/published events (no deleted)
app.get('/api/admin/events', async (req, res) => {
  try {
    const events = await readJson(eventsFile);
    res.json(events.filter(e => e.status === 'published' || e.status === 'draft'));
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