import { db } from './firebase-config.js';
import {
  collection, doc, setDoc, deleteDoc, onSnapshot, query, where
} from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js';

// ── State ──
let username = localStorage.getItem('untodo_username');
let currentDate = getLogicalDate();
let unsubscribe = null;
let tasks = [];

// Pomodoro
let pomoSeconds = 25 * 60;
let pomoInterval = null;
let pomoRunning = false;

// ── IST logical date (UTC+5:30) ──
function getLogicalDate() {
  const now = new Date();
  const ist = new Date(now.getTime() + (5.5 * 60 * 60 * 1000) - (now.getTimezoneOffset() * 60 * 1000));
  return ist.toISOString().slice(0, 10);
}

function formatDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const today = getLogicalDate();
  const opts = { weekday: 'long', month: 'long', day: 'numeric' };
  const formatted = d.toLocaleDateString('en-US', opts);
  if (dateStr === today) return `Today \u2022 ${formatted}`;
  const yesterday = shiftDate(today, -1);
  if (dateStr === yesterday) return `Yesterday \u2022 ${formatted}`;
  const tomorrow = shiftDate(today, 1);
  if (dateStr === tomorrow) return `Tomorrow \u2022 ${formatted}`;
  return formatted;
}

function shiftDate(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

// ── UUID ──
function uuid() {
  return crypto.randomUUID?.() || 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

// ── Score ──
function calcScore(tasks) {
  if (!tasks.length) return { grade: '\u2014', pct: 0 };
  const done = tasks.filter(t => t.completed).length;
  const pct = Math.round((done / tasks.length) * 100);
  let grade;
  if (pct === 100) grade = 'A+';
  else if (pct >= 90) grade = 'A';
  else if (pct >= 75) grade = 'B';
  else if (pct >= 60) grade = 'C';
  else if (pct >= 40) grade = 'D';
  else grade = 'F';
  return { grade, pct };
}

// ── Theme ──
function initTheme() {
  const saved = localStorage.getItem('untodo_theme') || 'light';
  document.documentElement.setAttribute('data-theme', saved);
  updateThemeBtn(saved);
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme');
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('untodo_theme', next);
  updateThemeBtn(next);
}

function updateThemeBtn(theme) {
  const btn = document.getElementById('theme-toggle');
  if (btn) btn.textContent = theme === 'dark' ? '\u2600' : '\u263E';
}

// ── Render ──
function renderApp() {
  const app = document.getElementById('app');
  if (!username) {
    app.innerHTML = `
      <div class="container">
        <div class="login-screen">
          <h1>un<span>todo</span></h1>
          <p>A mindful task companion. Enter your username to begin.</p>
          <div class="login-form">
            <input type="text" id="login-input" placeholder="username" autocomplete="off" autofocus>
            <button onclick="window._login()">Enter</button>
          </div>
        </div>
      </div>`;
    const input = document.getElementById('login-input');
    input?.addEventListener('keydown', e => { if (e.key === 'Enter') window._login(); });
    return;
  }

  app.innerHTML = `
    <div class="container">
      <header>
        <div class="header-top">
          <div class="logo">un<span>todo</span></div>
          <button class="theme-toggle" id="theme-toggle" onclick="window._toggleTheme()"></button>
        </div>
        <div class="date-nav">
          <button onclick="window._prevDay()">\u2190</button>
          <div class="date-label" id="date-label"></div>
          <button onclick="window._nextDay()">\u2192</button>
        </div>
      </header>

      <div class="score-section">
        <span class="score-badge" id="score-badge"></span>
        <span class="score-label" id="score-label"></span>
      </div>

      <div class="add-form">
        <input type="text" id="task-input" placeholder="What needs doing?" autocomplete="off">
        <button onclick="window._addTask()">Add</button>
      </div>

      <ul class="task-list" id="task-list"></ul>

      <div class="pomodoro">
        <div class="pomo-title">Pomodoro</div>
        <div class="pomo-time" id="pomo-time">25:00</div>
        <div class="pomo-controls">
          <button class="pomo-btn primary" id="pomo-start" onclick="window._pomoToggle()">Start</button>
          <button class="pomo-btn" onclick="window._pomoReset()">Reset</button>
        </div>
      </div>

      <footer>untodo &middot; ${username}</footer>
    </div>`;

  updateThemeBtn(document.documentElement.getAttribute('data-theme'));
  document.getElementById('date-label').textContent = formatDate(currentDate);

  const input = document.getElementById('task-input');
  input?.addEventListener('keydown', e => { if (e.key === 'Enter') window._addTask(); });

  renderTasks();
  renderPomo();
  startListening();
}

function renderTasks() {
  const list = document.getElementById('task-list');
  if (!list) return;

  const { grade, pct } = calcScore(tasks);
  const badge = document.getElementById('score-badge');
  const label = document.getElementById('score-label');
  if (badge) badge.textContent = grade;
  if (label) label.textContent = tasks.length ? `${pct}% \u2022 ${tasks.filter(t => t.completed).length}/${tasks.length} done` : 'No tasks yet';

  if (!tasks.length) {
    list.innerHTML = `<div class="empty-state"><div class="zen">\u5186</div>Nothing here. Enjoy the stillness.</div>`;
    return;
  }

  list.innerHTML = tasks.map(t => `
    <li class="task-item ${t.completed ? 'completed' : ''}" data-id="${t.id}">
      <input type="checkbox" class="task-check" ${t.completed ? 'checked' : ''} onchange="window._toggleTask('${t.id}')">
      <span class="task-title">${escapeHtml(t.title)}</span>
      <button class="task-delete" onclick="window._deleteTask('${t.id}')">&times;</button>
    </li>
  `).join('');
}

function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

// ── Firestore ──
function startListening() {
  if (unsubscribe) unsubscribe();
  const ref = collection(db, 'users', username, 'tasks');
  const q = query(ref, where('logicalDate', '==', currentDate));
  unsubscribe = onSnapshot(q, snap => {
    tasks = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    tasks.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    renderTasks();
  }, err => {
    console.error('Firestore listener error:', err);
  });
}

async function addTask() {
  const input = document.getElementById('task-input');
  const title = input?.value.trim();
  if (!title) return;
  input.value = '';

  const id = uuid();
  const ref = doc(db, 'users', username, 'tasks', id);
  await setDoc(ref, {
    title,
    completed: false,
    logicalDate: currentDate,
    createdAt: Date.now(),
  });
}

async function toggleTask(id) {
  const task = tasks.find(t => t.id === id);
  if (!task) return;
  const ref = doc(db, 'users', username, 'tasks', id);
  await setDoc(ref, { completed: !task.completed }, { merge: true });
}

async function deleteTask(id) {
  const item = document.querySelector(`[data-id="${id}"]`);
  if (item) {
    item.classList.add('deleting');
    await new Promise(r => setTimeout(r, 250));
  }
  const ref = doc(db, 'users', username, 'tasks', id);
  await deleteDoc(ref);
}

// ── Date nav ──
function prevDay() {
  currentDate = shiftDate(currentDate, -1);
  document.getElementById('date-label').textContent = formatDate(currentDate);
  startListening();
}

function nextDay() {
  currentDate = shiftDate(currentDate, 1);
  document.getElementById('date-label').textContent = formatDate(currentDate);
  startListening();
}

// ── Pomodoro ──
function renderPomo() {
  const el = document.getElementById('pomo-time');
  if (!el) return;
  const m = Math.floor(pomoSeconds / 60);
  const s = pomoSeconds % 60;
  el.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  const btn = document.getElementById('pomo-start');
  if (btn) btn.textContent = pomoRunning ? 'Pause' : 'Start';
}

function pomoToggle() {
  if (pomoRunning) {
    clearInterval(pomoInterval);
    pomoRunning = false;
  } else {
    pomoRunning = true;
    pomoInterval = setInterval(() => {
      if (pomoSeconds <= 0) {
        clearInterval(pomoInterval);
        pomoRunning = false;
        renderPomo();
        if (Notification.permission === 'granted') {
          new Notification('Pomodoro complete!', { body: 'Time for a break.' });
        }
        return;
      }
      pomoSeconds--;
      renderPomo();
    }, 1000);
  }
  renderPomo();
}

function pomoReset() {
  clearInterval(pomoInterval);
  pomoRunning = false;
  pomoSeconds = 25 * 60;
  renderPomo();
}

// ── Login ──
function login() {
  const input = document.getElementById('login-input');
  const val = input?.value.trim().toLowerCase();
  if (!val) return;
  username = val;
  localStorage.setItem('untodo_username', username);
  renderApp();
}

// ── Expose to HTML ──
window._login = login;
window._addTask = addTask;
window._toggleTask = toggleTask;
window._deleteTask = deleteTask;
window._prevDay = prevDay;
window._nextDay = nextDay;
window._toggleTheme = toggleTheme;
window._pomoToggle = pomoToggle;
window._pomoReset = pomoReset;

// ── Init ──
initTheme();
renderApp();

// Request notification permission for pomodoro
if ('Notification' in window && Notification.permission === 'default') {
  Notification.requestPermission();
}
