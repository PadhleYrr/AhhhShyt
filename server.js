const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
require('dotenv').config();

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

app.use(cors());
app.use(express.json({ limit: '20mb' }));

// ── MONGO CONNECT ────────────────────────────────────────────
mongoose.connect(process.env.MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.error('MongoDB error:', err));

// ── SCHEMAS ──────────────────────────────────────────────────
const CaptureSchema = new mongoose.Schema({
  dataUrl: String,
  label: String,
  timestamp: { type: Date, default: Date.now },
  metadata: mongoose.Schema.Types.Mixed,
});

const FaceProfileSchema = new mongoose.Schema({
  name: { type: String, unique: true },
  descriptor: [Number],
  createdAt: { type: Date, default: Date.now },
});

const Capture = mongoose.model('Capture', CaptureSchema);
const FaceProfile = mongoose.model('FaceProfile', FaceProfileSchema);

// ── ROUTES ────────────────────────────────────────────────────

// Save capture
app.post('/api/captures', async (req, res) => {
  try {
    const cap = new Capture(req.body);
    await cap.save();
    res.json({ ok: true, id: cap._id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get all captures
app.get('/api/captures', async (req, res) => {
  const caps = await Capture.find().sort({ timestamp: -1 }).limit(50);
  res.json(caps);
});

// Delete capture
app.delete('/api/captures/:id', async (req, res) => {
  await Capture.findByIdAndDelete(req.params.id);
  res.json({ ok: true });
});

// Save face profile
app.post('/api/faces', async (req, res) => {
  try {
    const { name, descriptor } = req.body;
    const profile = await FaceProfile.findOneAndUpdate(
      { name }, { descriptor }, { upsert: true, new: true }
    );
    res.json({ ok: true, id: profile._id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get all face profiles
app.get('/api/faces', async (req, res) => {
  const profiles = await FaceProfile.find();
  res.json(profiles);
});

// Delete face
app.delete('/api/faces/:name', async (req, res) => {
  await FaceProfile.findOneAndDelete({ name: req.params.name });
  res.json({ ok: true });
});

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date() }));

// Serve frontend in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../frontend')));
  app.get('*', (req, res) => res.sendFile(path.join(__dirname, '../frontend/index.html')));
}

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
