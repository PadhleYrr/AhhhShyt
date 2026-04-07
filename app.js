/* ============================================================
   VISION AI — Tri-Modal Control System
   Voice + Manual + Hand Gestures → Unified Command Processor
   Modules: Face | Recognize | Emotion | Age/Gender | Pose | Hands
   Storage: IndexedDB + Download
   ============================================================ */

// ── STATE ────────────────────────────────────────────────────
const STATE = {
  cameraReady: false,
  modelsLoaded: false,
  activeModules: new Set(),
  voiceActive: false,
  paused: false,
  faceDescriptors: [],   // {name, descriptor}
  captures: [],           // {id, dataUrl, timestamp, label}
  gestureBuffer: [],
  lastGesture: null,
  lastGestureTime: 0,
  enrolling: false,
  faceMeshRunning: false,
  handsRunning: false,
  poseRunning: false,
};

// ── ELEMENTS ─────────────────────────────────────────────────
const videoEl   = document.getElementById('videoEl');
const canvasEl  = document.getElementById('canvasEl');
const ctx       = canvasEl.getContext('2d');
const logFeed   = document.getElementById('log-feed');

// ── INIT ─────────────────────────────────────────────────────
window.addEventListener('load', async () => {
  log('Initializing system…', 'info');
  await startCamera();
  await loadFaceApiModels();
  loadSavedData();
  initVoice();
  renderGallery();
  log('System ready', 'info');

  // Enter key on cmd input
  document.getElementById('cmd-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') processTextCommand();
  });
  document.getElementById('enroll-name').addEventListener('keydown', e => {
    if (e.key === 'Enter') enrollFace();
  });
});

// ── CAMERA ───────────────────────────────────────────────────
async function startCamera() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false
    });
    videoEl.srcObject = stream;
    await new Promise(r => videoEl.onloadedmetadata = r);
    canvasEl.width  = videoEl.videoWidth  || 640;
    canvasEl.height = videoEl.videoHeight || 480;
    STATE.cameraReady = true;
    setPill('pill-cam', 'CAM ON', 'on');
    log('Camera started', 'info');
    requestAnimationFrame(renderLoop);
  } catch(e) {
    log('Camera error: ' + e.message, 'error');
  }
}

// ── FACE-API MODELS ───────────────────────────────────────────
const MODEL_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model';

async function loadFaceApiModels() {
  try {
    setPill('pill-models', 'LOADING…', '');
    // Wait for face-api to be defined
    let tries = 0;
    while (typeof faceapi === 'undefined' && tries < 50) {
      await sleep(200); tries++;
    }
    if (typeof faceapi === 'undefined') throw new Error('face-api not loaded');

    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
      faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
      faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
      faceapi.nets.faceExpressionNet.loadFromUri(MODEL_URL),
      faceapi.nets.ageGenderNet.loadFromUri(MODEL_URL),
    ]);
    STATE.modelsLoaded = true;
    setPill('pill-models', 'MODELS ✓', 'on');
    log('Face-API models loaded', 'info');
  } catch(e) {
    log('Model load error: ' + e.message, 'error');
    setPill('pill-models', 'MODEL ERR', '');
  }
}

// ── MEDIAPIPE INIT ────────────────────────────────────────────
let mpHands = null, mpPose = null, mpFaceMesh = null;

async function initMediaPipe() {
  if (!mpHands && typeof Hands !== 'undefined') {
    mpHands = new Hands({ locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${f}` });
    mpHands.setOptions({ maxNumHands: 2, modelComplexity: 1, minDetectionConfidence: 0.7, minTrackingConfidence: 0.5 });
    mpHands.onResults(onHandResults);
    log('MediaPipe Hands ready', 'info');
  }
  if (!mpPose && typeof Pose !== 'undefined') {
    mpPose = new Pose({ locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${f}` });
    mpPose.setOptions({ modelComplexity: 1, smoothLandmarks: true, minDetectionConfidence: 0.5 });
    mpPose.onResults(onPoseResults);
    log('MediaPipe Pose ready', 'info');
  }
}

// ── RENDER LOOP ───────────────────────────────────────────────
let frameCount = 0;
async function renderLoop() {
  if (!STATE.cameraReady || STATE.paused) {
    requestAnimationFrame(renderLoop);
    return;
  }
  frameCount++;
  ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);

  // Run face-api modules every 3 frames
  if (frameCount % 3 === 0 && STATE.modelsLoaded) {
    const mods = STATE.activeModules;
    if (mods.has('face') || mods.has('recog') || mods.has('emotion') || mods.has('age')) {
      await runFaceApi();
    }
  }

  // MediaPipe Hands every 2 frames
  if (frameCount % 2 === 0 && STATE.activeModules.has('hands') && mpHands) {
    await mpHands.send({ image: videoEl });
  }
  // MediaPipe Pose every 4 frames
  if (frameCount % 4 === 0 && STATE.activeModules.has('pose') && mpPose) {
    await mpPose.send({ image: videoEl });
  }

  requestAnimationFrame(renderLoop);
}

// ── FACE-API RUNNER ───────────────────────────────────────────
let detectionChips = [];
async function runFaceApi() {
  if (!STATE.modelsLoaded || !videoEl.readyState) return;
  const mods = STATE.activeModules;
  const opts = new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 });

  let task = faceapi.detectAllFaces(videoEl, opts);
  if (mods.has('face'))    task = task.withFaceLandmarks();
  if (mods.has('recog'))   task = task.withFaceLandmarks().withFaceDescriptors();
  if (mods.has('emotion')) task = task.withFaceExpressions();
  if (mods.has('age'))     task = task.withAgeAndGender();

  const results = await task;
  if (!results.length) { clearChips(); return; }

  const dims = { width: canvasEl.width, height: canvasEl.height };
  const resized = faceapi.resizeResults(results, dims);

  ctx.save();
  ctx.scale(-1, 1);
  ctx.translate(-canvasEl.width, 0);

  const chips = [];
  resized.forEach((det, i) => {
    const box = det.detection.box;
    const score = (det.detection.score * 100).toFixed(0);

    // Draw box
    ctx.strokeStyle = '#00f5ff';
    ctx.lineWidth = 2;
    ctx.strokeRect(box.x, box.y, box.width, box.height);

    // Landmarks
    if (mods.has('face') && det.landmarks) {
      faceapi.draw.drawFaceLandmarks(canvasEl, det, { drawLines: true, color: 'rgba(0,245,255,0.4)' });
    }

    // Labels
    let label = `FACE ${i+1} (${score}%)`;

    // Recognition
    if (mods.has('recog') && det.descriptor && STATE.faceDescriptors.length) {
      const match = recognizeFace(det.descriptor);
      if (match) label = `✓ ${match.toUpperCase()} (${score}%)`;
    }

    // Emotion
    if (mods.has('emotion') && det.expressions) {
      const top = Object.entries(det.expressions).sort((a,b)=>b[1]-a[1])[0];
      label += ` | ${top[0].toUpperCase()} ${(top[1]*100).toFixed(0)}%`;
    }

    // Age/Gender
    if (mods.has('age') && det.age != null) {
      label += ` | ${det.gender?.toUpperCase()} ~${Math.round(det.age)}yr`;
    }

    chips.push(label);

    // Draw label
    ctx.fillStyle = 'rgba(10,10,18,0.85)';
    ctx.fillRect(box.x, box.y - 20, Math.min(label.length * 7, 300), 20);
    ctx.fillStyle = '#00f5ff';
    ctx.font = '11px Share Tech Mono, monospace';
    ctx.fillText(label, box.x + 4, box.y - 6);
  });

  ctx.restore();
  updateChips(chips);
}

// ── FACE RECOGNITION ─────────────────────────────────────────
function recognizeFace(descriptor) {
  if (!STATE.faceDescriptors.length) return null;
  let best = null, bestDist = Infinity;
  STATE.faceDescriptors.forEach(({ name, descriptor: saved }) => {
    const dist = faceapi.euclideanDistance(descriptor, saved);
    if (dist < bestDist) { bestDist = dist; best = name; }
  });
  return bestDist < 0.6 ? best : 'UNKNOWN';
}

// ── MEDIAPIPE HAND RESULTS ────────────────────────────────────
const PALM_LANDMARKS = [0,1,2,3,5,6,9,10,13,14,17];
function onHandResults(results) {
  if (!results.multiHandLandmarks?.length) return;

  ctx.save();
  ctx.scale(-1, 1);
  ctx.translate(-canvasEl.width, 0);

  results.multiHandLandmarks.forEach((landmarks, i) => {
    drawConnectors(ctx, landmarks, HAND_CONNECTIONS, { color: '#7b2fff', lineWidth: 2 });
    drawLandmarks(ctx, landmarks, { color: '#ff006e', lineWidth: 1, radius: 3 });

    const gesture = classifyGesture(landmarks);
    if (gesture) onGestureDetected(gesture);
  });

  ctx.restore();
}

// ── GESTURE CLASSIFIER ────────────────────────────────────────
function classifyGesture(lm) {
  const fingers = getFingerStates(lm);
  const [thumb, index, middle, ring, pinky] = fingers;

  // ✌️ Peace — index + middle up, others down
  if (!thumb && index && middle && !ring && !pinky) return 'PEACE';
  // 👍 Thumbs up — only thumb up
  if (thumb && !index && !middle && !ring && !pinky) return 'THUMBS_UP';
  // 👎 Thumbs down (thumb down orientation check)
  // 👊 Fist — all fingers down
  if (!thumb && !index && !middle && !ring && !pinky) return 'FIST';
  // ✋ Open palm — all fingers up
  if (thumb && index && middle && ring && pinky) return 'OPEN_PALM';
  // ☝️ Point up — only index up
  if (!thumb && index && !middle && !ring && !pinky) return 'POINT';
  // 🤙 Call me — thumb + pinky
  if (thumb && !index && !middle && !ring && pinky) return 'CALL';
  // 🤏 Pinch — thumb + index close
  if (isPinch(lm)) return 'PINCH';

  return null;
}

function getFingerStates(lm) {
  // Returns [thumb, index, middle, ring, pinky] — true = extended
  const tips   = [4, 8, 12, 16, 20];
  const joints = [3, 6, 10, 14, 18];
  return tips.map((tip, i) => {
    if (i === 0) return lm[tip].x < lm[joints[i]].x; // thumb horizontal
    return lm[tip].y < lm[joints[i]].y;
  });
}

function isPinch(lm) {
  const dx = lm[4].x - lm[8].x;
  const dy = lm[4].y - lm[8].y;
  return Math.sqrt(dx*dx + dy*dy) < 0.05;
}

// ── GESTURE → COMMAND ─────────────────────────────────────────
const GESTURE_COOLDOWN = 1500; // ms between same gesture
function onGestureDetected(gesture) {
  const now = Date.now();
  if (gesture === STATE.lastGesture && now - STATE.lastGestureTime < GESTURE_COOLDOWN) return;
  STATE.lastGesture = gesture;
  STATE.lastGestureTime = now;

  const map = {
    PEACE:      () => toggleModule('face'),
    THUMBS_UP:  () => toggleModule('recog'),
    FIST:       () => stopAll(),
    OPEN_PALM:  () => togglePause(),
    POINT:      () => toggleModule('pose'),
    CALL:       () => toggleVoice(),
    PINCH:      () => captureSnapshot(),
  };

  if (map[gesture]) {
    showGestureIndicator(gesture);
    log(`Gesture: ${gesture}`, 'cmd');
    map[gesture]();
  }
}

function showGestureIndicator(gesture) {
  const labels = {
    PEACE: '✌️ Face Detection',
    THUMBS_UP: '👍 Recognize',
    FIST: '👊 Stop All',
    OPEN_PALM: '✋ Pause',
    POINT: '☝️ Pose',
    CALL: '🤙 Voice',
    PINCH: '🤏 Capture',
  };
  const el = document.getElementById('gesture-indicator');
  el.textContent = labels[gesture] || gesture;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 1500);
}

// ── MEDIAPIPE POSE RESULTS ────────────────────────────────────
function onPoseResults(results) {
  if (!results.poseLandmarks) return;
  ctx.save();
  ctx.scale(-1, 1);
  ctx.translate(-canvasEl.width, 0);
  drawConnectors(ctx, results.poseLandmarks, POSE_CONNECTIONS, { color: '#00ff88', lineWidth: 2 });
  drawLandmarks(ctx, results.poseLandmarks, { color: '#7b2fff', radius: 4 });
  ctx.restore();
}

// ── VOICE CONTROL ─────────────────────────────────────────────
let recognition = null;
function initVoice() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { log('Speech API not supported', 'error'); return; }
  recognition = new SR();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = 'en-US';

  recognition.onresult = (e) => {
    const t = document.getElementById('voice-transcript');
    let interim = '', final = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const txt = e.results[i][0].transcript.toLowerCase().trim();
      if (e.results[i].isFinal) final = txt;
      else interim = txt;
    }
    t.textContent = final || interim || '…';
    if (final) {
      log(`Voice: "${final}"`, 'cmd');
      processVoiceCommand(final);
    }
  };

  recognition.onerror = (e) => {
    if (e.error !== 'no-speech') log('Voice error: ' + e.error, 'error');
  };

  recognition.onend = () => {
    if (STATE.voiceActive) recognition.start();
  };

  animateVoiceBars();
}

function toggleVoice() {
  if (!recognition) { log('Voice not supported', 'error'); return; }
  STATE.voiceActive = !STATE.voiceActive;
  const btn = document.getElementById('voice-btn');
  const t   = document.getElementById('voice-transcript');
  if (STATE.voiceActive) {
    recognition.start();
    btn.classList.add('on');
    btn.textContent = '🎤 LISTENING';
    t.classList.add('listening');
    t.textContent = 'Listening…';
    setPill('pill-voice', 'MIC ON', 'on');
    log('Voice activated', 'cmd');
  } else {
    recognition.stop();
    btn.classList.remove('on');
    btn.textContent = '🎤 VOICE';
    t.classList.remove('listening');
    t.textContent = 'Say a command…';
    setPill('pill-voice', 'MIC OFF', '');
    log('Voice deactivated', 'cmd');
  }
}

// Animate voice bars randomly when active
function animateVoiceBars() {
  const bars = Array.from({ length: 8 }, (_, i) => document.getElementById(`vb${i+1}`));
  setInterval(() => {
    bars.forEach(b => {
      if (!b) return;
      const h = STATE.voiceActive ? 4 + Math.random() * 32 : 3;
      b.style.height = h + 'px';
      b.classList.toggle('active', STATE.voiceActive);
    });
  }, 80);
}

// ── VOICE COMMAND PARSER ──────────────────────────────────────
function processVoiceCommand(cmd) {
  cmd = cmd.toLowerCase().trim();
  if (cmd.includes('start face') || cmd.includes('face detection')) toggleModule('face', true);
  else if (cmd.includes('recognize') || cmd.includes('who is') || cmd.includes('who\'s')) toggleModule('recog', true);
  else if (cmd.includes('emotion')) toggleModule('emotion', true);
  else if (cmd.includes('age') || cmd.includes('gender')) toggleModule('age', true);
  else if (cmd.includes('pose') || cmd.includes('body')) toggleModule('pose', true);
  else if (cmd.includes('hand') || cmd.includes('track hand')) toggleModule('hands', true);
  else if (cmd.includes('capture') || cmd.includes('snapshot') || cmd.includes('save photo')) captureSnapshot();
  else if (cmd.includes('stop')) stopAll();
  else if (cmd.includes('pause')) togglePause();
  else if (cmd.includes('clear all') || cmd.includes('reset')) clearAll();
  else if (cmd.includes('download') || cmd.includes('export')) downloadAll();
  else if (cmd.includes('show saved') || cmd.includes('gallery')) document.getElementById('gallery').scrollIntoView();
  else if (cmd.match(/save face as (.+)/)) {
    const name = cmd.match(/save face as (.+)/)[1].trim();
    document.getElementById('enroll-name').value = name;
    enrollFace();
  } else if (cmd.match(/forget (.+)/)) {
    const name = cmd.match(/forget (.+)/)[1].trim();
    forgetFace(name);
  }
}

// ── TEXT COMMAND PROCESSOR ────────────────────────────────────
function processTextCommand() {
  const inp = document.getElementById('cmd-input');
  const val = inp.value.trim();
  if (!val) return;
  log(`CMD: ${val}`, 'cmd');
  processVoiceCommand(val);
  inp.value = '';
}

// ── MODULE TOGGLER ────────────────────────────────────────────
async function toggleModule(name, forceOn = false) {
  if (forceOn && STATE.activeModules.has(name)) return;

  if (STATE.activeModules.has(name) && !forceOn) {
    STATE.activeModules.delete(name);
  } else {
    STATE.activeModules.add(name);
    // Init MediaPipe if needed
    if (name === 'hands' || name === 'pose') {
      await initMediaPipe();
    }
  }
  updateModuleUI();
  log(`Module ${name.toUpperCase()} ${STATE.activeModules.has(name) ? 'ON' : 'OFF'}`, 'detect');
}

function updateModuleUI() {
  const map = { face: 'btn-face', recog: 'btn-recog', emotion: 'btn-emotion', age: 'btn-age', pose: 'btn-pose', hands: 'btn-hands' };
  Object.entries(map).forEach(([mod, id]) => {
    const btn = document.getElementById(id);
    btn.classList.toggle('active', STATE.activeModules.has(mod));
  });

  const names = [...STATE.activeModules].map(m => m.toUpperCase()).join(' + ') || 'NO MODULE';
  setPill('pill-module', names, STATE.activeModules.size ? 'active' : '');
  document.getElementById('active-module-label').textContent =
    STATE.activeModules.size ? '— ' + names + ' —' : '— STANDBY —';
}

function stopAll() {
  STATE.activeModules.clear();
  updateModuleUI();
  clearChips();
  log('All modules stopped', 'info');
}

function togglePause() {
  STATE.paused = !STATE.paused;
  log(STATE.paused ? 'Paused' : 'Resumed', 'info');
}

function clearAll() {
  stopAll();
  STATE.captures = [];
  saveToIndexedDB();
  renderGallery();
  log('Cleared all', 'info');
}

// ── FACE ENROLLMENT ───────────────────────────────────────────
async function enrollFace() {
  const name = document.getElementById('enroll-name').value.trim();
  if (!name) { log('Enter a name first', 'error'); return; }
  if (!STATE.modelsLoaded) { log('Models not loaded', 'error'); return; }

  log(`Enrolling face as "${name}"…`, 'info');
  const opts = new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 });
  const result = await faceapi.detectSingleFace(videoEl, opts).withFaceLandmarks().withFaceDescriptor();

  if (!result) { log('No face detected — look at camera', 'error'); return; }

  // Remove existing entry for same name
  STATE.faceDescriptors = STATE.faceDescriptors.filter(d => d.name !== name);
  STATE.faceDescriptors.push({ name, descriptor: result.descriptor });
  saveToIndexedDB();
  document.getElementById('enroll-name').value = '';
  log(`✓ Face enrolled: "${name}"`, 'recog');
}

function forgetFace(name) {
  STATE.faceDescriptors = STATE.faceDescriptors.filter(d => d.name.toLowerCase() !== name.toLowerCase());
  saveToIndexedDB();
  log(`Forgot face: "${name}"`, 'info');
}

// ── CAPTURE SNAPSHOT ─────────────────────────────────────────
async function captureSnapshot() {
  // Flash
  const fl = document.getElementById('flash');
  fl.style.transition = 'none';
  fl.style.opacity = '0.9';
  setTimeout(() => { fl.style.transition = 'opacity 0.5s'; fl.style.opacity = '0'; }, 50);

  // Create canvas from video
  const snap = document.createElement('canvas');
  snap.width = videoEl.videoWidth;
  snap.height = videoEl.videoHeight;
  const sctx = snap.getContext('2d');
  sctx.scale(-1, 1);
  sctx.translate(-snap.width, 0);
  sctx.drawImage(videoEl, 0, 0);

  // Draw current canvas detections on top
  sctx.scale(-1, 1);
  sctx.translate(-snap.width, 0);
  sctx.drawImage(canvasEl, 0, 0);

  const dataUrl = snap.toDataURL('image/jpeg', 0.9);
  const capture = {
    id: Date.now(),
    dataUrl,
    timestamp: new Date().toISOString(),
    label: [...STATE.activeModules].join(',') || 'snapshot'
  };
  STATE.captures.unshift(capture);
  saveToIndexedDB();
  renderGallery();
  log(`📸 Captured — ${capture.label}`, 'capture');
}

// ── GALLERY ───────────────────────────────────────────────────
function renderGallery() {
  const g = document.getElementById('gallery');
  g.innerHTML = '';
  STATE.captures.slice(0, 18).forEach(cap => {
    const div = document.createElement('div');
    div.className = 'gallery-thumb';
    div.innerHTML = `<img src="${cap.dataUrl}" title="${cap.timestamp}">
      <button class="del" onclick="deleteCapture(${cap.id})">✕</button>`;
    g.appendChild(div);
  });
}

function deleteCapture(id) {
  STATE.captures = STATE.captures.filter(c => c.id !== id);
  saveToIndexedDB();
  renderGallery();
}

function clearGallery() {
  STATE.captures = [];
  saveToIndexedDB();
  renderGallery();
  log('Gallery cleared', 'info');
}

function downloadAll() {
  if (!STATE.captures.length) { log('No captures to download', 'error'); return; }
  STATE.captures.forEach((cap, i) => {
    const a = document.createElement('a');
    a.href = cap.dataUrl;
    a.download = `visionai_${i+1}_${cap.label}.jpg`;
    a.click();
  });
  // Also download face profiles
  if (STATE.faceDescriptors.length) {
    const json = JSON.stringify(STATE.faceDescriptors.map(d => ({
      name: d.name, descriptor: Array.from(d.descriptor)
    })), null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'visionai_faces.json';
    a.click();
  }
  log(`Downloaded ${STATE.captures.length} captures`, 'capture');
}

// ── INDEXEDDB STORAGE ─────────────────────────────────────────
let db;
async function openDB() {
  return new Promise((res, rej) => {
    const req = indexedDB.open('VisionAI', 1);
    req.onupgradeneeded = (e) => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains('captures')) d.createObjectStore('captures', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('faces')) d.createObjectStore('faces', { keyPath: 'name' });
    };
    req.onsuccess = (e) => res(e.target.result);
    req.onerror = rej;
  });
}

async function saveToIndexedDB() {
  try {
    db = db || await openDB();
    const tx = db.transaction(['captures', 'faces'], 'readwrite');
    // Captures
    const capStore = tx.objectStore('captures');
    await new Promise(r => { const c = capStore.clear(); c.onsuccess = r; });
    STATE.captures.forEach(c => capStore.put(c));
    // Faces
    const faceStore = tx.objectStore('faces');
    await new Promise(r => { const c = faceStore.clear(); c.onsuccess = r; });
    STATE.faceDescriptors.forEach(f => faceStore.put({ name: f.name, descriptor: Array.from(f.descriptor) }));
  } catch(e) {
    // IndexedDB may not be available in all contexts
  }
}

async function loadSavedData() {
  try {
    db = await openDB();
    // Load captures
    const tx1 = db.transaction('captures', 'readonly');
    const caps = await new Promise(r => {
      const items = [];
      tx1.objectStore('captures').openCursor().onsuccess = (e) => {
        const cur = e.target.result;
        if (cur) { items.push(cur.value); cur.continue(); }
        else r(items);
      };
    });
    STATE.captures = caps.sort((a, b) => b.id - a.id);

    // Load faces
    const tx2 = db.transaction('faces', 'readonly');
    const faces = await new Promise(r => {
      const items = [];
      tx2.objectStore('faces').openCursor().onsuccess = (e) => {
        const cur = e.target.result;
        if (cur) { items.push(cur.value); cur.continue(); }
        else r(items);
      };
    });
    STATE.faceDescriptors = faces.map(f => ({ name: f.name, descriptor: new Float32Array(f.descriptor) }));
    log(`Loaded ${caps.length} captures, ${faces.length} face profiles`, 'info');
    renderGallery();
  } catch(e) {}
}

// ── CHIP DISPLAY ──────────────────────────────────────────────
function updateChips(chips) {
  const el = document.getElementById('detections-overlay');
  el.innerHTML = chips.map(c => `<div class="det-chip">${c}</div>`).join('');
}
function clearChips() {
  document.getElementById('detections-overlay').innerHTML = '';
}

// ── LOG ───────────────────────────────────────────────────────
function log(msg, type = 'info') {
  const now = new Date();
  const ts = now.toTimeString().slice(0, 8);
  const entry = document.createElement('div');
  entry.className = `log-entry ${type}`;
  entry.innerHTML = `<span class="ts">${ts}</span><span class="msg">${msg}</span>`;
  logFeed.insertBefore(entry, logFeed.firstChild);
  // Keep max 100 entries
  while (logFeed.children.length > 100) logFeed.removeChild(logFeed.lastChild);
}

// ── PILL HELPER ───────────────────────────────────────────────
function setPill(id, text, cls) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text;
  el.className = 'pill' + (cls ? ' ' + cls : '');
  if (cls === 'on') el.innerHTML = `<span class="dot"></span>${text}`;
  if (cls === 'active') el.innerHTML = `<span class="dot" style="background:var(--accent)"></span>${text}`;
}

// ── UTILS ─────────────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Stub MediaPipe drawing if not loaded
if (typeof drawConnectors === 'undefined') window.drawConnectors = () => {};
if (typeof drawLandmarks  === 'undefined') window.drawLandmarks  = () => {};
if (typeof HAND_CONNECTIONS === 'undefined') window.HAND_CONNECTIONS = [];
if (typeof POSE_CONNECTIONS === 'undefined') window.POSE_CONNECTIONS = [];
