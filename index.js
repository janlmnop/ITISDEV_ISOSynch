const express = require('express');
const path = require('path');
const app = express();
const port = 3000;

// Serve static files (images, css, client js) from /public
app.use(express.static(path.join(__dirname, 'public')));

app.use(express.static(path.join(__dirname, 'views')));

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

app.get('/manage-events', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'manage-events.html'));
});

app.get('/event-details', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'event-details.html'));
});

app.listen(port, () => {
  console.log(`App listening on port ${port}`);
});