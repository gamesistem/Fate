/* ============================================================
   FGO Álbum de Figurinhas — App Logic
   API: https://api.atlasacademy.io
   ============================================================ */

'use strict';

// ── Constants ──────────────────────────────────────────────
const API_BASE = 'https://api.atlasacademy.io';
const PACK_COOLDOWN_MS = 30 * 60 * 1000; // Alterado para 30 minutos
const CARDS_PER_PACK = 3;
const SAVE_KEY = 'fgo_album_save';

// Rarity weights (higher rarity = harder to get)
const RARITY_WEIGHTS = {
  1: 2000,
  2: 1500,
  3: 800,
  4: 200,
  5: 30,
};

// FGO class display names
const CLASS_NAMES = {
  saber:       'Saber',
  archer:      'Archer',
  lancer:      'Lancer',
  rider:       'Rider',
  caster:      'Caster',
  assassin:    'Assassin',
  berserker:   'Berserker',
  ruler:       'Ruler',
  avenger:     'Avenger',
  mooncancer:  'Moon Cancer',
  alterego:    'Alter Ego',
  foreigner:   'Foreigner',
  pretender:   'Pretender',
  shielder:    'Shielder',
  beast:       'Beast',
  extra:       'Extra',
};

// ── State ──────────────────────────────────────────────────
let state = {
  servants: [],          // all servants from API
  obtained: {},          // servantId -> count (1 = pasted, 2+ = duplicates)
  lastPackTime: null,    // timestamp (ms)
  packHistory: [],       // [{date, servants:[{id,name,rarity}]}]
  currentFilter: 'all',
  currentClass: 'all',
  activeView: 'album',
};

// ── Init ───────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  initBackground();
  loadSave();
  await fetchServants();
  initUI();
  startPackTimer();
});

// ── Fetch Servants ─────────────────────────────────────────
async function fetchServants() {
  const loadFill = document.getElementById('loading-fill');
  const loadText = document.getElementById('loading-text');

  try {
    loadText.textContent = 'Buscando servants do JP com nomes NA...';
    loadFill.style.width = '20%';

    // Use JP servant list but with NA (English) names via the nice/servant endpoint
    const res = await fetch(`${API_BASE}/export/NA/basic_servant.json`);
    loadFill.style.width = '60%';

    if (!res.ok) throw new Error('Falha na resposta da API');
    const raw = await res.json();
    loadFill.style.width = '80%';
    loadText.textContent = 'Processando dados...';

    // Filter: only playable servants (collectionNo > 0) and exclude pseudo-servants oddities
    state.servants = raw
      .filter(s => s.collectionNo > 0)
      .map(s => ({
        id: s.id,
        collectionNo: s.collectionNo,
        name: s.name,
        className: (s.className || 'extra').toLowerCase(),
        rarity: s.rarity,
        face: s.face,     // thumbnail URL
        atkMax: s.atkMax,
        hpMax: s.hpMax,
      }))
      .sort((a, b) => a.collectionNo - b.collectionNo);

    loadFill.style.width = '100%';
    loadText.textContent = `${state.servants.length} servants carregados!`;

    await sleep(600);
    document.getElementById('loading-screen').style.display = 'none';
    document.getElementById('app').style.display = 'block';

  } catch (err) {
    loadText.textContent = 'Erro ao carregar. Tentando novamente...';
    console.error(err);
    // Retry once
    await sleep(2000);
    await fetchServants();
  }
}

// ── Save / Load ────────────────────────────────────────────
function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    state.obtained = data.obtained || {};
    state.lastPackTime = data.lastPackTime || null;
    state.packHistory = data.packHistory || [];
  } catch (e) {
    console.warn('Could not load save:', e);
  }
}

// ── UI Init ────────────────────────────────────────────────
function initUI() {
  // Navigation
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const view = btn.dataset.view;
      switchView(view);
      document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  // Filters
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.currentFilter = btn.dataset.filter;
      renderAlbum();
    });
  });

  // Class tabs
  buildClassTabs();

  // Pack button
  document.getElementById('btn-open-pack').addEventListener('click', openPack);
  document.getElementById('btn-close-reveal').addEventListener('click', closeReveal);

  // Modal
  document.getElementById('modal-close').addEventListener('click', closeModal);
  document.getElementById('servant-modal').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeModal();
  });

  // Import / Export
  document.getElementById('btn-export').addEventListener('click', exportSave);
  document.getElementById('btn-import').addEventListener('click', () => {
    document.getElementById('import-file').click();
  });
  document.getElementById('import-file').addEventListener('change', importSave);

  // Congrats close
  document.getElementById('congrats-close').addEventListener('click', () => {
    document.getElementById('congrats-overlay').style.display = 'none';
  });

  renderAlbum();
  renderDoublesView();
  renderStatsView();
  renderPackHistory();
}

function switchView(view) {
  state.activeView = view;
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById(`view-${view}`).classList.add('active');

  if (view === 'doubles') renderDoublesView();
  if (view === 'stats') renderStatsView();
  if (view === 'pack') renderPackHistory();
}

// ── Class Tabs ─────────────────────────────────────────────
function buildClassTabs() {
  const classes = ['all', ...new Set(state.servants.map(s => s.className))].sort();
  const container = document.getElementById('class-tabs');
  container.innerHTML = '';

  classes.forEach(cls => {
    const btn = document.createElement('button');
    btn.className = 'class-tab' + (cls === 'all' ? ' active' : '');
    btn.textContent = cls === 'all' ? 'Todos' : (CLASS_NAMES[cls] || capitalize(cls));
    btn.dataset.cls = cls;
    btn.addEventListener('click', () => {
      document.querySelectorAll('.class-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.currentClass = cls;
      renderAlbum();
    });
    container.appendChild(btn);
  });
}

// ── Album Render ───────────────────────────────────────────
function renderAlbum() {
  const grid = document.getElementById('servant-grid');
  grid.innerHTML = '';

  let filtered = state.servants;

  // Class filter
  if (state.currentClass !== 'all') {
    filtered = filtered.filter(s => s.className === state.currentClass);
  }

  // Status filter
  if (state.currentFilter === 'obtained') {
    filtered = filtered.filter(s => (state.obtained[s.id] || 0) >= 1);
  } else if (state.currentFilter === 'missing') {
    filtered = filtered.filter(s => !state.obtained[s.id]);
  } else if (['1','2','3','4','5'].includes(state.currentFilter)) {
    filtered = filtered.filter(s => s.rarity === parseInt(state.currentFilter));
  }

  // Update progress
  const totalOwned = state.servants.filter(s => (state.obtained[s.id] || 0) >= 1).length;
  const totalAll = state.servants.length;
  document.getElementById('progress-text').textContent = `${totalOwned} / ${totalAll} servants`;
  const pct = totalAll > 0 ? (totalOwned / totalAll) * 100 : 0;
  document.getElementById('main-progress').style.width = `${pct}%`;

  filtered.forEach((servant, idx) => {
    const card = buildServantCard(servant, idx);
    grid.appendChild(card);
  });
}

function buildServantCard(servant, idx) {
  const count = state.obtained[servant.id] || 0;
  const obtained = count >= 1;

  const card = document.createElement('div');
  card.className = `servant-card r${servant.rarity} ${obtained ? 'obtained' : 'missing'}`;
  card.style.animationDelay = `${(idx % 20) * 0.03}s`;

  const duplicates = count > 1 ? count - 1 : 0;

  card.innerHTML = `
    <div class="card-image-area">
      ${obtained
        ? `<img src="${servant.face}" alt="${servant.name}" loading="lazy" onerror="this.parentElement.innerHTML='<div class=\\'card-image-placeholder\\'>⚔</div>'">`
        : `<div class="card-image-placeholder">?</div><div class="card-slot-num">#${servant.collectionNo}</div>`
      }
      ${duplicates > 0 ? `<div class="card-duplicates">+${duplicates}</div>` : ''}
    </div>
    <div class="card-info">
      <div class="card-name">${obtained ? servant.name : '???'}</div>
      <div class="card-rarity r${servant.rarity}">${'★'.repeat(servant.rarity)}</div>
    </div>
  `;

  card.addEventListener('click', () => showModal(servant));
  return card;
}

// ── Modal ──────────────────────────────────────────────────
function showModal(servant) {
  const count = state.obtained[servant.id] || 0;
  const obtained = count >= 1;
  const modal = document.getElementById('servant-modal');
  const content = document.getElementById('modal-content');

  const rarityColors = {1: '#9e9e9e', 2: '#7cb0d6', 3: '#6abf6a', 4: '#d4a0e8', 5: '#f0c040'};
  const color = rarityColors[servant.rarity] || '#fff';

  content.innerHTML = `
    ${obtained
      ? `<img class="modal-servant-image" src="${servant.face}" alt="${servant.name}">`
      : `<div style="height:200px;background:var(--ink-mid);display:flex;align-items:center;justify-content:center;font-size:5rem;opacity:0.3">?</div>`
    }
    <div class="modal-servant-info">
      <div class="modal-servant-name">${obtained ? servant.name : '???'}</div>
      <div class="modal-servant-class">${CLASS_NAMES[servant.className] || capitalize(servant.className)}</div>
      <div class="modal-stars" style="color:${color}">${'★'.repeat(servant.rarity)}${'☆'.repeat(Math.max(0, 5-servant.rarity))}</div>
      <div class="modal-detail-row">
        <span class="modal-detail-label">Nº do Álbum</span>
        <span class="modal-detail-value">#${servant.collectionNo}</span>
      </div>
      <div class="modal-detail-row">
        <span class="modal-detail-label">Raridade</span>
        <span class="modal-detail-value" style="color:${color}">${servant.rarity}★</span>
      </div>
      ${obtained ? `
      <div class="modal-detail-row">
        <span class="modal-detail-label">Cópias Obtidas</span>
        <span class="modal-detail-value">${count}</span>
      </div>
      <div class="modal-detail-row">
        <span class="modal-detail-label">Repetidas</span>
        <span class="modal-detail-value">${Math.max(0, count - 1)}</span>
      </div>
      ` : ''}
      <div>
        <span class="modal-status-badge ${obtained ? 'badge-obtained' : 'badge-missing'}">
          ${obtained ? '✓ Colado no Álbum' : '✗ Faltando'}
        </span>
      </div>
    </div>
  `;

  modal.style.display = 'flex';
}

function closeModal() {
  document.getElementById('servant-modal').style.display = 'none';
}

// ── Pack Timer ─────────────────────────────────────────────
function startPackTimer() {
  updatePackUI();
  setInterval(updatePackUI, 1000);
}

function canOpenPack() {
  if (!state.lastPackTime) return true;
  return (Date.now() - state.lastPackTime) >= PACK_COOLDOWN_MS;
}

function updatePackUI() {
  const timerArea = document.getElementById('pack-timer-area');
  const readyArea = document.getElementById('pack-ready-area');

  if (canOpenPack()) {
    timerArea.style.display = 'none';
    readyArea.style.display = 'block';
  } else {
    timerArea.style.display = 'block';
    readyArea.style.display = 'none';

    const remaining = (state.lastPackTime + PACK_COOLDOWN_MS) - Date.now();
    const nextDate = new Date(state.lastPackTime + PACK_COOLDOWN_MS);

    document.getElementById('countdown').textContent = formatDuration(remaining);
    document.getElementById('next-pack-date').textContent =
      `Disponível em: ${nextDate.toLocaleDateString('pt-BR')} às ${nextDate.toLocaleTimeString('pt-BR', {hour:'2-digit', minute:'2-digit'})}`;
  }
}

// ── Open Pack ──────────────────────────────────────────────
function openPack() {
  if (!canOpenPack()) {
    showToast('Pacote ainda não disponível!', 'error');
    return;
  }

  if (state.servants.length === 0) {
    showToast('Servants não carregados ainda!', 'error');
    return;
  }

  const drawn = drawServants(CARDS_PER_PACK);
  state.lastPackTime = Date.now();

  // Track in history
  state.packHistory.unshift({
    date: new Date().toISOString(),
    servants: drawn.map(s => ({ id: s.id, name: s.name, rarity: s.rarity })),
  });
  if (state.packHistory.length > 50) state.packHistory.pop();

  showReveal(drawn);
  persistSave();
  updatePackUI();
}

function drawServants(count) {
  const pool = state.servants;
  const drawn = [];

  for (let i = 0; i < count; i++) {
    const servant = weightedRandom(pool);
    drawn.push(servant);
    // Add to obtained
    state.obtained[servant.id] = (state.obtained[servant.id] || 0) + 1;
  }

  return drawn;
}

function weightedRandom(pool) {
  // Build weighted pool
  let totalWeight = 0;
  const weights = pool.map(s => {
    const w = RARITY_WEIGHTS[s.rarity] || 100;
    totalWeight += w;
    return w;
  });

  let rand = Math.random() * totalWeight;
  for (let i = 0; i < pool.length; i++) {
    rand -= weights[i];
    if (rand <= 0) return pool[i];
  }
  return pool[pool.length - 1];
}

// ── Reveal ─────────────────────────────────────────────────
function showReveal(servants) {
  const revealEl = document.getElementById('pack-reveal');
  const cardsEl = document.getElementById('reveal-cards');
  cardsEl.innerHTML = '';

  servants.forEach(servant => {
    const count = state.obtained[servant.id];
    const isNew = count === 1;
    const card = document.createElement('div');
    card.className = `reveal-card r${servant.rarity}`;

    card.innerHTML = `
      <img src="${servant.face}" alt="${servant.name}"
           onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22140%22 height=%22186%22><rect width=%22140%22 height=%22186%22 fill=%22%231a1d28%22/><text x=%2270%22 y=%2293%22 text-anchor=%22middle%22 fill=%22%23444%22 font-size=%2240%22>⚔</text></svg>'">
      <div class="reveal-card-info">
        <div class="reveal-card-name">${servant.name}</div>
        <div class="reveal-card-stars" style="color:${rarityColor(servant.rarity)}">${'★'.repeat(servant.rarity)}</div>
        <div class="reveal-card-tag ${isNew ? 'tag-new' : 'tag-repeat'}">${isNew ? 'NOVO!' : 'REPETIDA'}</div>
      </div>
    `;
    cardsEl.appendChild(card);
  });

  revealEl.style.display = 'block';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function closeReveal() {
  document.getElementById('pack-reveal').style.display = 'none';
  renderAlbum();
  renderDoublesView();
  renderStatsView();
  renderPackHistory();
  checkCompletion();
  showToast('Figurinhas coladas no álbum! ✨', 'success');
}

// ── Pack History ───────────────────────────────────────────
function renderPackHistory() {
  const list = document.getElementById('pack-history-list');
  list.innerHTML = '';

  if (state.packHistory.length === 0) {
    list.innerHTML = '<p style="color:var(--text-dim);font-family:var(--font-ui);font-size:0.85rem">Nenhum pacote aberto ainda.</p>';
    return;
  }

  state.packHistory.slice(0, 10).forEach(entry => {
    const d = new Date(entry.date);
    const names = entry.servants.map(s => s.name).join(', ');
    const row = document.createElement('div');
    row.className = 'history-entry';
    row.innerHTML = `
      <span class="history-servants">${names}</span>
      <span class="history-date">${d.toLocaleDateString('pt-BR')}</span>
    `;
    list.appendChild(row);
  });
}

// ── Doubles View ───────────────────────────────────────────
function renderDoublesView() {
  const grid = document.getElementById('doubles-grid');
  const countEl = document.getElementById('doubles-count');
  grid.innerHTML = '';

  const doubles = state.servants.filter(s => (state.obtained[s.id] || 0) > 1);

  if (doubles.length === 0) {
    countEl.textContent = 'Nenhuma figurinha repetida ainda.';
    grid.innerHTML = '<p style="color:var(--text-dim);font-family:var(--font-ui);font-size:1rem;margin-top:20px">Abra mais pacotes para conseguir repetidas!</p>';
    return;
  }

  countEl.textContent = `${doubles.length} servants com cópias repetidas`;

  doubles.forEach(servant => {
    const count = state.obtained[servant.id];
    const card = document.createElement('div');
    card.className = `servant-card doubles-card r${servant.rarity} obtained`;

    card.innerHTML = `
      <div class="card-image-area">
        <img src="${servant.face}" alt="${servant.name}" loading="lazy">
        <div class="card-duplicates">×${count - 1}</div>
      </div>
      <div class="card-info">
        <div class="card-name">${servant.name}</div>
        <div class="card-rarity r${servant.rarity}">${'★'.repeat(servant.rarity)}</div>
      </div>
    `;

    card.addEventListener('click', () => showModal(servant));
    grid.appendChild(card);
  });
}

// ── Stats View ─────────────────────────────────────────────
function renderStatsView() {
  const grid = document.getElementById('stats-grid');
  const obtained = Object.keys(state.obtained).filter(id => state.obtained[id] >= 1);
  const total = state.servants.length;
  const totalPacks = state.packHistory.length;
  const doubles = state.servants.filter(s => (state.obtained[s.id] || 0) > 1).length;
  const totalCards = Object.values(state.obtained).reduce((a, b) => a + b, 0);
  const missing = total - obtained.length;
  const pct = total > 0 ? Math.round((obtained.length / total) * 100) : 0;

  grid.innerHTML = `
    ${statCard(obtained.length, 'Servants Obtidos')}
    ${statCard(missing, 'Faltando')}
    ${statCard(`${pct}%`, 'Completado')}
    ${statCard(totalPacks, 'Pacotes Abertos')}
    ${statCard(totalCards, 'Figurinhas Total')}
    ${statCard(doubles, 'Repetidas')}
  `;

  // Rarity chart
  renderRarityChart();
}

function statCard(value, label) {
  return `<div class="stat-card"><div class="stat-value">${value}</div><div class="stat-label">${label}</div></div>`;
}

function renderRarityChart() {
  const container = document.getElementById('rarity-chart');
  const rarityColors = {1: '#9e9e9e', 2: '#7cb0d6', 3: '#6abf6a', 4: '#d4a0e8', 5: '#f0c040'};

  let rows = '';
  for (let r = 5; r >= 1; r--) {
    const all = state.servants.filter(s => s.rarity === r).length;
    const got = state.servants.filter(s => s.rarity === r && (state.obtained[s.id] || 0) >= 1).length;
    const pct = all > 0 ? (got / all) * 100 : 0;
    rows += `
      <div class="rarity-row">
        <span class="rarity-label" style="color:${rarityColors[r]}">${'★'.repeat(r)}</span>
        <div class="rarity-bar-wrap">
          <div class="rarity-bar" style="width:${pct}%;background:${rarityColors[r]}"></div>
        </div>
        <span class="rarity-count">${got}/${all}</span>
      </div>
    `;
  }

  container.innerHTML = `<h3>Progresso por Raridade</h3>${rows}`;
}

// ── Completion Check ───────────────────────────────────────
function checkCompletion() {
  const total = state.servants.length;
  if (total === 0) return;
  const obtained = state.servants.filter(s => (state.obtained[s.id] || 0) >= 1).length;
  if (obtained >= total) {
    showCongrats(total);
  }
}

function showCongrats(count) {
  document.getElementById('congrats-count').textContent = count;
  const overlay = document.getElementById('congrats-overlay');
  overlay.style.display = 'flex';
  launchFireworks();
}

function launchFireworks() {
  const container = document.getElementById('congrats-fireworks');
  const colors = ['#f0c040','#c9a84c','#ff6b6b','#4ecdc4','#a8e6cf','#ffd93d'];

  for (let burst = 0; burst < 8; burst++) {
    setTimeout(() => {
      const cx = 20 + Math.random() * 60;
      const cy = 20 + Math.random() * 60;

      for (let p = 0; p < 20; p++) {
        const el = document.createElement('div');
        el.className = 'firework';
        const angle = (p / 20) * Math.PI * 2;
        const dist = 60 + Math.random() * 80;
        el.style.cssText = `
          left:${cx}%;top:${cy}%;
          background:${colors[Math.floor(Math.random() * colors.length)]};
          --dx:${Math.cos(angle) * dist}px;
          --dy:${Math.sin(angle) * dist}px;
          animation-duration:${0.8 + Math.random() * 0.6}s;
        `;
        container.appendChild(el);
        setTimeout(() => el.remove(), 1500);
      }
    }, burst * 400);
  }
}

// ── Export / Import ────────────────────────────────────────
function exportSave() {
  const data = buildSaveObject();
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `fgo_album_${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('Save exportado com sucesso! 📥', 'success');
}

function buildSaveObject() {
  return {
    obtained: state.obtained,
    lastPackTime: state.lastPackTime,
    packHistory: state.packHistory,
    savedAt: Date.now(),
    version: '1.0',
  };
}

function persistSave() {
  const data = buildSaveObject();
  localStorage.setItem(SAVE_KEY, JSON.stringify(data));
}

function importSave(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (ev) => {
    try {
      const data = JSON.parse(ev.target.result);
      if (!data.obtained) throw new Error('Arquivo inválido');

      state.obtained = data.obtained || {};
      state.lastPackTime = data.lastPackTime || null;
      state.packHistory = data.packHistory || [];

      persistSave();
      renderAlbum();
      renderDoublesView();
      renderStatsView();
      renderPackHistory();
      updatePackUI();

      showToast('Save importado com sucesso! 🎉', 'success');
    } catch (err) {
      showToast('Erro ao importar save. Verifique o arquivo.', 'error');
    }
  };
  reader.readAsText(file);
  e.target.value = '';
}

// ── Background Animation ───────────────────────────────────
function initBackground() {
  const canvas = document.getElementById('bg-canvas');
  const ctx = canvas.getContext('2d');
  let particles = [];

  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  resize();
  window.addEventListener('resize', resize);

  // Create particles
  for (let i = 0; i < 60; i++) {
    particles.push({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      size: Math.random() * 2 + 0.5,
      speedX: (Math.random() - 0.5) * 0.3,
      speedY: -Math.random() * 0.5 - 0.1,
      opacity: Math.random() * 0.5 + 0.1,
      color: Math.random() > 0.7 ? '#c9a84c' : '#ffffff',
    });
  }

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    particles.forEach(p => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.globalAlpha = p.opacity;
      ctx.fill();

      p.x += p.speedX;
      p.y += p.speedY;

      if (p.y < -5) {
        p.y = canvas.height + 5;
        p.x = Math.random() * canvas.width;
      }
      if (p.x < -5) p.x = canvas.width + 5;
      if (p.x > canvas.width + 5) p.x = -5;
    });
    ctx.globalAlpha = 1;
    requestAnimationFrame(draw);
  }
  draw();
}

// ── Toast ──────────────────────────────────────────────────
function showToast(msg, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = msg;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3200);
}

// ── Helpers ────────────────────────────────────────────────
function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function rarityColor(r) {
  const map = {1:'#9e9e9e', 2:'#7cb0d6', 3:'#6abf6a', 4:'#d4a0e8', 5:'#f0c040'};
  return map[r] || '#fff';
}

function formatDuration(ms) {
  if (ms <= 0) return '00:00:00';
  const totalSec = Math.floor(ms / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;

  if (days > 0) {
    return `${days}d ${pad(hours)}:${pad(mins)}:${pad(secs)}`;
  }
  return `${pad(hours)}:${pad(mins)}:${pad(secs)}`;
}

function pad(n) {
  return String(n).padStart(2, '0');
}
