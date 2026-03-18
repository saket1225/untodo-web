/* ========================================
   untodo web — app.js
   All logic, Firebase sync, rendering
   ======================================== */

import { db } from './firebase-config.js';
import {
  collection, query, where, onSnapshot, addDoc, updateDoc, deleteDoc, doc,
  getDocs, orderBy
} from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js';

// ── State ──────────────────────────────────────────
let username = localStorage.getItem('untodo_username') || '';
let currentDate = getTodayIST();
let tasks = [];
let allTasks = null;
let selectedPriority = null;
let completedOpen = JSON.parse(localStorage.getItem('untodo_completed_open') || 'false');
let activeTab = 'today';
let unsubscribe = null;

// ── IST Date Helpers ───────────────────────────────
function getTodayIST() {
  const now = new Date();
  const istMs = now.getTime() + (5.5 * 60 * 60 * 1000);
  const ist = new Date(istMs);
  return ist.toISOString().split('T')[0];
}

function formatDate(dateStr) {
  const today = getTodayIST();
  const d = new Date(dateStr + 'T00:00:00');
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const months = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  const label = `${days[d.getDay()]}, ${months[d.getMonth()]} ${d.getDate()}`;
  return dateStr === today ? `Today · ${label}` : label;
}

function shiftDate(dateStr, delta) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + delta);
  return d.toISOString().split('T')[0];
}

function isPast(dateStr) {
  return dateStr < getTodayIST();
}

// ── Score / Grade ──────────────────────────────────
function calcGrade(completed, total) {
  if (total === 0) return { grade: '-', pct: 0 };
  const pct = Math.round((completed / total) * 100);
  let grade;
  if (pct >= 95) grade = 'A+';
  else if (pct >= 85) grade = 'A';
  else if (pct >= 75) grade = 'B+';
  else if (pct >= 65) grade = 'B';
  else if (pct >= 50) grade = 'C';
  else if (pct >= 30) grade = 'D';
  else grade = 'F';
  return { grade, pct };
}

// ── UUID ───────────────────────────────────────────
function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

// ── Theme ──────────────────────────────────────────
function getThemePref() {
  return localStorage.getItem('untodo_theme') || 'system';
}

function resolveTheme() {
  const pref = getThemePref();
  if (pref === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return pref;
}

function applyTheme() {
  const resolved = resolveTheme();
  document.documentElement.setAttribute('data-theme', resolved);
  const btn = document.getElementById('theme-toggle');
  if (btn) btn.textContent = resolved === 'dark' ? '☀️' : '🌙';
  updateThemeSelector();
}

function updateThemeSelector() {
  const pref = getThemePref();
  document.querySelectorAll('.theme-option').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.theme === pref);
  });
}

// ── Firebase ───────────────────────────────────────
function tasksRef() {
  return collection(db, 'users', username, 'tasks');
}

function subscribeToDate(dateStr) {
  if (unsubscribe) unsubscribe();
  const q = query(tasksRef(), where('logicalDate', '==', dateStr), orderBy('createdAt', 'asc'));
  unsubscribe = onSnapshot(q, snap => {
    tasks = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderTasks();
  }, err => {
    console.error('Firestore error:', err);
  });
}

async function addTask(title, priority, category) {
  await addDoc(tasksRef(), {
    title,
    completed: false,
    logicalDate: currentDate,
    createdAt: Date.now(),
    priority: priority || null,
    category: category || null,
    source: 'web',
    carriedOverFrom: null,
    notes: ''
  });
}

async function toggleTask(taskId, currentVal) {
  await updateDoc(doc(db, 'users', username, 'tasks', taskId), {
    completed: !currentVal
  });
}

async function deleteTaskById(taskId) {
  // Animate out
  const el = document.querySelector(`.task-item[data-id="${taskId}"]`);
  if (el) {
    el.classList.add('deleting');
    await new Promise(r => setTimeout(r, 250));
  }
  await deleteDoc(doc(db, 'users', username, 'tasks', taskId));
}

async function carryOverTask(task) {
  const today = getTodayIST();
  await addDoc(tasksRef(), {
    title: task.title,
    completed: false,
    logicalDate: today,
    createdAt: Date.now(),
    priority: task.priority || null,
    category: task.category || null,
    source: 'web',
    carriedOverFrom: task.logicalDate,
    notes: task.notes || ''
  });
}

async function fetchAllTasks() {
  const snap = await getDocs(tasksRef());
  allTasks = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  return allTasks;
}

// ── Rendering: Today Tab ───────────────────────────
function renderTasks() {
  const past = isPast(currentDate);
  const editable = !past;

  // Date label
  document.getElementById('date-label').textContent = formatDate(currentDate);

  // Past banner
  document.getElementById('past-banner').style.display = past ? 'block' : 'none';

  // Add form visibility
  document.getElementById('add-task-form').style.display = editable ? 'block' : 'none';

  const incomplete = tasks.filter(t => !t.completed);
  const completed = tasks.filter(t => t.completed);
  const total = tasks.length;

  // Score
  const { grade, pct } = calcGrade(completed.length, total);
  const scoreSection = document.getElementById('score-section');
  if (total > 0) {
    scoreSection.style.display = 'flex';
    document.getElementById('score-badge').textContent = grade;
    document.getElementById('score-label').textContent = `${pct}% · ${completed.length}/${total} done`;
  } else {
    scoreSection.style.display = 'none';
  }

  // Task list (incomplete)
  const listEl = document.getElementById('task-list');
  listEl.innerHTML = '';
  incomplete.forEach(task => {
    listEl.appendChild(createTaskEl(task, past));
  });

  // Empty state
  document.getElementById('empty-state').style.display =
    (incomplete.length === 0 && completed.length === 0) ? 'flex' : 'none';

  // Completed section
  const compSection = document.getElementById('completed-section');
  if (completed.length > 0) {
    compSection.style.display = 'block';
    document.getElementById('completed-count').textContent = completed.length;
    const compList = document.getElementById('completed-list');
    compList.innerHTML = '';
    compList.className = completedOpen ? 'completed-list open' : 'completed-list';
    document.getElementById('completed-chevron').className = completedOpen ? 'chevron open' : 'chevron';
    completed.forEach(task => {
      compList.appendChild(createTaskEl(task, past));
    });
  } else {
    compSection.style.display = 'none';
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function createTaskEl(task, past) {
  const el = document.createElement('div');
  el.className = 'task-item';
  el.setAttribute('data-id', task.id);
  if (task.completed) el.classList.add('completed');
  if (task.priority) el.classList.add(`priority-${task.priority}-border`);

  // Checkbox
  const checkbox = document.createElement('div');
  checkbox.className = 'task-checkbox';
  if (past) checkbox.classList.add('readonly');
  checkbox.textContent = task.completed ? '✓' : '';
  if (!past) {
    checkbox.addEventListener('click', () => toggleTask(task.id, task.completed));
  }

  // Body
  const body = document.createElement('div');
  body.className = 'task-body';

  const title = document.createElement('div');
  title.className = 'task-title';
  title.textContent = task.title;
  body.appendChild(title);

  // Meta row
  const hasMeta = task.category || task.carriedOverFrom;
  if (hasMeta) {
    const meta = document.createElement('div');
    meta.className = 'task-meta';
    if (task.category) {
      const chip = document.createElement('span');
      chip.className = 'category-chip';
      chip.textContent = task.category;
      meta.appendChild(chip);
    }
    if (task.carriedOverFrom) {
      const badge = document.createElement('span');
      badge.className = 'carried-badge';
      badge.textContent = `carried from ${task.carriedOverFrom}`;
      meta.appendChild(badge);
    }
    body.appendChild(meta);
  }

  el.appendChild(checkbox);
  el.appendChild(body);

  // Past incomplete: carry over button
  if (past && !task.completed) {
    const carryBtn = document.createElement('button');
    carryBtn.className = 'carry-over-btn';
    carryBtn.textContent = 'Carry Over';
    carryBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      carryBtn.textContent = '✓ Carried';
      carryBtn.disabled = true;
      carryBtn.style.opacity = '0.5';
      await carryOverTask(task);
    });
    el.appendChild(carryBtn);
  }

  // Delete button (only for today/future)
  if (!past) {
    const del = document.createElement('button');
    del.className = 'task-delete';
    del.textContent = '×';
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteTaskById(task.id);
    });
    el.appendChild(del);
  }

  return el;
}

// ── Rendering: Stats Tab ───────────────────────────
async function renderStats() {
  const all = await fetchAllTasks();
  const today = getTodayIST();

  // Hero card — today's snapshot
  const todayTasks = all.filter(t => t.logicalDate === today);
  const todayDone = todayTasks.filter(t => t.completed).length;
  const todayTotal = todayTasks.length;
  const { grade, pct } = calcGrade(todayDone, todayTotal);

  // Progress ring
  const circumference = 2 * Math.PI * 52; // ~326.73
  const offset = circumference - (pct / 100) * circumference;
  document.getElementById('progress-ring-fill').style.strokeDashoffset = offset;
  document.getElementById('progress-grade').textContent = grade;
  document.getElementById('hero-meta').textContent = `${todayDone}/${todayTotal} tasks · ${pct}%`;

  // Streak
  const streak = calcStreak(all);
  document.getElementById('hero-streak').textContent = streak > 0 ? `🔥 ${streak} day streak` : '';

  renderWeeklyChart(all);
  renderHeatmap(all);
  renderAchievements(all);
  renderDeepStats(all);
}

function buildDayMap(all) {
  const map = {};
  all.forEach(t => {
    if (!map[t.logicalDate]) map[t.logicalDate] = { total: 0, done: 0 };
    map[t.logicalDate].total++;
    if (t.completed) map[t.logicalDate].done++;
  });
  return map;
}

function calcStreak(all) {
  const dayMap = buildDayMap(all);
  const today = getTodayIST();
  let streak = 0;
  let d = today;
  while (true) {
    const info = dayMap[d];
    if (!info || info.total === 0) break;
    if (info.done < info.total) break;
    streak++;
    d = shiftDate(d, -1);
  }
  return streak;
}

function calcLongestStreak(all) {
  const dayMap = buildDayMap(all);
  const perfectDates = Object.keys(dayMap)
    .filter(d => dayMap[d].total > 0 && dayMap[d].done === dayMap[d].total)
    .sort();
  if (perfectDates.length === 0) return 0;
  let longest = 1, current = 1;
  for (let i = 1; i < perfectDates.length; i++) {
    if (perfectDates[i] === shiftDate(perfectDates[i - 1], 1)) {
      current++;
      if (current > longest) longest = current;
    } else {
      current = 1;
    }
  }
  return longest;
}

function renderWeeklyChart(all) {
  const today = getTodayIST();
  const todayObj = new Date(today + 'T00:00:00');
  const dow = todayObj.getDay(); // 0=Sun
  const mondayOff = dow === 0 ? -6 : 1 - dow;
  const monday = shiftDate(today, mondayOff);
  const labels = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  const dayMap = buildDayMap(all);

  const container = document.getElementById('weekly-chart');
  container.innerHTML = '';

  for (let i = 0; i < 7; i++) {
    const d = shiftDate(monday, i);
    const info = dayMap[d];
    const total = info ? info.total : 0;
    const done = info ? info.done : 0;
    const pctVal = total > 0 ? Math.round((done / total) * 100) : 0;
    const isToday = d === today;
    const hasData = total > 0;

    const wrapper = document.createElement('div');
    wrapper.className = 'week-bar-wrapper';

    const pctLabel = document.createElement('div');
    pctLabel.className = 'week-bar-pct';
    pctLabel.textContent = hasData ? `${pctVal}%` : '';

    const bar = document.createElement('div');
    bar.className = 'week-bar';
    if (isToday) bar.classList.add('today');
    if (hasData) bar.classList.add('has-data');
    bar.style.height = `${Math.max(4, (pctVal / 100) * 110)}px`;

    const label = document.createElement('div');
    label.className = 'week-day-label';
    label.textContent = labels[i];

    wrapper.appendChild(pctLabel);
    wrapper.appendChild(bar);
    wrapper.appendChild(label);
    container.appendChild(wrapper);
  }
}

function renderHeatmap(all) {
  const container = document.getElementById('heatmap-container');
  container.innerHTML = '';

  const today = getTodayIST();
  const dayMap = buildDayMap(all);
  const weeks = 12;
  const totalDays = weeks * 7;
  const startDate = shiftDate(today, -(totalDays - 1));

  const monthsRow = document.createElement('div');
  monthsRow.className = 'heatmap-months';

  const grid = document.createElement('div');
  grid.className = 'heatmap-grid';

  const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  let lastMonth = -1;

  for (let w = 0; w < weeks; w++) {
    const col = document.createElement('div');
    col.className = 'heatmap-col';

    for (let d = 0; d < 7; d++) {
      const idx = w * 7 + d;
      const dateStr = shiftDate(startDate, idx);
      const dateObj = new Date(dateStr + 'T00:00:00');

      // Month label (one per column, on first row)
      if (d === 0) {
        const m = dateObj.getMonth();
        const label = document.createElement('span');
        label.className = 'heatmap-month-label';
        if (m !== lastMonth) {
          label.textContent = monthNames[m];
          lastMonth = m;
        }
        monthsRow.appendChild(label);
      }

      const cell = document.createElement('div');
      cell.className = 'heatmap-cell';
      cell.title = dateStr;

      if (dateStr <= today) {
        const info = dayMap[dateStr];
        if (info && info.total > 0) {
          const rate = info.done / info.total;
          if (rate >= 0.9) cell.classList.add('level-4');
          else if (rate >= 0.65) cell.classList.add('level-3');
          else if (rate >= 0.35) cell.classList.add('level-2');
          else if (rate > 0) cell.classList.add('level-1');
        }
      }

      col.appendChild(cell);
    }
    grid.appendChild(col);
  }

  container.appendChild(monthsRow);
  container.appendChild(grid);
}

function renderAchievements(all) {
  const container = document.getElementById('achievements-grid');
  container.innerHTML = '';

  const totalCompleted = all.filter(t => t.completed).length;
  const longestStreak = calcLongestStreak(all);
  const dayMap = buildDayMap(all);

  const perfectDays = Object.values(dayMap).filter(d => d.total > 0 && d.done === d.total).length;

  // Perfect week check
  let perfectWeek = false;
  const sortedDates = Object.keys(dayMap).sort();
  for (let i = 0; i <= sortedDates.length - 7; i++) {
    let ok = true;
    for (let j = 0; j < 7; j++) {
      const expected = shiftDate(sortedDates[i], j);
      const info = dayMap[expected];
      if (!info || info.total === 0 || info.done < info.total) { ok = false; break; }
    }
    if (ok) { perfectWeek = true; break; }
  }

  // Time-based achievements
  const hasEarlyTask = all.some(t => {
    if (!t.createdAt) return false;
    const h = new Date(t.createdAt).getHours();
    return h >= 5 && h < 7;
  });
  const hasNightTask = all.some(t => {
    if (!t.createdAt) return false;
    const h = new Date(t.createdAt).getHours();
    return h >= 23 || h < 4;
  });

  const defs = [
    { icon: '✓', title: 'First Task', desc: 'Complete your first task', unlocked: totalCompleted >= 1 },
    { icon: '🌱', title: 'Getting Started', desc: 'Complete 10 tasks', unlocked: totalCompleted >= 10 },
    { icon: '🔥', title: 'On a Roll', desc: '3-day streak', unlocked: longestStreak >= 3 },
    { icon: '⚔️', title: 'Week Warrior', desc: '7-day streak', unlocked: longestStreak >= 7 },
    { icon: '💯', title: 'Centurion', desc: 'Complete 100 tasks', unlocked: totalCompleted >= 100 },
    { icon: '🧘', title: 'Focus Master', desc: '5 hours focused', unlocked: false },
    { icon: '🦉', title: 'Night Owl', desc: 'Task after midnight', unlocked: hasNightTask },
    { icon: '🌅', title: 'Early Bird', desc: 'Task before 7am', unlocked: hasEarlyTask },
    { icon: '⭐', title: 'Perfect Day', desc: 'Complete all daily tasks', unlocked: perfectDays >= 1 },
    { icon: '🏆', title: 'Perfect Week', desc: '7 perfect days in a row', unlocked: perfectWeek },
    { icon: '📅', title: 'Month Master', desc: '30-day streak', unlocked: longestStreak >= 30 },
    { icon: '🤖', title: 'Task Machine', desc: 'Complete 500 tasks', unlocked: totalCompleted >= 500 },
  ];

  const unlockedCount = defs.filter(a => a.unlocked).length;
  document.getElementById('achievement-count').textContent = `${unlockedCount}/12 unlocked`;

  defs.forEach(a => {
    const card = document.createElement('div');
    card.className = `achievement-card${a.unlocked ? '' : ' locked'}`;
    card.innerHTML = `
      <div class="achievement-icon">${a.icon}</div>
      <div class="achievement-title">${a.title}</div>
      <div class="achievement-desc">${a.desc}</div>
    `;
    container.appendChild(card);
  });
}

function renderDeepStats(all) {
  const container = document.getElementById('deep-stats-grid');
  container.innerHTML = '';

  const totalCompleted = all.filter(t => t.completed).length;
  const totalTasks = all.length;
  const uniqueDays = new Set(all.map(t => t.logicalDate));
  const avgPerDay = uniqueDays.size > 0 ? (totalCompleted / uniqueDays.size).toFixed(1) : '0';
  const longestStreak = calcLongestStreak(all);
  const completionRate = totalTasks > 0 ? Math.round((totalCompleted / totalTasks) * 100) + '%' : '0%';

  // Best day
  const dayCompleted = {};
  all.forEach(t => {
    if (t.completed) {
      dayCompleted[t.logicalDate] = (dayCompleted[t.logicalDate] || 0) + 1;
    }
  });
  let bestDay = '-', bestCount = 0;
  Object.entries(dayCompleted).forEach(([d, c]) => {
    if (c > bestCount) { bestCount = c; bestDay = d; }
  });

  const stats = [
    { value: totalCompleted, label: 'All-time completed' },
    { value: avgPerDay, label: 'Avg tasks/day' },
    { value: longestStreak, label: 'Longest streak' },
    { value: bestCount > 0 ? bestCount : '-', label: bestCount > 0 ? `Best day (${bestDay})` : 'Best day' },
    { value: '-', label: 'Total focus time' },
    { value: completionRate, label: 'Completion rate' },
  ];

  stats.forEach(s => {
    const card = document.createElement('div');
    card.className = 'stat-card';
    card.innerHTML = `
      <div class="stat-value">${s.value}</div>
      <div class="stat-label">${s.label}</div>
    `;
    container.appendChild(card);
  });
}

// ── Settings Tab ───────────────────────────────────
async function renderSettings() {
  document.getElementById('settings-username').textContent = `@${username}`;
  updateThemeSelector();

  if (!allTasks) await fetchAllTasks();
  if (allTasks) {
    document.getElementById('about-completed').textContent = allTasks.filter(t => t.completed).length;
    document.getElementById('about-total').textContent = allTasks.length;
  }
}

// ── Tab Navigation ─────────────────────────────────
function switchTab(tab) {
  activeTab = tab;
  document.querySelectorAll('.tab-content').forEach(el => {
    el.style.display = 'none';
  });
  const target = document.getElementById(`tab-${tab}`);
  if (target) {
    target.style.display = 'block';
    // Re-trigger animation
    target.style.animation = 'none';
    target.offsetHeight; // force reflow
    target.style.animation = '';
  }
  document.querySelectorAll('.tab').forEach(el => {
    el.classList.toggle('active', el.dataset.tab === tab);
  });

  if (tab === 'stats') renderStats();
  if (tab === 'settings') renderSettings();
}

// ── Export ──────────────────────────────────────────
async function exportJSON() {
  if (!allTasks) await fetchAllTasks();
  if (!allTasks) return;
  const blob = new Blob([JSON.stringify(allTasks, null, 2)], { type: 'application/json' });
  download(blob, `untodo-${username}-${getTodayIST()}.json`);
}

async function exportCSV() {
  if (!allTasks) await fetchAllTasks();
  if (!allTasks) return;
  const headers = ['id', 'title', 'completed', 'logicalDate', 'priority', 'category', 'source'];
  const rows = allTasks.map(t =>
    headers.map(h => `"${String(t[h] ?? '').replace(/"/g, '""')}"`).join(',')
  );
  const csv = [headers.join(','), ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  download(blob, `untodo-${username}-${getTodayIST()}.csv`);
}

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── Login / Logout ─────────────────────────────────
function showLogin() {
  document.getElementById('login-overlay').style.display = 'flex';
}

function hideLogin() {
  document.getElementById('login-overlay').style.display = 'none';
}

function login(name) {
  username = name.trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
  if (!username) return;
  localStorage.setItem('untodo_username', username);
  hideLogin();
  startApp();
}

function logout() {
  localStorage.removeItem('untodo_username');
  username = '';
  if (unsubscribe) { unsubscribe(); unsubscribe = null; }
  tasks = [];
  allTasks = null;
  showLogin();
}

// ── Init ───────────────────────────────────────────
function startApp() {
  currentDate = getTodayIST();
  subscribeToDate(currentDate);
  applyTheme();
  switchTab('today');
}

// ── Event Binding ──────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Theme
  applyTheme();
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);

  // Theme toggle (header button — cycles system → dark → light)
  document.getElementById('theme-toggle').addEventListener('click', () => {
    const cur = getThemePref();
    const next = cur === 'system' ? 'dark' : cur === 'dark' ? 'light' : 'system';
    localStorage.setItem('untodo_theme', next);
    applyTheme();
  });

  // Theme selector buttons (settings)
  document.querySelectorAll('.theme-option').forEach(btn => {
    btn.addEventListener('click', () => {
      localStorage.setItem('untodo_theme', btn.dataset.theme);
      applyTheme();
    });
  });

  // Tab bar
  document.querySelectorAll('.tab').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // Date navigation
  document.getElementById('date-prev').addEventListener('click', () => {
    currentDate = shiftDate(currentDate, -1);
    subscribeToDate(currentDate);
  });
  document.getElementById('date-next').addEventListener('click', () => {
    currentDate = shiftDate(currentDate, 1);
    subscribeToDate(currentDate);
  });

  // Add task
  const taskInput = document.getElementById('task-input');
  const addBtn = document.getElementById('add-btn');

  function submitTask() {
    const title = taskInput.value.trim();
    if (!title) return;
    const cat = document.getElementById('category-select').value;
    addTask(title, selectedPriority, cat);
    taskInput.value = '';
    selectedPriority = null;
    document.querySelectorAll('.priority-dot').forEach(d => d.classList.remove('active'));
    document.getElementById('category-select').value = '';
  }

  addBtn.addEventListener('click', submitTask);
  taskInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') submitTask();
  });

  // Priority dots
  document.querySelectorAll('.priority-dot').forEach(dot => {
    dot.addEventListener('click', () => {
      const p = dot.dataset.priority;
      if (selectedPriority === p) {
        selectedPriority = null;
        dot.classList.remove('active');
      } else {
        selectedPriority = p;
        document.querySelectorAll('.priority-dot').forEach(d => d.classList.remove('active'));
        dot.classList.add('active');
      }
    });
  });

  // Completed toggle
  document.getElementById('completed-toggle').addEventListener('click', () => {
    completedOpen = !completedOpen;
    localStorage.setItem('untodo_completed_open', JSON.stringify(completedOpen));
    renderTasks();
  });

  // Login
  const loginInput = document.getElementById('login-input');
  document.getElementById('login-btn').addEventListener('click', () => login(loginInput.value));
  loginInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') login(loginInput.value);
  });

  // Logout
  document.getElementById('logout-btn').addEventListener('click', logout);

  // Export
  document.getElementById('export-json-btn').addEventListener('click', exportJSON);
  document.getElementById('export-csv-btn').addEventListener('click', exportCSV);

  // Boot
  if (!username) {
    showLogin();
  } else {
    startApp();
  }
});
