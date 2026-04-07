# VISION AI — Tri-Modal Control System

> Voice + Manual + Hand Gestures controlling a full AI vision platform in the browser.

## Features
- 👤 Face Detection (MediaPipe FaceMesh)
- 🧠 Face Recognition (face-api.js) — enroll & name people
- 🎭 Emotion Detection
- 🔬 Age & Gender Estimation
- 🦴 Pose / Body tracking (MediaPipe Pose)
- ✋ Hand Landmark tracking (MediaPipe Hands)
- 📸 Capture + save snapshots (IndexedDB + download)
- 🎤 Full voice control (Web Speech API)
- 👊 Hand gesture commands (8 gestures)
- ⌨️ Text command bar

## Hand Gestures
| Gesture | Action |
|---------|--------|
| ✌️ Peace | Face Detection |
| 👍 Thumbs Up | Recognize Face |
| 👎 Thumbs Down | Stop All |
| ✋ Open Palm | Pause/Resume |
| 👊 Fist | Clear All |
| ☝️ Point | Pose Module |
| 🤙 Call Me | Toggle Voice |
| 🤏 Pinch | Capture Snapshot |

## Voice Commands
```
"start face detection"
"recognize" / "who is this"
"emotion" / "age gender"
"pose" / "track hands"
"capture" / "snapshot"
"save face as John"
"forget John"
"stop" / "pause"
"download" / "export"
"clear all"
```

## Project Structure
```
vision-app/
├── frontend/
│   ├── index.html     ← Single-file app (open directly in browser)
│   └── app.js         ← All logic
├── backend/
│   ├── server.js      ← Express + MongoDB API
│   └── package.json
├── .github/workflows/
│   ├── deploy.yml     ← Auto deploy on push to main
│   └── test.yml       ← Test on PRs
├── .env.example       ← Copy to .env, fill in MongoDB URI
└── .gitignore
```

## Quick Start (Frontend only — no backend needed)
1. Open `frontend/index.html` in Chrome/Edge
2. Allow camera + microphone
3. Wait for models to load (~20s first time)
4. Press 🎤 VOICE or use buttons
5. All data saves to browser IndexedDB

## Full Stack Deploy
1. **Change your MongoDB password** at cloud.mongodb.com
2. Copy `.env.example` → `.env` with new password
3. `cd backend && npm install && npm start`
4. Open `frontend/index.html` in browser

## GitHub → Auto Deploy
1. Push repo to GitHub
2. Add secrets (Settings → Secrets → Actions):
   - `MONGODB_URI`
   - `RENDER_API_KEY` + `RENDER_SERVICE_ID`
   - `VERCEL_TOKEN` + `VERCEL_ORG_ID` + `VERCEL_PROJECT_ID`
3. Push to `main` → auto deploys everywhere

## ⚠️ Security Reminder
Your old MongoDB password `909090` was exposed. Change it immediately at:
https://cloud.mongodb.com → Database Access → Edit User
