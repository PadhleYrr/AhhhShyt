// ============================================
//  UNREAL - AI Assistant Core
//  Brain: Groq API (Llama 3.3 70B)
//  Voice In: Web Speech API
//  Voice Out: SpeechSynthesis API
// ============================================

const UNREAL_SYSTEM_PROMPT = `You are Unreal, a highly intelligent female AI assistant. Think J.A.R.V.I.S. but female, sharp, and slightly witty.
Your personality:
- Confident, calm, efficient — like a real Iron Man assistant
- Speak in short, clear sentences. No long essays.
- Occasionally use light wit, but stay professional
- Address the user directly, warmly but efficiently
- Never say "As an AI" or "I'm just a language model" — you ARE Unreal
- You can help with anything: questions, actions, planning, analysis

For phone actions like calls, messages, alarms, opening apps — respond with a JSON action block like:
{"action": "call", "target": "Mom"}
{"action": "message", "target": "Rahul", "text": "On my way"}
{"action": "alarm", "time": "07:00"}
{"action": "open_app", "app": "YouTube"}
{"action": "search", "query": "weather today"}
Otherwise just respond normally in plain text.`;

// ---- State ----
let isListening = false;
let isSpeaking = false;
let voiceEnabled = true;
let recognition = null;
let selectedVoice = null;
let conversationHistory = [];

// ---- DOM ----
const hudContainer = document.querySelector('.hud-container');
const speakBtn = document.getElementById('speakBtn');
const btnText = document.getElementById('btnText');
const transcriptText = document.getElementById('transcriptText');
const responseText = document.getElementById('responseText');
const statusDot = document.getElementById('statusDot');

// ---- Init ----
window.addEventListener('load', () => {
  loadSettings();
  initVoices();
  speak("Systems online. I'm Unreal. How can I assist you today?");
});

// ---- Settings ----
function loadSettings() {
  const key = localStorage.getItem('unreal_api_key');
  const wake = localStorage.getItem('unreal_wake');
  if (key) document.getElementById('apiKeyInput').value = key;
  if (wake) document.getElementById('wakeInput').value = wake;
}

function saveSettings() {
  const key = document.getElementById('apiKeyInput').value.trim();
  const wake = document.getElementById('wakeInput').value.trim();
  const voiceIdx = document.getElementById('voiceSelect').value;
  if (key) localStorage.setItem('unreal_api_key', key);
  if (wake) localStorage.setItem('unreal_wake', wake);
  if (voiceIdx) localStorage.setItem('unreal_voice', voiceIdx);
  selectedVoice = speechSynthesis.getVoices()[voiceIdx] || null;
  closeSettings();
  speak("Configuration saved. Ready.");
}

function showSettings() { document.getElementById('settingsPanel').style.display = 'flex'; }
function closeSettings() { document.getElementById('settingsPanel').style.display = 'none'; }

// ---- Voice Output (TTS) ----
function initVoices() {
  const loadVoices = () => {
    const voices = speechSynthesis.getVoices();
    const select = document.getElementById('voiceSelect');
    select.innerHTML = '<option value="">Auto (System Default)</option>';
    voices.forEach((v, i) => {
      const opt = document.createElement('option');
      opt.value = i;
      opt.textContent = `${v.name} (${v.lang})`;
      select.appendChild(opt);
    });
    // Auto-pick a female English voice
    const savedIdx = localStorage.getItem('unreal_voice');
    if (savedIdx) {
      selectedVoice = voices[savedIdx];
    } else {
      selectedVoice = voices.find(v =>
        v.name.toLowerCase().includes('female') ||
        v.name.includes('Samantha') ||
        v.name.includes('Victoria') ||
        v.name.includes('Zira') ||
        v.name.includes('Google UK English Female') ||
        (v.lang.startsWith('en') && v.name.toLowerCase().includes('f'))
      ) || voices.find(v => v.lang.startsWith('en')) || voices[0];
    }
  };
  speechSynthesis.onvoiceschanged = loadVoices;
  loadVoices();
}

function speak(text) {
  if (!voiceEnabled || !text) return;
  speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  utter.voice = selectedVoice;
  utter.rate = 1.05;
  utter.pitch = 1.1;
  utter.volume = 1;
  utter.onstart = () => {
    isSpeaking = true;
    hudContainer.classList.add('speaking');
    statusDot.textContent = '● SPEAKING';
    statusDot.style.color = '#00ff88';
  };
  utter.onend = () => {
    isSpeaking = false;
    hudContainer.classList.remove('speaking');
    statusDot.textContent = '● ONLINE';
    statusDot.style.color = '#00ff88';
  };
  speechSynthesis.speak(utter);
}

function toggleVoice() {
  voiceEnabled = !voiceEnabled;
  document.getElementById('voiceToggle').textContent = voiceEnabled ? '🔊 VOICE ON' : '🔇 VOICE OFF';
  speechSynthesis.cancel();
}

// ---- Voice Input (STT) ----
function initRecognition() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    showResponse("Speech recognition not supported on this browser. Use Chrome.");
    return null;
  }
  const r = new SR();
  r.continuous = false;
  r.interimResults = true;
  r.lang = 'en-IN';

  r.onstart = () => {
    isListening = true;
    hudContainer.classList.add('listening');
    speakBtn.classList.add('active');
    btnText.textContent = 'LISTENING...';
    statusDot.textContent = '● LISTENING';
    statusDot.style.color = '#ff4d6d';
    transcriptText.textContent = '';
  };

  r.onresult = (e) => {
    let interim = '';
    let final = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const t = e.results[i][0].transcript;
      if (e.results[i].isFinal) final += t;
      else interim += t;
    }
    transcriptText.textContent = final || interim;
    if (final) processInput(final.trim());
  };

  r.onerror = (e) => {
    console.error('Speech error:', e.error);
    resetListeningState();
    if (e.error === 'no-speech') showResponse("I didn't catch that. Tap to try again.");
    else if (e.error === 'not-allowed') showResponse("Microphone permission denied. Please allow mic access.");
  };

  r.onend = () => resetListeningState();

  return r;
}

function toggleListening() {
  if (isSpeaking) { speechSynthesis.cancel(); return; }
  if (isListening) {
    recognition?.stop();
    return;
  }
  recognition = initRecognition();
  if (recognition) recognition.start();
}

function resetListeningState() {
  isListening = false;
  hudContainer.classList.remove('listening');
  speakBtn.classList.remove('active');
  btnText.textContent = 'TAP TO SPEAK';
  statusDot.textContent = '● ONLINE';
  statusDot.style.color = '#00ff88';
}

// ---- Groq API ----
async function callGroq(userMessage) {
  const apiKey = localStorage.getItem('unreal_api_key');
  if (!apiKey) {
    return "Please set your Groq API key in Config settings first.";
  }

  conversationHistory.push({ role: 'user', content: userMessage });
  if (conversationHistory.length > 20) conversationHistory = conversationHistory.slice(-20);

  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: UNREAL_SYSTEM_PROMPT },
          ...conversationHistory
        ],
        max_tokens: 300,
        temperature: 0.75
      })
    });

    if (!res.ok) {
      const err = await res.json();
      return `API Error: ${err.error?.message || 'Unknown error'}`;
    }

    const data = await res.json();
    const reply = data.choices[0]?.message?.content?.trim() || "I couldn't process that.";
    conversationHistory.push({ role: 'assistant', content: reply });
    return reply;

  } catch (e) {
    return "Network error. Check your connection.";
  }
}

// ---- Process Input ----
async function processInput(text) {
  if (!text) return;

  showResponse("Processing...", true);
  statusDot.textContent = '● THINKING';
  statusDot.style.color = '#ffaa00';

  const reply = await callGroq(text);

  // Check if it's a JSON action
  const actionMatch = reply.match(/\{[\s\S]*?"action"[\s\S]*?\}/);
  if (actionMatch) {
    try {
      const action = JSON.parse(actionMatch[0]);
      const voiceReply = reply.replace(actionMatch[0], '').trim() || `Executing ${action.action}.`;
      showResponse(voiceReply);
      speak(voiceReply);
      executeAction(action);
      return;
    } catch(e) {}
  }

  showResponse(reply);
  speak(reply);
}

// ---- Phone Actions via Android Intents ----
function executeAction(action) {
  const { action: type, target, text, time, app, query } = action;

  switch(type) {
    case 'call':
      window.location.href = `tel:${encodeURIComponent(target || '')}`;
      break;
    case 'message':
      window.location.href = `sms:${encodeURIComponent(target || '')}?body=${encodeURIComponent(text || '')}`;
      break;
    case 'search':
      window.open(`https://www.google.com/search?q=${encodeURIComponent(query || target || '')}`, '_blank');
      break;
    case 'open_app':
      // Try Android intent for common apps
      const appIntents = {
        'youtube': 'vnd.youtube:',
        'whatsapp': 'whatsapp://',
        'maps': 'geo:0,0?q=',
        'camera': 'content://media/external/images/media',
        'settings': 'android.settings.SETTINGS',
      };
      const appLower = (app || '').toLowerCase();
      const intent = Object.keys(appIntents).find(k => appLower.includes(k));
      if (intent) window.location.href = appIntents[intent];
      else window.open(`https://play.google.com/store/search?q=${encodeURIComponent(app)}`, '_blank');
      break;
    case 'alarm':
      // Android alarm intent via intent:// URL
      window.location.href = `intent://set#Intent;action=android.intent.action.SET_ALARM;S.android.intent.extra.alarm.MESSAGE=Unreal Alarm;i.android.intent.extra.alarm.HOUR=${time?.split(':')[0] || 7};i.android.intent.extra.alarm.MINUTES=${time?.split(':')[1] || 0};end`;
      break;
    default:
      console.log('Unknown action:', type);
  }
}

// ---- UI Helpers ----
function showResponse(text, isTyping = false) {
  responseText.className = isTyping ? 'typing' : '';
  responseText.textContent = text;
}

function clearChat() {
  conversationHistory = [];
  transcriptText.textContent = 'Say something to Unreal...';
  responseText.textContent = 'Memory cleared. Ready for new session.';
  responseText.className = '';
  speak("Memory cleared. Ready.");
}
