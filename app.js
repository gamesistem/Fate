/* ============================================================
   FGO Álbum de Figurinhas — App Logic
   API: https://api.atlasacademy.io
   ============================================================ */

'use strict';

// ── Constants ──────────────────────────────────────────────
const API_BASE = 'https://api.atlasacademy.io';
const PACK_COOLDOWN_NORMAL_MS = 30 * 60 * 1000; // 30 minutos
const PACK_COOLDOWN_CHEAT_MS  = 30 * 1000;       // 30 segundos (cheat)
const CARDS_PER_PACK = 3;
const SAVE_KEY = 'fgo_album_save';

// Computed based on active cheat
function PACK_COOLDOWN_MS() {
  return state.devBuffActive ? PACK_COOLDOWN_CHEAT_MS : PACK_COOLDOWN_NORMAL_MS;
}

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
  sq: 0,                 // Saint Quartz Currency
  dinoHighScore: 0,      // Minigame record
  devBuffActive: false   // Ctrl+1 cheat: cooldown vira 30s
};

// Dino Game Variable instances
let dinoGameInstance = null;

// ── Init ───────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  initBackground();
  loadSave();
  updateSQDisplay();
  await fetchServants();
  initUI();
  startPackTimer();
});

// ── Fetch Servants ─────────────────────────────────────────
async function fetchServants() {
  const loadFill = document.getElementById('loading-fill');
  const loadText = document.getElementById('loading-text');

  try {
    loadText.textContent = 'Buscando todos os servants do JP (com nomes traduzidos)...';
    loadFill.style.width = '20%';

    const res = await fetch(`${API_BASE}/export/JP/basic_servant.json`);
    loadFill.style.width = '60%';

    if (!res.ok) throw new Error('Falha na resposta da API');
    const raw = await res.json();
    loadFill.style.width = '80%';
    loadText.textContent = 'Processando dados...';

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
    loadText.textContent = `${state.servants.length} servants carregados com sucesso!`;

    await sleep(600);
    document.getElementById('loading-screen').style.display = 'none';
    document.getElementById('app').style.display = 'block';

  } catch (err) {
    loadText.textContent = 'Erro ao carregar. Tentando novamente...';
    console.error(err);
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
    state.sq = typeof data.sq === 'number' ? data.sq : 0;
    state.dinoHighScore = data.dinoHighScore || 0;
  } catch (e) {
    console.warn('Could not load save:', e);
  }
}

function persistSave() {
  try {
    const data = {
      obtained: state.obtained,
      lastPackTime: state.lastPackTime,
      packHistory: state.packHistory,
      sq: state.sq,
      dinoHighScore: state.dinoHighScore
    };
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
  } catch (e) {
    console.error('Save failure:', e);
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

  buildClassTabs();

  // Pack Buttons
  document.getElementById('btn-open-pack').addEventListener('click', openPack);
  document.getElementById('btn-close-reveal').addEventListener('click', closeReveal);

  // Shop Buy Buttons
  document.getElementById('btn-buy-basic').addEventListener('click', () => buyPackShop('basic'));
  document.getElementById('btn-buy-medium').addEventListener('click', () => buyPackShop('medium'));
  document.getElementById('btn-buy-supreme').addEventListener('click', () => buyPackShop('supreme'));

  // Sell actions
  document.getElementById('btn-sell-all').addEventListener('click', sellAllDuplicates);

  // Dino Game UI Hook
  document.getElementById('btn-start-dino').addEventListener('click', startDinoGame);

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

  document.getElementById('congrats-close').addEventListener('click', () => {
    document.getElementById('congrats-overlay').style.display = 'none';
  });

  // ── Cheat: Ctrl+1 — Cooldown Turbo (30min → 30s) ──────────
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === '1') {
      e.preventDefault();
      state.devBuffActive = !state.devBuffActive;
      const badge = document.getElementById('dev-buff-badge');
      if (badge) {
        badge.style.display = state.devBuffActive ? 'inline-flex' : 'none';
      }
      showToast(
        state.devBuffActive
          ? '⚡ Dev Buff ATIVADO — Cooldown: 30 segundos!'
          : '🔒 Dev Buff desativado — Cooldown voltou ao normal.',
        state.devBuffActive ? 'success' : 'info'
      );
      updatePackUI();
    }
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

  // Stop dino if switching away
  if (view !== 'dino' && dinoGameInstance) {
    dinoGameInstance.stop();
  }

  if (view === 'doubles') renderDoublesView();
  if (view === 'stats') renderStatsView();
  if (view === 'pack') renderPackHistory();
  if (view === 'dino') initDinoUI();
}

function updateSQDisplay() {
  const sqEl = document.getElementById('sq-amount');
  if (sqEl) {
    sqEl.textContent = state.sq.toLocaleString('pt-BR');
  }
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

  if (state.currentClass !== 'all') {
    filtered = filtered.filter(s => s.className === state.currentClass);
  }

  if (state.currentFilter === 'obtained') {
    filtered = filtered.filter(s => (state.obtained[s.id] || 0) >= 1);
  } else if (state.currentFilter === 'missing') {
    filtered = filtered.filter(s => !state.obtained[s.id]);
  } else if (['1','2','3','4','5'].includes(state.currentFilter)) {
    filtered = filtered.filter(s => s.rarity === parseInt(state.currentFilter));
  }

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

  const canSell = obtained && count > 1 && (servant.rarity <= 3 || servant.rarity === 4 || servant.rarity === 5);
  let sellPrice = 0;
  if (servant.rarity <= 3) sellPrice = 2;
  if (servant.rarity === 4) sellPrice = 5;
  if (servant.rarity === 5) sellPrice = 10;

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
      <div style="margin-top: 10px;">
        <span class="modal-status-badge ${obtained ? 'badge-obtained' : 'badge-missing'}">
          ${obtained ? '✓ Colado no Álbum' : '✗ Faltando'}
        </span>
      </div>
      ${canSell ? `
        <button class="congrats-btn" id="btn-sell-single-modal" style="margin-top: 15px; font-size: 0.85rem; width:100%; padding: 10px;">
          Vender 1 Cópia Repetida por +${sellPrice} SQ
        </button>
      ` : ''}
    </div>
  `;

  modal.style.display = 'flex';

  if (canSell) {
    document.getElementById('btn-sell-single-modal').addEventListener('click', () => {
      sellSingleDuplicate(servant.id);
      showModal(state.servants.find(s => s.id === servant.id)); // Refresh modal
    });
  }
}

function closeModal() {
  document.getElementById('servant-modal').style.display = 'none';
}

// ── Pack Timer & Free Pack ─────────────────────────────────
function startPackTimer() {
  updatePackUI();
  setInterval(updatePackUI, 1000);
}

function canOpenPack() {
  if (!state.lastPackTime) return true;
  return (Date.now() - state.lastPackTime) >= PACK_COOLDOWN_MS();
}

function updatePackUI() {
  const timerArea = document.getElementById('pack-timer-area');
  const readyArea = document.getElementById('pack-ready-area');

  if (!timerArea || !readyArea) return;

  if (canOpenPack()) {
    timerArea.style.display = 'none';
    readyArea.style.display = 'block';
  } else {
    timerArea.style.display = 'block';
    readyArea.style.display = 'none';

    const remaining = (state.lastPackTime + PACK_COOLDOWN_MS()) - Date.now();
    const nextDate = new Date(state.lastPackTime + PACK_COOLDOWN_MS());

    document.getElementById('countdown').textContent = formatDuration(remaining);
    document.getElementById('next-pack-date').textContent =
      `Disponível em: ${nextDate.toLocaleDateString('pt-BR')} às ${nextDate.toLocaleTimeString('pt-BR', {hour:'2-digit', minute:'2-digit'})}`;
  }
}

function openPack() {
  if (!canOpenPack()) {
    showToast('Pacote ainda não disponível!', 'error');
    return;
  }
  if (state.servants.length === 0) {
    showToast('Servants não carregados ainda!', 'error');
    return;
  }

  const drawn = drawServants(CARDS_PER_PACK, 'normal');
  state.lastPackTime = Date.now();
  
  saveDrawnPackHistory(drawn);
  showReveal(drawn, 'Diário Gratuito');
  persistSave();
  updatePackUI();
  checkAlbumCompletion();
}

// ── SQ Shop Purchase Logic ─────────────────────────────────
function buyPackShop(type) {
  if (state.servants.length === 0) {
    showToast('Aguarde o carregamento do banco de dados!', 'error');
    return;
  }

  let cost = 0;
  let count = 0;
  let packName = '';

  if (type === 'basic') {
    cost = 30;
    count = 3;
    packName = 'Pacote Básico';
  } else if (type === 'medium') {
    cost = 100;
    count = 5;
    packName = 'Pacote de 5 Servos';
  } else if (type === 'supreme') {
    cost = 100000000000; // 100 Bilhões
    count = 50;
    packName = 'Pacote Supremo Celestial';
  }

  if (state.sq < cost) {
    showToast(`Saint Quartz insuficiente! Você precisa de ${cost.toLocaleString()} SQ.`, 'error');
    return;
  }

  state.sq -= cost;
  updateSQDisplay();

  const drawn = drawServants(count, type);
  saveDrawnPackHistory(drawn);
  showReveal(drawn, packName);
  persistSave();
  checkAlbumCompletion();
}

function saveDrawnPackHistory(drawn) {
  state.packHistory.unshift({
    date: new Date().toISOString(),
    servants: drawn.map(s => ({ id: s.id, name: s.name, rarity: s.rarity })),
  });
  if (state.packHistory.length > 50) state.packHistory.pop();
}

// ── Draw Algorithms (Including Custom Rules) ───────────────
function drawServants(count, type) {
  const pool = state.servants;
  const drawn = [];

  if (type === 'supreme') {
    // SUPREME PACK RULE: 50 servants, at least one guaranteed 5 star
    // Force first one to be 5-star
    const fiveStarPool = pool.filter(s => s.rarity === 5);
    if (fiveStarPool.length > 0) {
      const guaranteed = fiveStarPool[Math.floor(Math.random() * fiveStarPool.length)];
      drawn.push(guaranteed);
      state.obtained[guaranteed.id] = (state.obtained[guaranteed.id] || 0) + 1;
    } else {
      count++; // fallback if pool is empty
    }

    // Roll remaining 49 cards normally
    const remCount = count - drawn.length;
    for (let i = 0; i < remCount; i++) {
      const servant = weightedRandom(pool, 'normal');
      drawn.push(servant);
      state.obtained[servant.id] = (state.obtained[servant.id] || 0) + 1;
    }
  } else if (type === 'medium') {
    // MEDIUM PACK RULE: 5 servants. Higher chance for 3-star+, but also high weight for lower stars
    // Let's modify weights slightly for this pack type to favour 3-star baseline
    for (let i = 0; i < count; i++) {
      const servant = weightedRandom(pool, 'medium');
      drawn.push(servant);
      state.obtained[servant.id] = (state.obtained[servant.id] || 0) + 1;
    }
  } else {
    // Normal pack rolling
    for (let i = 0; i < count; i++) {
      const servant = weightedRandom(pool, 'normal');
      drawn.push(servant);
      state.obtained[servant.id] = (state.obtained[servant.id] || 0) + 1;
    }
  }

  return drawn;
}

function weightedRandom(pool, strategy) {
  let weightsConfig = { ...RARITY_WEIGHTS };

  if (strategy === 'medium') {
    // Higher baseline for 3 star, compressed weights
    weightsConfig = {
      1: 1500,
      2: 1200,
      3: 1400, // boosted
      4: 300,  // slightly boosted
      5: 45,   // slightly boosted
    };
  }

  let totalWeight = 0;
  const weights = pool.map(s => {
    const w = weightsConfig[s.rarity] || 100;
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
function showReveal(servants, packTitle) {
  const revealEl = document.getElementById('pack-reveal');
  const cardsEl = document.getElementById('reveal-cards');
  const titleEl = document.getElementById('reveal-title');

  titleEl.textContent = `Invocação: ${packTitle}`;
  cardsEl.innerHTML = '';
  
  revealEl.style.display = 'block';
  // Scroll to reveal window safely
  revealEl.scrollIntoView({ behavior: 'smooth' });

  servants.forEach(servant => {
    const count = state.obtained[servant.id];
    const isNew = count === 1;
    const card = document.createElement('div');
    card.className = `reveal-card r${servant.rarity}`;
    card.innerHTML = `
      <img src="${servant.face}" alt="${servant.name}" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22140%22 height=%22186%22><rect width=%22140%22 height=%22186%22 fill=%22%231a1d28%22/><text x=%2270%22 y=%2293%22 text-anchor=%22middle%22 fill=%22%23444%22>⚔</text></svg>'">
      ${isNew ? `<div class="card-new-badge">Nova!</div>` : ''}
      <div class="card-info" style="position:absolute; bottom:0; left:0; width:100%; background:rgba(0,0,0,0.75); padding:4px;">
        <div class="card-name" style="font-size:0.65rem;">${servant.name}</div>
        <div class="card-rarity" style="font-size:0.5rem;">${'★'.repeat(servant.rarity)}</div>
      </div>
    `;
    cardsEl.appendChild(card);
  });
}

function closeReveal() {
  document.getElementById('pack-reveal').style.display = 'none';
  renderAlbum();
}

// ── Doubles View & Selling Shop System ─────────────────────
function renderDoublesView() {
  const grid = document.getElementById('doubles-grid');
  const countText = document.getElementById('doubles-count');
  const shopActions = document.getElementById('doubles-shop-actions');
  
  grid.innerHTML = '';

  const duplicatesList = state.servants.filter(s => (state.obtained[s.id] || 0) > 1);
  let totalDuplicatesCount = 0;

  duplicatesList.forEach(s => {
    totalDuplicatesCount += (state.obtained[s.id] - 1);
    const card = buildServantCard(s, s.id);
    grid.appendChild(card);
  });

  if (totalDuplicatesCount > 0) {
    countText.textContent = `Você possui ${totalDuplicatesCount} figurinha(s) repetida(s) prontas para comercialização.`;
    shopActions.style.display = 'block';
  } else {
    countText.textContent = 'Nenhuma figurinha repetida no estoque de Chaldea no momento.';
    shopActions.style.display = 'none';
  }
}

function sellSingleDuplicate(servantId) {
  const servant = state.servants.find(s => s.id === servantId);
  if (!servant || !state.obtained[servantId] || state.obtained[servantId] <= 1) return;

  let profit = 0;
  if (servant.rarity <= 3) profit = 2;
  if (servant.rarity === 4) profit = 5;
  if (servant.rarity === 5) profit = 10;

  state.obtained[servantId]--;
  state.sq += profit;

  showToast(`Vendido! +${profit} SQ por uma cópia de ${servant.name}`, 'info');
  updateSQDisplay();
  persistSave();
  renderAlbum();
  renderDoublesView();
}

function sellAllDuplicates() {
  let totalProfit = 0;
  let soldCount = 0;

  state.servants.forEach(servant => {
    const count = state.obtained[servant.id] || 0;
    if (count > 1) {
      const extraCopies = count - 1;
      let profitPerUnit = 0;

      if (servant.rarity <= 3) profitPerUnit = 2;
      if (servant.rarity === 4) profitPerUnit = 5;
      if (servant.rarity === 5) profitPerUnit = 10;

      if (profitPerUnit > 0) {
        totalProfit += (extraCopies * profitPerUnit);
        soldCount += extraCopies;
        state.obtained[servant.id] = 1; // reset back to album base copy
      }
    }
  });

  if (soldCount === 0) {
    showToast('Nenhuma carta elegível (1-3★, 4★ ou 5★) para venda rápida.', 'error');
    return;
  }

  state.sq += totalProfit;
  showToast(`Sucesso! Foram liquidadas ${soldCount} repetidas rendendo um total de +${totalProfit} SQ!`, 'info');
  
  updateSQDisplay();
  persistSave();
  renderAlbum();
  renderDoublesView();
}

// ── Stats View ─────────────────────────────────────────────
function renderStatsView() {
  const container = document.getElementById('stats-grid');
  if (!container) return;

  const totalAll = state.servants.length;
  const totalOwned = state.servants.filter(s => (state.obtained[s.id] || 0) >= 1).length;
  const missing = totalAll - totalOwned;

  let totalCopies = 0;
  Object.values(state.obtained).forEach(v => totalCopies += v);

  container.innerHTML = `
    <div class="stat-card"><h3>${totalOwned}</h3><p>Servants Obtidos</p></div>
    <div class="stat-card"><h3>${missing}</h3><p>Servants Faltando</p></div>
    <div class="stat-card"><h3>${totalCopies}</h3><p>Total de Cartas Coletadas</p></div>
    <div class="stat-card"><h3>${state.sq.toLocaleString()}</h3><p>Saint Quartz Disponíveis</p></div>
  `;
}

function renderPackHistory() {
  const list = document.getElementById('pack-history-list');
  if (!list) return;

  if (state.packHistory.length === 0) {
    list.innerHTML = '<p style="color:var(--text-dim); font-style:italic;">Nenhuma invocação realizada nesta sessão ainda.</p>';
    return;
  }

  list.innerHTML = state.packHistory.map(item => {
    const date = new Date(item.date).toLocaleTimeString('pt-BR');
    const badgeString = item.servants.map(s => `<span class="history-badge r${s.rarity}">${s.rarity}★</span>`).join(' ');
    return `<div class="history-item"><strong>[${date}]</strong> Invocou ${item.servants.length} Servos: ${badgeString}</div>`;
  }).join('');
}

// ── Album Check Completion ─────────────────────────────────
function checkAlbumCompletion() {
  const totalAll = state.servants.length;
  if (totalAll === 0) return;
  const totalOwned = state.servants.filter(s => (state.obtained[s.id] || 0) >= 1).length;

  if (totalOwned === totalAll) {
    document.getElementById('congrats-total').textContent = totalAll;
    document.getElementById('congrats-overlay').style.display = 'flex';
    triggerFireworks();
  }
}

// ── Rex Run ( Dino No WiFi ) Game Engine ───────────────────
function initDinoUI() {
  document.getElementById('dino-highscore').textContent = state.dinoHighScore;
  document.getElementById('dino-start-screen').style.display = 'flex';
  document.getElementById('dino-score').textContent = '0';
  document.getElementById('dino-sq-earned').textContent = '0';

  // Quick drawing of initial state on canvas
  const canvas = document.getElementById('dino-canvas');
  if (canvas) {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // Draw ground
    ctx.strokeStyle = '#2a2e42';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, canvas.height - 40);
    ctx.lineTo(canvas.width, canvas.height - 40);
    ctx.stroke();
    // Draw player placeholder
    ctx.fillStyle = '#c9a84c';
    ctx.fillRect(50, canvas.height - 80, 30, 40);
  }
}

function startDinoGame() {
  document.getElementById('dino-start-screen').style.display = 'none';
  if (dinoGameInstance) dinoGameInstance.stop();

  dinoGameInstance = new DinoGame();
  dinoGameInstance.start();
}

class DinoGame {
  constructor() {
    this.canvas = document.getElementById('dino-canvas');
    this.ctx = this.canvas.getContext('2d');
    this.isRunning = false;
    this.score = 0;
    this.sqEarned = 0;

    // Player props
    this.player = {
      x: 60,
      y: this.canvas.height - 80,
      width: 30,
      height: 40,
      vy: 0,
      gravity: 0.6,
      jumpForce: -12,
      isGrounded: true
    };

    this.obstacles = [];
    this.spawnTimer = 0;
    this.gameSpeed = 7.5; // was 5.5 — harder start

    // Listeners handles
    this._keydownRef = this.handleKeyDown.bind(this);
    this._touchRef = this.handleTouch.bind(this);
  }

  start() {
    this.isRunning = true;
    window.addEventListener('keydown', this._keydownRef);
    this.canvas.addEventListener('click', this._touchRef);
    this.canvas.addEventListener('touchstart', this._touchRef, { passive: false });
    // Also listen on the wrapper for easier mobile tapping
    const wrapper = document.getElementById('dino-canvas-wrapper');
    if (wrapper) wrapper.addEventListener('touchstart', this._touchRef, { passive: false });
    this.loop();
  }

  stop() {
    this.isRunning = false;
    window.removeEventListener('keydown', this._keydownRef);
    if (this.canvas) {
      this.canvas.removeEventListener('click', this._touchRef);
      this.canvas.removeEventListener('touchstart', this._touchRef);
    }
    const wrapper = document.getElementById('dino-canvas-wrapper');
    if (wrapper) wrapper.removeEventListener('touchstart', this._touchRef);
  }

  handleKeyDown(e) {
    if ((e.code === 'Space' || e.code === 'ArrowUp') && this.player.isGrounded) {
      e.preventDefault();
      this.jump();
    }
  }

  handleTouch(e) {
    if (e.type === 'touchstart') e.preventDefault();
    if (this.player.isGrounded) {
      this.jump();
    }
  }

  jump() {
    this.player.vy = this.player.jumpForce;
    this.player.isGrounded = false;
  }

  gameOver() {
    this.stop();
    // Award the earned SQ definitively to user state
    if (this.sqEarned > 0) {
      state.sq += this.sqEarned;
      updateSQDisplay();
    }

    if (this.score > state.dinoHighScore) {
      state.dinoHighScore = Math.floor(this.score);
      document.getElementById('dino-highscore').textContent = state.dinoHighScore;
    }

    persistSave();
    
    // UI Screen Reset overlay
    const overlay = document.getElementById('dino-start-screen');
    overlay.style.display = 'flex';
    overlay.querySelector('h3').textContent = `Fim de Jogo! Pontuação: ${Math.floor(this.score)}m`;
    overlay.querySelector('p').innerHTML = `Você faturou <strong style="color:var(--star5)">+${this.sqEarned} SQ</strong> nesta corrida do Chaldea!`;
    overlay.querySelector('button').textContent = 'Correr Novamente';
  }

  loop() {
    if (!this.isRunning) return;

    this.update();
    this.draw();

    requestAnimationFrame(() => this.loop());
  }

  update() {
    // Score updates distance meter
    this.score += 0.15;
    document.getElementById('dino-score').textContent = Math.floor(this.score);

    // DINO SQ EARNING ENGINE FORMULA: Every 35 meters gives 1 SQ
    this.sqEarned = Math.floor(this.score / 35);
    document.getElementById('dino-sq-earned').textContent = this.sqEarned;

    // Physics
    this.player.vy += this.player.gravity;
    this.player.y += this.player.vy;

    const groundY = this.canvas.height - 40;
    if (this.player.y + this.player.height >= groundY) {
      this.player.y = groundY - this.player.height;
      this.player.vy = 0;
      this.player.isGrounded = true;
    }

    // Dynamic difficulty speedup
    this.gameSpeed += 0.0015; // was 0.0007 — faster ramp

    // Spawn Obstacles
    this.spawnTimer++;
    if (this.spawnTimer > Math.max(35, 90 - this.gameSpeed * 2)) { // tighter gaps
      if (Math.random() > 0.4) {
        // Randomly build narrow or high rectangular obstacles (magical energy pillars)
        const h = 30 + Math.random() * 35;
        const w = 18 + Math.random() * 12;
        this.obstacles.push({
          x: this.canvas.width,
          y: groundY - h,
          width: w,
          height: h
        });
      }
      this.spawnTimer = 0;
    }

    // Move & Collide obstacles
    for (let i = this.obstacles.length - 1; i >= 0; i--) {
      const obs = this.obstacles[i];
      obs.x -= this.gameSpeed;

      // Box Collision Check
      if (
        this.player.x < obs.x + obs.width &&
        this.player.x + this.player.width > obs.x &&
        this.player.y < obs.y + obs.height &&
        this.player.y + this.player.height > obs.y
      ) {
        this.gameOver();
        return;
      }

      // Remove offscreen obstacles
      if (obs.x + obs.width < 0) {
        this.obstacles.splice(i, 1);
      }
    }
  }

  draw() {
    // Clear canvas frame
    this.ctx.fillStyle = '#14161e';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    const groundY = this.canvas.height - 40;

    // Draw Ground layout
    this.ctx.strokeStyle = '#2a2e42';
    this.ctx.lineWidth = 3;
    this.ctx.beginPath();
    this.ctx.moveTo(0, groundY);
    this.ctx.lineTo(this.canvas.width, groundY);
    this.ctx.stroke();

    // Draw Player (Chaldea Runner Grid box with golden focal layout)
    this.ctx.fillStyle = '#c9a84c';
    this.ctx.shadowColor = 'rgba(201,168,76,0.5)';
    this.ctx.shadowBlur = this.player.isGrounded ? 0 : 10;
    this.ctx.fillRect(this.player.x, this.player.y, this.player.width, this.player.height);
    // Face shield detail inner box
    this.ctx.fillStyle = '#f5f0e8';
    this.ctx.fillRect(this.player.x + 18, this.player.y + 8, 8, 8);
    
    // Draw Enemies/Obstacles (Crimson spires)
    this.ctx.shadowBlur = 4;
    this.ctx.shadowColor = '#c0392b';
    this.ctx.fillStyle = '#8b1a1a';
    this.obstacles.forEach(obs => {
      this.ctx.fillRect(obs.x, obs.y, obs.width, obs.height);
      // highlights Border
      this.ctx.strokeStyle = '#c0392b';
      this.ctx.lineWidth = 1;
      this.ctx.strokeRect(obs.x, obs.y, obs.width, obs.height);
    });

    // Reset shadow context parameters
    this.ctx.shadowBlur = 0;
  }
}

// ── Save Management Helpers ────────────────────────────────
function exportSave() {
  const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(localStorage.getItem(SAVE_KEY));
  const downloadAnchor = document.createElement('a');
  downloadAnchor.setAttribute("href", dataStr);
  downloadAnchor.setAttribute("download", `fgo_album_save_${new Date().toISOString().slice(0,10)}.json`);
  document.body.appendChild(downloadAnchor);
  downloadAnchor.click();
  downloadAnchor.remove();
  showToast('Save exportado!', 'success');
}

function importSave(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(evt) {
    try {
      const parsed = JSON.parse(evt.target.result);
      if (parsed.obtained) {
        localStorage.setItem(SAVE_KEY, evt.target.result);
        showToast('Save importado com sucesso! Recarregando...', 'success');
        setTimeout(() => location.reload(), 1000);
      } else {
        showToast('Arquivo inválido!', 'error');
      }
    } catch(err) {
      showToast('Erro ao ler arquivo!', 'error');
    }
  };
  reader.readAsText(file);
}

// ── Background & Toast Helpers ─────────────────────────────
function initBackground() {
  const canvas = document.getElementById('bg-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let pts = [];

  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  window.addEventListener('resize', resize);
  resize();

  for (let i = 0; i < 45; i++) {
    pts.push({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      speedX: (Math.random() - 0.5) * 0.4,
      speedY: -0.3 - Math.random() * 0.5,
      alpha: 0.2 + Math.random() * 0.6,
      size: 1 + Math.random() * 2
    });
  }

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#c9a84c';
    pts.forEach(p => {
      ctx.globalAlpha = p.alpha;
      ctx.fillRect(p.x, p.y, p.size, p.size);
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

function showToast(msg, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = msg;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3200);
}

function triggerFireworks() {
  const box = document.getElementById('congrats-fireworks');
  if(!box) return;
  box.innerHTML = '';
  for (let i = 0; i < 5; i++) {
    setTimeout(() => {
      const f = document.createElement('div');
      f.style.position = 'absolute';
      f.style.left = `${20 + Math.random() * 60}%`;
      f.style.top = `${20 + Math.random() * 50}%`;
      for(let j=0; j<20; j++) {
        const p = document.createElement('div');
        p.className = 'firework';
        p.style.setProperty('--dx', `${(Math.random() - 0.5) * 200}px`);
        p.style.setProperty('--dy', `${(Math.random() - 0.5) * 200}px`);
        p.style.background = rarityColor(Math.floor(Math.random()*5)+1);
        f.appendChild(p);
      }
      box.appendChild(f);
      setTimeout(() => f.remove(), 1000);
    }, i * 400);
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function capitalize(str) { return str.charAt(0).toUpperCase() + str.slice(1); }
function rarityColor(r) {
  const map = {1:'#9e9e9e', 2:'#7cb0d6', 3:'#6abf6a', 4:'#d4a0e8', 5:'#f0c040'};
  return map[r] || '#fff';
}
function formatDuration(ms) {
  if (ms <= 0) return '00:00:00';
  let s = Math.floor(ms / 1000);
  let m = Math.floor(s / 60); s %= 60;
  let h = Math.floor(m / 60); m %= 60;
  return [h, m, s].map(v => String(v).padStart(2, '0')).join(':');
}