# ISOSynch

A task management system web application for Information Security Organization - De La Salle University Manila

## Tech Stack

Frontend:
Backend:
Database:

## Prerequisites

## Quick Start Guide

```bash
npm install
npm start
```

## Event notifications

The dashboard has an in-app inbox. Registration confirmations, organizer edits,
event cancellations, and upcoming-event reminders are generated from the saved
event registrations; no event or recipient needs to be coded manually.

Email delivery is optional. Copy `.env.example` to `.env` and configure a
[Resend](https://resend.com) API key plus a verified sender address. The app
will still create in-app notifications when those environment variables are not
present. Set `EVENT_REMINDER_HOURS` to choose the reminder window (24 by default).
