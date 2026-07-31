const express = require('express');
const crypto = require("crypto");
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
const notificationsFile = path.join(dataDir, 'notifications.json');
const REMINDER_HOURS = Math.max(1, Number(process.env.EVENT_REMINDER_HOURS) || 24);

// =========================
// Role & Permissions (SCRUM-9)
// =========================
// This app has no session/cookie auth yet, so the logged-in user's role is
// passed from the client (mirrors the existing `x-moderator` header pattern
// used by the delete endpoints below). Every /api/admin/* route requires the
// caller to send `x-user-role: admin`.
function requireAdmin(req, res, next) {
  const role = req.get('x-user-role');
  if (role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden: admin role required' });
  }
  next();
}

// Case-insensitive "does this event match the search/category filters" check,
// shared by the public and admin event listing endpoints (SCRUM-12).
function matchesFilters(event, { search, category }) {
  if (category && String(event.category) !== String(category)) return false;
  if (search) {
    const needle = String(search).trim().toLowerCase();
    if (needle) {
      const haystack = [event.name, event.venue, event.description, event.organizer]
        .map(value => String(value || '').toLowerCase())
        .join(' ');
      if (!haystack.includes(needle)) return false;
    }
  }
  return true;
}

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
  if (!fs.existsSync(notificationsFile)) await fs.promises.writeFile(notificationsFile, '[]', 'utf8');
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

function notificationPreferences(user) {
  return {
    inApp: user.notificationPreferences?.inApp !== false,
    email: user.notificationPreferences?.email !== false,
    reminders: user.notificationPreferences?.reminders !== false
  };
}

function eventDateTime(event) {
  return new Date(`${event.date}T${event.startTime}:00`);
}

function eventDetails(event) {
  return `${event.name} on ${event.date} at ${event.startTime} in ${event.venue}`;
}

async function sendEmail({ to, subject, text }) {
  // Email delivery is intentionally configuration-driven. With no RESEND_API_KEY,
  // the inbox notification is still saved and the app runs normally in development.
  if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM) return { delivered: false };
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ from: process.env.EMAIL_FROM, to: [to], subject, text })
    });
    if (!response.ok) throw new Error(`email provider returned ${response.status}`);
    return { delivered: true };
  } catch (error) {
    console.error('Unable to deliver notification email:', error.message);
    return { delivered: false };
  }
}

async function notifyUsers({ userIds, event, type, title, message, emailSubject = title, emailText = message, reminder = false }) {
  const ids = [...new Set((userIds || []).map(String))];
  if (!ids.length) return [];
  const [users, notifications] = await Promise.all([readJson(usersFile), readJson(notificationsFile)]);
  const created = [];
  for (const userId of ids) {
    const user = users.find(candidate => String(candidate.id) === userId && candidate.status !== 'deleted');
    if (!user) continue;
    const preferences = notificationPreferences(user);
    // One reminder of each type per event/user prevents repeated scheduler runs from spamming attendees.
    if (reminder && notifications.some(item => String(item.userId) === userId && String(item.eventId) === String(event.id) && item.type === type)) continue;
    const item = {
      id: `notification-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      userId,
      eventId: event.id,
      type,
      title,
      message,
      readAt: null,
      createdAt: new Date().toISOString()
    };
    // Keep a delivery record even when the inbox is disabled. It prevents the
    // scheduler from sending the same email reminder every 15 minutes.
    item.visibleInApp = preferences.inApp;
    notifications.push(item);
    created.push(item);
    if (preferences.email && (!reminder || preferences.reminders)) {
      await sendEmail({ to: user.email, subject: emailSubject, text: `${emailText}\n\n${eventDetails(event)}` });
    }
  }
  if (created.length) await writeJson(notificationsFile, notifications);
  return created;
}

async function sendDueReminders() {
  try {
    const events = await readJson(eventsFile);
    const now = Date.now();
    const reminderWindow = REMINDER_HOURS * 60 * 60 * 1000;
    for (const event of events) {
      const startsAt = eventDateTime(event).getTime();
      if (event.status !== 'published' || !Number.isFinite(startsAt) || startsAt <= now || startsAt - now > reminderWindow) continue;
      await notifyUsers({
        userIds: event.registrations,
        event,
        type: 'event_reminder',
        title: `Reminder: ${event.name} is coming up`,
        message: `Your event starts in less than ${REMINDER_HOURS} hours.`,
        reminder: true
      });
    }
  } catch (error) {
    console.error('Unable to process event reminders:', error.message);
  }
}

// Public events (only published), with optional ?search= and ?category= filters (SCRUM-12)
app.get('/api/events', async (req, res) => {
  try {
    const { search, category } = req.query;
    const events = await readJson(eventsFile);
    res.json(events.filter(e => e.status === 'published' && matchesFilters(e, { search, category })));
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
    await notifyUsers({
      userIds: [userId],
      event,
      type: 'registration_confirmed',
      title: `You're registered for ${event.name}`,
      message: 'Your event registration is confirmed.',
      emailSubject: `Registration confirmed: ${event.name}`
    });
    res.status(201).json({ registered: true, filled: event.registrations.length, capacity: Number(event.capacity) });
  } catch (err) { res.status(500).json({ error: 'failed' }); }
});

// Admin: master list of drafted/published events (no deleted), with optional search/category filters
app.get('/api/admin/events', requireAdmin, async (req, res) => {
  try {
    const { search, category } = req.query;
    const events = await readJson(eventsFile);
    res.json(events.filter(e => (e.status === 'published' || e.status === 'draft') && matchesFilters(e, { search, category })));
  } catch (err) { res.status(500).json({ error: 'failed' }); }
});

app.post('/api/admin/events', requireAdmin, async (req, res) => {
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

app.put('/api/admin/events/:id', requireAdmin, async (req, res) => {
  try {
    const events = await readJson(eventsFile);
    const event = events.find(e => String(e.id) === String(req.params.id) && e.status !== 'deleted');
    if (!event) return res.status(404).json({ error: 'not found' });
    const { name, date, startTime, endTime, venue, category, capacity, description } = req.body || {};
    if (![name, date, startTime, endTime, venue, category].every(value => typeof value === 'string' && value.trim()) || !Number.isInteger(Number(capacity)) || Number(capacity) < (event.registrations || []).length || endTime <= startTime) {
      return res.status(400).json({ error: 'invalid event' });
    }
    const previous = { ...event };
    Object.assign(event, { name: name.trim(), date, startTime, endTime, venue: venue.trim(), category, capacity: Number(capacity), description: String(description || '').trim() });
    await writeJson(eventsFile, events);
    const changed = ['name', 'date', 'startTime', 'endTime', 'venue', 'category', 'description']
      .filter(field => String(previous[field] || '') !== String(event[field] || ''));
    if (changed.length && event.registrations?.length) {
      await notifyUsers({
        userIds: event.registrations,
        event,
        type: 'event_updated',
        title: `${event.name} was updated`,
        message: `The organizer updated: ${changed.join(', ')}.`,
        emailSubject: `Event update: ${event.name}`
      });
    }
    res.json(event);
  } catch (err) { res.status(500).json({ error: 'failed' }); }
});

// Admin users list
app.get('/api/admin/users', requireAdmin, async (req, res) => {
  try {
    const users = await readJson(usersFile);
    res.json(users.filter(u => u.status !== 'deleted'));
  } catch (err) { res.status(500).json({ error: 'failed' }); }
});

// Admin delete event (mark deleted + log)
app.delete('/api/admin/events/:id', requireAdmin, async (req, res) => {
  try {
    const events = await readJson(eventsFile);
    const idx = events.findIndex(e => String(e.id) === String(req.params.id));
    if (idx === -1) return res.status(404).json({ error: 'not found' });
    events[idx].status = 'deleted';
    await writeJson(eventsFile, events);
    await notifyUsers({
      userIds: events[idx].registrations,
      event: events[idx],
      type: 'event_cancelled',
      title: `${events[idx].name} was cancelled`,
      message: 'This event is no longer taking place.',
      emailSubject: `Event cancelled: ${events[idx].name}`
    });
    const moderator = req.body.moderator || req.get('x-moderator') || 'unknown';
    await appendModeration({ action: 'delete_event', eventId: req.params.id, moderator, timestamp: new Date().toISOString() });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'failed' }); }
});

// Admin delete user (mark deleted + log)
app.delete('/api/admin/users/:id', requireAdmin, async (req, res) => {
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
    const user = { id: Date.now().toString(), firstName: firstName.trim(), lastName: lastName.trim(), email: normalizedEmail, mobile, course, year, password, profilePicture: '', status: 'active', role: 'member', notificationPreferences: { inApp: true, email: true, reminders: true } };
    users.push(user);
    await writeJson(usersFile, users);
    const { password: _password, ...safeUser } = user;
    res.status(201).json(safeUser);
  } catch (err) { res.status(500).json({ error: 'failed' }); }
});

// Notification inbox and delivery preferences. Authentication is still handled
// client-side in this prototype, so these routes follow the existing user-id API pattern.
app.get('/api/notifications/:userId', async (req, res) => {
  try {
    const notifications = await readJson(notificationsFile);
    res.json(notifications
      .filter(item => String(item.userId) === String(req.params.userId) && item.visibleInApp !== false)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)));
  } catch (err) { res.status(500).json({ error: 'failed to load notifications' }); }
});

app.patch('/api/notifications/:id/read', async (req, res) => {
  try {
    const notifications = await readJson(notificationsFile);
    const notification = notifications.find(item => String(item.id) === String(req.params.id));
    if (!notification) return res.status(404).json({ error: 'not found' });
    notification.readAt = new Date().toISOString();
    await writeJson(notificationsFile, notifications);
    res.json(notification);
  } catch (err) { res.status(500).json({ error: 'failed to update notification' }); }
});

app.get('/api/notification-preferences/:userId', async (req, res) => {
  try {
    const users = await readJson(usersFile);
    const user = users.find(candidate => String(candidate.id) === String(req.params.userId) && candidate.status !== 'deleted');
    if (!user) return res.status(404).json({ error: 'user not found' });
    res.json(notificationPreferences(user));
  } catch (err) { res.status(500).json({ error: 'failed to load preferences' }); }
});

app.put('/api/notification-preferences/:userId', async (req, res) => {
  try {
    const { inApp, email, reminders } = req.body || {};
    if (![inApp, email, reminders].every(value => typeof value === 'boolean')) return res.status(400).json({ error: 'invalid preferences' });
    const users = await readJson(usersFile);
    const user = users.find(candidate => String(candidate.id) === String(req.params.userId) && candidate.status !== 'deleted');
    if (!user) return res.status(404).json({ error: 'user not found' });
    user.notificationPreferences = { inApp, email, reminders };
    await writeJson(usersFile, users);
    res.json(user.notificationPreferences);
  } catch (err) { res.status(500).json({ error: 'failed to save preferences' }); }
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

// =========================
// Password Reset
// =========================

app.post('/api/forgot-password', async (req, res) => {
  try {
    const { email } = req.body || {};

    if (!email) {
      return res.status(400).json({
        message: "Please enter your email."
      });
    }

    const users = await readJson(usersFile);

    const user = users.find(
      u =>
        String(u.email).toLowerCase() === String(email).toLowerCase() &&
        u.status !== "deleted"
    );

    // Don't reveal whether the email exists
    if (!user) {
      return res.json({
        message:
          "If an account with that email exists, a password reset link has been generated."
      });
    }

    const token = crypto.randomBytes(32).toString("hex");

    user.resetToken = token;
    user.resetTokenExpiry = Date.now() + (15 * 60 * 1000);

    await writeJson(usersFile, users);

    const resetLink =
      `http://localhost:${port}/reset-password?token=${token}`;

    console.log("\n========== PASSWORD RESET ==========");
    console.log(resetLink);
    console.log("====================================\n");

    await sendEmail({
      to: user.email,
      subject: "ISO Synch Password Reset",
      text:
`You requested a password reset.

Open this link:

${resetLink}

This link expires in 15 minutes.`
    });

    res.json({
      message:
        "If an account with that email exists, a password reset link has been generated."
    });

  } catch (err) {

    console.error(err);

    res.status(500).json({
      message: "Unable to process request."
    });

  }
});

app.get('/api/reset-password/:token', async (req, res) => {

    try {

        const { token } = req.params;

        const users = await readJson(usersFile);

        const user = users.find(u =>
            u.resetToken === token &&
            u.resetTokenExpiry > Date.now()
        );

        if (!user) {

            return res.json({
                valid: false
            });

        }

        res.json({
            valid: true
        });

    } catch (error) {

        console.error(error);

        res.status(500).json({
            valid: false
        });

    }

});

app.post('/api/reset-password', async (req, res) => {

    try {

        const { token, password } = req.body;

        if (!token || !password) {
            return res.status(400).json({
                message: "Invalid request."
            });
        }

        if (password.length < 8) {
            return res.status(400).json({
                message: "Password must be at least 8 characters."
            });
        }

        const users = await readJson(usersFile);

        const user = users.find(u =>
            u.resetToken === token &&
            u.resetTokenExpiry > Date.now()
        );

        if (!user) {

            return res.status(400).json({
                message: "Token expired or invalid."
            });

        }

        // Update password
        user.password = password;

        // Remove token
        delete user.resetToken;
        delete user.resetTokenExpiry;

        await writeJson(usersFile, users);

        res.json({
            message: "Password has been reset successfully."
        });

    } catch (error) {

        console.error(error);

        res.status(500).json({
            message: "Unable to reset password."
        });

    }

});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'login.html'));
});

app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'login.html'));
});

app.get('/forgot-password', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'forgot-password.html'));
});

app.get('/reset-password', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'reset-password.html'));
});

app.get('/reset-error', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'reset-error.html'));
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

// Check every 15 minutes. Reminders are deduplicated in notifyUsers, so a
// restart or repeated check cannot create duplicate reminders for an attendee.
sendDueReminders();
const reminderInterval = setInterval(sendDueReminders, 15 * 60 * 1000);
reminderInterval.unref();

app.listen(port, () => {
  console.log(`App listening on port ${port}`);
});
