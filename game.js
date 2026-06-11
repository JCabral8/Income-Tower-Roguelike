'use strict';

/* =====================================================================
   GREEDKEEP — income maze TD roguelike (prototype)
   - Mazing: towers block the grid, creeps pathfind (BFS flow field)
   - Income: payout each wave; invest gold for permanent income;
             send waves early for an interest bonus
   - Roguelike: draft 1-of-3 relics after every wave, endless scaling
   ===================================================================== */

/* ---------------- Config ---------------- */

const COLS = 12, ROWS = 18;
const SPAWN = { x: Math.floor(COLS / 2), y: 0 };
const EXIT  = { x: Math.floor(COLS / 2), y: ROWS - 1 };
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

const CFG = {
  startGold: 90,
  startIncome: 12,
  startLives: 20,
  firstPrep: 30,
  prepTime: 16,
  investBase: 30,
  investIncomeGain: 3,
  investGrowth: 1.25,
  sellRatio: 0.7,
  maxLevel: 7,
  skipDraftGold: 15,
};

const TOWERS = {
  arrow:  { name: 'Arrow',  icon: '🏹', cost: 25, dmg: 8,  rate: 1.8,  range: 2.3, color: '#7dd3fc', projSpeed: 9 },
  frost:  { name: 'Frost',  icon: '❄️', cost: 35, dmg: 4,  rate: 1.0,  range: 2.1, color: '#a5b4fc', projSpeed: 7, slow: 0.45, slowDur: 1.6 },
  cannon: { name: 'Cannon', icon: '💣', cost: 50, dmg: 24, rate: 0.55, range: 2.6, color: '#fdba74', projSpeed: 6, splash: 1.0 },
  sniper: { name: 'Sniper', icon: '🎯', cost: 70, dmg: 48, rate: 0.33, range: 5.5, color: '#f9a8d4', projSpeed: 16 },
};

/* ---------------- Relics ---------------- */

const RELICS = [
  { id: 'sharp',     icon: '🏹', rarity: 'common', name: 'Sharpened Arrows', desc: 'Arrow towers deal +30% damage.',
    apply: s => { s.mods.dmg.arrow *= 1.3; } },
  { id: 'shells',    icon: '💣', rarity: 'common', name: 'Heavy Shells', desc: 'Cannon towers deal +30% damage.',
    apply: s => { s.mods.dmg.cannon *= 1.3; } },
  { id: 'nest',      icon: '🎯', rarity: 'common', name: "Sniper's Nest", desc: 'Sniper towers deal +35% damage.',
    apply: s => { s.mods.dmg.sniper *= 1.35; } },
  { id: 'rime',      icon: '❄️', rarity: 'common', name: 'Rime Coating', desc: 'Frost towers deal +40% damage.',
    apply: s => { s.mods.dmg.frost *= 1.4; } },
  { id: 'overclock', icon: '⚙️', rarity: 'common', name: 'Overclock', desc: 'All towers attack 12% faster.',
    apply: s => { s.mods.rate *= 1.12; } },
  { id: 'bounty',    icon: '💰', rarity: 'common', name: 'Bounty Hunter', desc: 'Kills give +30% gold.',
    apply: s => { s.mods.bounty *= 1.3; } },
  { id: 'chest',     icon: '🧰', rarity: 'common', name: 'War Chest', desc: 'Gain 60 gold right now.',
    apply: s => { s.gold += 60; } },
  { id: 'dividend',  icon: '🏦', rarity: 'common', name: 'Dividend', desc: 'Permanently gain +4 income.',
    apply: s => { s.income += 4; } },
  { id: 'fortify',   icon: '🛡️', rarity: 'common', name: 'Fortify', desc: 'Gain +5 lives.',
    apply: s => { s.lives += 5; } },
  { id: 'boom',      icon: '💥', rarity: 'rare', name: 'Bigger Booms', desc: 'Cannon splash radius +30%.',
    apply: s => { s.mods.splash *= 1.3; } },
  { id: 'freeze',    icon: '🧊', rarity: 'rare', name: 'Deep Freeze', desc: 'Frost slow is 12% stronger.',
    apply: s => { s.mods.slowBonus += 0.12; }, can: s => s.mods.slowBonus < 0.36 },
  { id: 'crit',      icon: '🎲', rarity: 'rare', name: 'Headshot', desc: 'All towers: +10% chance to crit for 2.5×.',
    apply: s => { s.mods.crit += 0.10; }, can: s => s.mods.crit < 0.5 },
  { id: 'compound',  icon: '🪙', rarity: 'rare', name: 'Compound Interest', desc: 'Investing grants +1 extra income.',
    apply: s => { s.mods.investBonus += 1; } },
  { id: 'taxbreak',  icon: '🧾', rarity: 'rare', name: 'Tax Break', desc: 'Invest price rises more slowly.',
    apply: s => { s.mods.growthDelta -= 0.05; }, can: s => s.mods.growthDelta > -0.1 },
  { id: 'watch',     icon: '🔭', rarity: 'rare', name: 'Long Watch', desc: 'All towers gain +0.3 range.',
    apply: s => { s.mods.range += 0.3; } },
  { id: 'golden',    icon: '👑', rarity: 'epic', name: 'Golden Age', desc: 'Income payouts are +25% larger.',
    apply: s => { s.mods.incomeMul *= 1.25; } },
  { id: 'glass',     icon: '🍷', rarity: 'epic', name: 'Glass Cannon', desc: 'All towers +35% damage. Lose 4 lives.',
    apply: s => { s.mods.dmg.all *= 1.35; s.lives = Math.max(1, s.lives - 4); } },
  { id: 'midas',     icon: '✨', rarity: 'epic', name: 'Midas Touch', desc: 'Gain gold equal to your income, and +2 income.',
    apply: s => { s.gold += s.income; s.income += 2; } },
];

const RARITY_WEIGHT = { common: 6, rare: 3, epic: 1 };

/* ---------------- Waves ---------------- */

function waveDef(n) {
  const hpBase = 14 * Math.pow(1.22, n - 1);
  const bountyBase = Math.max(1, Math.round(2 + hpBase * 0.04));
  const count = 10 + Math.min(12, Math.floor(n * 0.7));
  if (n % 5 === 0) {
    return { kind: 'boss', color: '#ef4444', count: 1, hp: hpBase * 22, speed: 1.0,
             bounty: bountyBase * 12, leak: 5, interval: 1, r: 0.40 };
  }
  switch ((n - 1) % 4) {
    case 0: return { kind: 'grunt', color: '#f87171', count, hp: hpBase, speed: 1.5,
                     bounty: bountyBase, leak: 1, interval: 0.8, r: 0.26 };
    case 1: return { kind: 'swarm', color: '#a3e635', count: Math.round(count * 1.8), hp: hpBase * 0.45, speed: 1.7,
                     bounty: Math.max(1, Math.round(bountyBase * 0.5)), leak: 1, interval: 0.4, r: 0.20 };
    case 2: return { kind: 'fast', color: '#fbbf24', count, hp: hpBase * 0.7, speed: 2.4,
                     bounty: bountyBase, leak: 1, interval: 0.6, r: 0.22 };
    default: return { kind: 'tank', color: '#c084fc', count: Math.max(4, Math.round(count * 0.55)), hp: hpBase * 2.4, speed: 1.05,
                      bounty: bountyBase * 2, leak: 2, interval: 1.4, r: 0.32 };
  }
}

/* ---------------- State ---------------- */

let state = null;

function freshMods() {
  return {
    dmg: { arrow: 1, frost: 1, cannon: 1, sniper: 1, all: 1 },
    rate: 1,
    range: 0,
    bounty: 1,
    splash: 1,
    slowBonus: 0,
    crit: 0,
    investBonus: 0,
    incomeMul: 1,
    growthDelta: 0,
  };
}

function newRun() {
  state = {
    gold: CFG.startGold,
    income: CFG.startIncome,
    lives: CFG.startLives,
    wave: 0,
    phase: 'prep',           // prep | wave | draft | over
    prepLeft: CFG.firstPrep,
    investCost: CFG.investBase,
    towers: [],
    enemies: [],
    projs: [],
    floaters: [],
    blocked: new Uint8Array(COLS * ROWS),
    dist: null,
    path: [],
    spawnQueue: 0,
    spawnSpec: null,
    spawnTimer: 0,
    mods: freshMods(),
    relics: [],
    speed: 1,
    selected: null,
    buildType: null,
    ghost: null,
    best: Number(localStorage.getItem('greedkeep_best') || 0),
  };
  recomputeFlow();
  hideOverlay();
  panelSig = '';
  syncTowerPanel();
  renderRelicBar();
}

/* ---------------- Pathfinding ---------------- */

function idx(x, y) { return x + y * COLS; }

function computeDist(extraBlock = -1) {
  const dist = new Int32Array(COLS * ROWS).fill(-1);
  const start = idx(EXIT.x, EXIT.y);
  if (start === extraBlock) return dist;
  dist[start] = 0;
  const q = [start];
  for (let h = 0; h < q.length; h++) {
    const i = q[h], x = i % COLS, y = (i / COLS) | 0, d = dist[i] + 1;
    for (const [dx, dy] of DIRS) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) continue;
      const ni = idx(nx, ny);
      if (ni === extraBlock || state.blocked[ni] || dist[ni] !== -1) continue;
      dist[ni] = d;
      q.push(ni);
    }
  }
  return dist;
}

function recomputeFlow() {
  state.dist = computeDist();
  // path preview: descend the flow field from spawn
  const path = [];
  let cx = SPAWN.x, cy = SPAWN.y, guard = COLS * ROWS + 5;
  if (state.dist[idx(cx, cy)] >= 0) {
    path.push([cx, cy]);
    while (state.dist[idx(cx, cy)] > 0 && guard-- > 0) {
      const n = nextTile(cx, cy);
      if (n.x === cx && n.y === cy) break;
      cx = n.x; cy = n.y;
      path.push([cx, cy]);
    }
  }
  state.path = path;
}

function nextTile(x, y) {
  let best = null, bd = state.dist[idx(x, y)];
  for (const [dx, dy] of DIRS) {
    const nx = x + dx, ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) continue;
    const d = state.dist[idx(nx, ny)];
    if (d >= 0 && d < bd) { bd = d; best = { x: nx, y: ny }; }
  }
  return best || { x, y };
}

function canPlace(x, y) {
  if (x < 0 || y < 0 || x >= COLS || y >= ROWS) return false;
  if ((x === SPAWN.x && y === SPAWN.y) || (x === EXIT.x && y === EXIT.y)) return false;
  const i = idx(x, y);
  if (state.blocked[i]) return false;
  for (const e of state.enemies) {
    if ((Math.floor(e.x) === x && Math.floor(e.y) === y) || (e.next.x === x && e.next.y === y)) return false;
  }
  const d = computeDist(i);
  if (d[idx(SPAWN.x, SPAWN.y)] < 0) return false;
  for (const e of state.enemies) {
    const ex = Math.floor(e.x), ey = Math.floor(e.y);
    if (ex < 0 || ey < 0 || ex >= COLS || ey >= ROWS) continue;
    if (d[idx(ex, ey)] < 0) return false;
  }
  return true;
}

/* ---------------- Economy & actions ---------------- */

function towerDmg(t) {
  const base = TOWERS[t.type];
  return base.dmg * Math.pow(1.5, t.lvl - 1) * state.mods.dmg[t.type] * state.mods.dmg.all;
}
function towerRange(t) {
  return TOWERS[t.type].range + 0.18 * (t.lvl - 1) + state.mods.range;
}
function towerRate(t) {
  return TOWERS[t.type].rate * state.mods.rate;
}
function upgradeCost(t) {
  return Math.round(TOWERS[t.type].cost * 0.8 * Math.pow(1.55, t.lvl - 1));
}
function sellValue(t) {
  return Math.round(t.spent * CFG.sellRatio);
}
function sendBonus() {
  return Math.ceil(state.prepLeft * state.income * 0.05);
}

function towerAt(x, y) {
  return state.towers.find(t => t.x === x && t.y === y) || null;
}

function tryBuild(x, y) {
  const base = TOWERS[state.buildType];
  if (state.gold < base.cost) { setHint('Not enough gold.'); return; }
  if (!canPlace(x, y)) { setHint("Can't build there — the path must stay open."); return; }
  state.gold -= base.cost;
  state.towers.push({ x, y, type: state.buildType, lvl: 1, cd: 0, spent: base.cost });
  state.blocked[idx(x, y)] = 1;
  recomputeFlow();
  state.ghost = null;
  setHint('');
}

function doUpgrade() {
  const t = state.selected;
  if (!t || t.lvl >= CFG.maxLevel) return;
  const c = upgradeCost(t);
  if (state.gold < c) return;
  state.gold -= c;
  t.spent += c;
  t.lvl++;
  panelSig = '';
}

function doSell() {
  const t = state.selected;
  if (!t) return;
  state.gold += sellValue(t);
  state.blocked[idx(t.x, t.y)] = 0;
  state.towers = state.towers.filter(o => o !== t);
  state.selected = null;
  recomputeFlow();
}

function doInvest() {
  if (state.gold < state.investCost) return;
  state.gold -= state.investCost;
  const gain = CFG.investIncomeGain + state.mods.investBonus;
  state.income += gain;
  addFloater(COLS / 2, ROWS / 2, `+${gain} income`, '#4ade80');
  state.investCost = Math.round(state.investCost * (CFG.investGrowth + state.mods.growthDelta));
}

function doSend() {
  if (state.phase !== 'prep') return;
  const bonus = sendBonus();
  if (bonus > 0) {
    state.gold += bonus;
    addFloater(SPAWN.x + 0.5, SPAWN.y + 1.5, `+${bonus}🪙 early!`, '#f4d03f');
  }
  startWave();
}

/* ---------------- Wave flow ---------------- */

function startWave() {
  state.wave++;
  const def = waveDef(state.wave);
  state.spawnSpec = def;
  state.spawnQueue = def.count;
  state.spawnTimer = 0.01;
  state.phase = 'wave';
}

function spawnEnemy(def) {
  state.enemies.push({
    x: SPAWN.x + 0.5,
    y: -0.5,
    next: { x: SPAWN.x, y: SPAWN.y },
    hp: Math.max(1, Math.round(def.hp)),
    maxHp: Math.max(1, Math.round(def.hp)),
    speed: def.speed,
    bounty: def.bounty,
    leak: def.leak,
    kind: def.kind,
    color: def.color,
    r: def.r,
    slowT: 0,
    slowPct: 0,
    dead: false,
  });
}

function endWave() {
  const payout = Math.round(state.income * state.mods.incomeMul);
  state.gold += payout;
  addFloater(COLS / 2, ROWS / 2 - 1, `+${payout}🪙 income`, '#4ade80');
  openDraft(payout);
}

function checkGameOver() {
  if (state.lives > 0 || state.phase === 'over') return;
  state.phase = 'over';
  state.best = Math.max(state.best, state.wave);
  localStorage.setItem('greedkeep_best', String(state.best));
  showGameOver();
}

/* ---------------- Combat ---------------- */

function damage(e, amt, canCrit) {
  if (e.dead) return;
  let dmg = amt;
  let crit = false;
  if (canCrit && state.mods.crit > 0 && Math.random() < state.mods.crit) {
    dmg *= 2.5;
    crit = true;
  }
  e.hp -= dmg;
  if (e.hp <= 0) {
    e.dead = true;
    const g = Math.max(1, Math.round(e.bounty * state.mods.bounty));
    state.gold += g;
    addFloater(e.x, e.y, crit ? `+${g}🪙!` : `+${g}`, crit ? '#f4d03f' : '#d4b545');
  } else if (crit) {
    addFloater(e.x, e.y, 'CRIT', '#f87171');
  }
}

function applySlow(e, pct, dur) {
  let p = pct + state.mods.slowBonus;
  if (e.kind === 'boss') p *= 0.5;
  if (p > e.slowPct || e.slowT <= 0) e.slowPct = Math.min(0.85, p);
  e.slowT = Math.max(e.slowT, dur);
}

function leak(e) {
  e.dead = true;
  state.lives -= e.leak;
  addFloater(EXIT.x + 0.5, EXIT.y - 0.5, `-${e.leak}❤️`, '#f87171');
  checkGameOver();
}

function pickTarget(t) {
  const range = towerRange(t);
  const tx = t.x + 0.5, ty = t.y + 0.5;
  let best = null, bestKey = Infinity;
  for (const e of state.enemies) {
    if (e.dead || e.y < 0) continue;
    const dx = e.x - tx, dy = e.y - ty;
    if (dx * dx + dy * dy > range * range) continue;
    // prioritize the creep closest to the exit
    const ni = idx(e.next.x, e.next.y);
    const remaining = (state.dist[ni] >= 0 ? state.dist[ni] : 999) + Math.hypot(e.next.x + 0.5 - e.x, e.next.y + 0.5 - e.y);
    if (remaining < bestKey) { bestKey = remaining; best = e; }
  }
  return best;
}

function fire(t, target) {
  const base = TOWERS[t.type];
  state.projs.push({
    x: t.x + 0.5,
    y: t.y + 0.5,
    type: t.type,
    color: base.color,
    speed: base.projSpeed,
    dmg: towerDmg(t),
    splash: base.splash ? base.splash * state.mods.splash : 0,
    slow: base.slow || 0,
    slowDur: base.slowDur || 0,
    target,
    lastX: target.x,
    lastY: target.y,
  });
}

/* ---------------- Update ---------------- */

function update(dt) {
  if (state.phase === 'prep') {
    state.prepLeft -= dt;
    if (state.prepLeft <= 0) {
      state.prepLeft = 0;
      startWave();
    }
  }

  if (state.phase === 'wave') {
    // spawning
    if (state.spawnQueue > 0) {
      state.spawnTimer -= dt;
      while (state.spawnTimer <= 0 && state.spawnQueue > 0) {
        spawnEnemy(state.spawnSpec);
        state.spawnQueue--;
        state.spawnTimer += state.spawnSpec.interval;
      }
    }
    // enemies
    for (const e of state.enemies) {
      if (e.dead) continue;
      const slowed = e.slowT > 0;
      if (slowed) e.slowT -= dt;
      const sp = e.speed * (slowed ? 1 - e.slowPct : 1);
      let step = sp * dt;
      while (step > 0 && !e.dead) {
        const tx = e.next.x + 0.5, ty = e.next.y + 0.5;
        const dx = tx - e.x, dy = ty - e.y;
        const d = Math.hypot(dx, dy);
        if (d <= step) {
          e.x = tx; e.y = ty;
          step -= d;
          if (state.dist[idx(e.next.x, e.next.y)] === 0) { leak(e); break; }
          const n = nextTile(e.next.x, e.next.y);
          if (n.x === e.next.x && n.y === e.next.y) break; // stuck (shouldn't happen)
          e.next = n;
        } else {
          e.x += dx / d * step;
          e.y += dy / d * step;
          step = 0;
        }
      }
    }
    state.enemies = state.enemies.filter(e => !e.dead);
    // wave complete?
    if (state.spawnQueue === 0 && state.enemies.length === 0 && state.phase === 'wave') {
      endWave();
    }
  }

  // towers
  for (const t of state.towers) {
    t.cd -= dt;
    if (t.cd > 0) continue;
    const target = pickTarget(t);
    if (target) {
      fire(t, target);
      t.cd = 1 / towerRate(t);
    } else {
      t.cd = 0;
    }
  }

  // projectiles
  for (const p of state.projs) {
    const alive = p.target && !p.target.dead;
    const tx = alive ? p.target.x : p.lastX;
    const ty = alive ? p.target.y : p.lastY;
    if (alive) { p.lastX = tx; p.lastY = ty; }
    const dx = tx - p.x, dy = ty - p.y;
    const d = Math.hypot(dx, dy);
    const step = p.speed * dt;
    if (d <= step + 0.05) {
      p.x = tx; p.y = ty;
      p.hit = true;
      if (p.splash > 0) {
        for (const e of state.enemies) {
          if (e.dead) continue;
          const ex = e.x - p.x, ey = e.y - p.y;
          if (ex * ex + ey * ey <= p.splash * p.splash) damage(e, p.dmg, true);
        }
      } else if (alive) {
        damage(p.target, p.dmg, true);
        if (p.slow > 0 && !p.target.dead) applySlow(p.target, p.slow, p.slowDur);
      }
    } else {
      p.x += dx / d * step;
      p.y += dy / d * step;
    }
  }
  state.projs = state.projs.filter(p => !p.hit);

  // floaters
  for (const f of state.floaters) {
    f.t += dt;
    f.y -= dt * 0.8;
  }
  state.floaters = state.floaters.filter(f => f.t < 1.2);
}

function addFloater(x, y, txt, color) {
  if (state.floaters.length > 40) state.floaters.shift();
  state.floaters.push({ x, y, txt, color, t: 0 });
}

/* ---------------- Rendering ---------------- */

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
let ts = 24, ox = 0, oy = 0; // tile size + board offset, in CSS px

function fit() {
  const wrap = document.getElementById('canvasWrap');
  const w = wrap.clientWidth, h = wrap.clientHeight;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ts = Math.floor(Math.min(w / COLS, h / ROWS));
  ox = Math.floor((w - ts * COLS) / 2);
  oy = Math.floor((h - ts * ROWS) / 2);
}

function px(x) { return ox + x * ts; }
function py(y) { return oy + y * ts; }

function draw() {
  const w = canvas.width / (window.devicePixelRatio || 1);
  const h = canvas.height / (window.devicePixelRatio || 1);
  ctx.clearRect(0, 0, w, h);

  // board
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      ctx.fillStyle = (x + y) % 2 === 0 ? '#11161f' : '#0f141d';
      ctx.fillRect(px(x), py(y), ts, ts);
    }
  }

  // spawn / exit markers
  ctx.fillStyle = '#1d3325';
  ctx.fillRect(px(SPAWN.x), py(SPAWN.y), ts, ts);
  ctx.fillStyle = '#3a2330';
  ctx.fillRect(px(EXIT.x), py(EXIT.y), ts, ts);
  ctx.font = `${ts * 0.55}px serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#4ade80';
  ctx.fillText('▼', px(SPAWN.x) + ts / 2, py(SPAWN.y) + ts / 2);
  ctx.fillStyle = '#f87171';
  ctx.fillText('⌂', px(EXIT.x) + ts / 2, py(EXIT.y) + ts / 2);

  // path preview
  if (state.path.length > 1) {
    ctx.strokeStyle = 'rgba(244, 208, 63, 0.30)';
    ctx.lineWidth = Math.max(2, ts * 0.12);
    ctx.setLineDash([ts * 0.3, ts * 0.25]);
    ctx.beginPath();
    ctx.moveTo(px(state.path[0][0]) + ts / 2, py(state.path[0][1]) + ts / 2);
    for (let i = 1; i < state.path.length; i++) {
      ctx.lineTo(px(state.path[i][0]) + ts / 2, py(state.path[i][1]) + ts / 2);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // towers
  for (const t of state.towers) {
    const base = TOWERS[t.type];
    ctx.fillStyle = '#1c2430';
    roundRect(px(t.x) + 2, py(t.y) + 2, ts - 4, ts - 4, ts * 0.18);
    ctx.fill();
    ctx.strokeStyle = base.color;
    ctx.lineWidth = t === state.selected ? 2.5 : 1.2;
    roundRect(px(t.x) + 2, py(t.y) + 2, ts - 4, ts - 4, ts * 0.18);
    ctx.stroke();
    ctx.font = `${ts * 0.48}px serif`;
    ctx.fillText(base.icon, px(t.x) + ts / 2, py(t.y) + ts * 0.46);
    if (t.lvl > 1) {
      ctx.fillStyle = '#f4d03f';
      ctx.font = `bold ${ts * 0.26}px sans-serif`;
      ctx.fillText(String(t.lvl), px(t.x) + ts * 0.74, py(t.y) + ts * 0.76);
    }
  }

  // range ring for selected tower
  if (state.selected) {
    drawRange(state.selected.x, state.selected.y, towerRange(state.selected), 'rgba(125, 211, 252, 0.5)');
  }

  // ghost
  if (state.buildType && state.ghost) {
    const g = state.ghost;
    const base = TOWERS[state.buildType];
    const ok = g.ok && state.gold >= base.cost;
    drawRange(g.x, g.y, base.range + state.mods.range, ok ? 'rgba(74, 222, 128, 0.5)' : 'rgba(248, 113, 113, 0.5)');
    ctx.globalAlpha = 0.6;
    ctx.fillStyle = ok ? '#1d3325' : '#3a2330';
    roundRect(px(g.x) + 2, py(g.y) + 2, ts - 4, ts - 4, ts * 0.18);
    ctx.fill();
    ctx.font = `${ts * 0.48}px serif`;
    ctx.fillText(base.icon, px(g.x) + ts / 2, py(g.y) + ts * 0.5);
    ctx.globalAlpha = 1;
  }

  // enemies
  for (const e of state.enemies) {
    if (e.y < -0.4) continue;
    const ex = px(e.x), ey = py(e.y);
    const r = e.r * ts;
    ctx.fillStyle = e.color;
    ctx.beginPath();
    ctx.arc(ex, ey, r, 0, Math.PI * 2);
    ctx.fill();
    if (e.slowT > 0) {
      ctx.strokeStyle = '#a5b4fc';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    if (e.hp < e.maxHp) {
      const bw = ts * 0.6;
      ctx.fillStyle = '#0d1117';
      ctx.fillRect(ex - bw / 2, ey - r - 6, bw, 4);
      ctx.fillStyle = '#4ade80';
      ctx.fillRect(ex - bw / 2, ey - r - 6, bw * Math.max(0, e.hp / e.maxHp), 4);
    }
  }

  // projectiles
  for (const p of state.projs) {
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(px(p.x), py(p.y), p.type === 'cannon' ? ts * 0.12 : ts * 0.08, 0, Math.PI * 2);
    ctx.fill();
  }

  // floaters
  for (const f of state.floaters) {
    ctx.globalAlpha = Math.max(0, 1 - f.t / 1.2);
    ctx.fillStyle = f.color;
    ctx.font = `bold ${ts * 0.38}px sans-serif`;
    ctx.fillText(f.txt, px(f.x), py(f.y));
    ctx.globalAlpha = 1;
  }
}

function drawRange(x, y, range, color) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 4]);
  ctx.beginPath();
  ctx.arc(px(x) + ts / 2, py(y) + ts / 2, range * ts, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
}

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/* ---------------- UI ---------------- */

const $ = id => document.getElementById(id);
const elGold = $('stGold'), elIncome = $('stIncome'), elLives = $('stLives'), elWave = $('stWave');
const btnInvest = $('btnInvest'), btnSend = $('btnSend'), btnSpeed = $('btnSpeed'), btnRestart = $('btnRestart');
const towerPanel = $('towerPanel'), overlay = $('overlay'), hintEl = $('hint'), relicBar = $('relicBar');

let hintOverride = '';
let panelSig = '';

function setHint(t) { hintOverride = t; if (t) setTimeout(() => { if (hintOverride === t) hintOverride = ''; }, 2500); }

function buildButtons() {
  const wrap = $('buildBtns');
  wrap.innerHTML = '';
  for (const key of Object.keys(TOWERS)) {
    const b = document.createElement('button');
    const t = TOWERS[key];
    b.innerHTML = `<span class="ico">${t.icon}</span>${t.name}<br>${t.cost}🪙`;
    b.dataset.type = key;
    b.addEventListener('click', () => {
      if (state.buildType === key) {
        state.buildType = null;
        state.ghost = null;
      } else {
        state.buildType = key;
        state.ghost = null;
        state.selected = null;
      }
    });
    wrap.appendChild(b);
  }
}

function syncUI() {
  elGold.textContent = `🪙 ${state.gold}`;
  elIncome.textContent = `📈 ${state.income}`;
  elLives.textContent = `❤️ ${state.lives}`;
  elWave.textContent = `🌊 ${state.wave}${state.best ? ` · best ${state.best}` : ''}`;

  // build buttons
  for (const b of $('buildBtns').children) {
    const t = TOWERS[b.dataset.type];
    b.disabled = state.gold < t.cost && state.buildType !== b.dataset.type;
    b.classList.toggle('active', state.buildType === b.dataset.type);
  }

  // invest
  const gain = CFG.investIncomeGain + state.mods.investBonus;
  btnInvest.innerHTML = `📈 Invest +${gain}<br>${state.investCost}🪙`;
  btnInvest.disabled = state.gold < state.investCost || state.phase === 'over';

  // send
  if (state.phase === 'prep') {
    btnSend.innerHTML = `▶ Send wave ${state.wave + 1}<br>+${sendBonus()}🪙 · ${Math.ceil(state.prepLeft)}s`;
    btnSend.disabled = false;
  } else if (state.phase === 'wave') {
    btnSend.innerHTML = `Wave ${state.wave}<br>${state.enemies.length + state.spawnQueue} left`;
    btnSend.disabled = true;
  } else {
    btnSend.innerHTML = `—`;
    btnSend.disabled = true;
  }

  btnSpeed.textContent = `${state.speed}×`;

  // hint
  if (hintOverride) {
    hintEl.textContent = hintOverride;
  } else if (state.buildType && !state.ghost) {
    hintEl.textContent = 'Tap a tile to preview · tap again to build';
  } else if (state.buildType && state.ghost) {
    hintEl.textContent = state.ghost.ok ? 'Tap the tile again to confirm' : 'Blocked — the maze must leave a path';
  } else if (state.wave === 0) {
    hintEl.textContent = 'Build a maze between ▼ and ⌂, then send the wave';
  } else {
    hintEl.textContent = 'Invest to grow income · send early for bonus gold';
  }

  syncTowerPanel();
}

function syncTowerPanel() {
  const t = state.selected;
  const sig = t ? `${t.x},${t.y},${t.lvl},${state.gold >= upgradeCost(t)},${t.lvl >= CFG.maxLevel}` : '';
  if (sig === panelSig) return;
  panelSig = sig;
  if (!t) {
    towerPanel.classList.add('hidden');
    towerPanel.innerHTML = '';
    return;
  }
  const base = TOWERS[t.type];
  const maxed = t.lvl >= CFG.maxLevel;
  towerPanel.classList.remove('hidden');
  towerPanel.innerHTML = `
    <div class="tpInfo"><b>${base.icon} ${base.name} Lv${t.lvl}</b><br>
      dmg ${Math.round(towerDmg(t))} · rng ${towerRange(t).toFixed(1)} · ${towerRate(t).toFixed(2)}/s</div>
    <button id="tpUp" ${maxed || state.gold < upgradeCost(t) ? 'disabled' : ''}>${maxed ? 'MAX' : `⬆ ${upgradeCost(t)}🪙`}</button>
    <button id="tpSell" class="sell">💸 ${sellValue(t)}🪙</button>
    <button id="tpClose">✕</button>`;
  $('tpUp').addEventListener('click', doUpgrade);
  $('tpSell').addEventListener('click', doSell);
  $('tpClose').addEventListener('click', () => { state.selected = null; });
}

function renderRelicBar() {
  relicBar.innerHTML = state.relics
    .map(id => {
      const r = RELICS.find(o => o.id === id);
      return `<span title="${r.name}: ${r.desc}">${r.icon}</span>`;
    })
    .join('');
}

/* ---------------- Draft & game over ---------------- */

function rollDraft() {
  const pool = RELICS.filter(r => !r.can || r.can(state));
  const picks = [];
  while (picks.length < 3 && pool.length > 0) {
    let tot = 0;
    for (const r of pool) tot += RARITY_WEIGHT[r.rarity];
    let roll = Math.random() * tot;
    let chosenIdx = 0;
    for (let i = 0; i < pool.length; i++) {
      roll -= RARITY_WEIGHT[pool[i].rarity];
      if (roll <= 0) { chosenIdx = i; break; }
    }
    picks.push(pool[chosenIdx]);
    pool.splice(chosenIdx, 1);
  }
  return picks;
}

function openDraft(payout) {
  state.phase = 'draft';
  const picks = rollDraft();
  overlay.innerHTML = `
    <div class="modal">
      <h2>Wave ${state.wave} cleared!</h2>
      <div class="sub">+${payout}🪙 income paid · pick a relic</div>
      <div class="cards">
        ${picks.map((r, i) => `
          <button class="card ${r.rarity}" data-i="${i}">
            <span class="ico">${r.icon}</span>
            <span><span class="nm">${r.name}</span><br><span class="ds">${r.desc}</span></span>
          </button>`).join('')}
      </div>
      <button class="minor" id="skipDraft">Skip (+${CFG.skipDraftGold}🪙)</button>
    </div>`;
  overlay.classList.remove('hidden');
  overlay.querySelectorAll('.card').forEach(btn => {
    btn.addEventListener('click', () => {
      const r = picks[Number(btn.dataset.i)];
      r.apply(state);
      state.relics.push(r.id);
      renderRelicBar();
      closeDraft();
    });
  });
  $('skipDraft').addEventListener('click', () => {
    state.gold += CFG.skipDraftGold;
    closeDraft();
  });
}

function closeDraft() {
  hideOverlay();
  checkGameOver(); // glass cannon can't kill you (min 1 life), but be safe
  if (state.phase !== 'over') {
    state.phase = 'prep';
    state.prepLeft = CFG.prepTime;
  }
}

function showGameOver() {
  overlay.innerHTML = `
    <div class="modal">
      <h2>💀 The keep has fallen</h2>
      <div class="sub">You survived <b>${state.wave}</b> wave${state.wave === 1 ? '' : 's'} · best ${state.best}</div>
      <button class="big" id="btnAgain">⚔️ Run it back</button>
    </div>`;
  overlay.classList.remove('hidden');
  $('btnAgain').addEventListener('click', newRun);
}

function hideOverlay() {
  overlay.classList.add('hidden');
  overlay.innerHTML = '';
}

/* ---------------- Input ---------------- */

canvas.addEventListener('pointerdown', ev => {
  if (state.phase === 'draft' || state.phase === 'over') return;
  const rect = canvas.getBoundingClientRect();
  const x = Math.floor((ev.clientX - rect.left - ox) / ts);
  const y = Math.floor((ev.clientY - rect.top - oy) / ts);
  if (x < 0 || y < 0 || x >= COLS || y >= ROWS) {
    state.selected = null;
    state.ghost = null;
    return;
  }
  const t = towerAt(x, y);
  if (t) {
    state.selected = t;
    state.ghost = null;
    return;
  }
  if (state.buildType) {
    if (state.ghost && state.ghost.x === x && state.ghost.y === y) {
      tryBuild(x, y);
    } else {
      state.ghost = { x, y, ok: canPlace(x, y) };
    }
    return;
  }
  state.selected = null;
});

btnInvest.addEventListener('click', doInvest);
btnSend.addEventListener('click', doSend);
btnSpeed.addEventListener('click', () => {
  state.speed = state.speed >= 3 ? 1 : state.speed + 1;
});
btnRestart.addEventListener('click', () => {
  if (state.phase === 'over' || confirm('Restart this run?')) newRun();
});
window.addEventListener('resize', fit);

/* ---------------- Main loop ---------------- */

let lastT = performance.now();
function frame(now) {
  let dt = Math.min(0.05, (now - lastT) / 1000);
  lastT = now;
  if (state.phase === 'prep' || state.phase === 'wave') {
    update(dt * state.speed);
  }
  draw();
  syncUI();
  requestAnimationFrame(frame);
}

/* ---------------- Boot ---------------- */

buildButtons();
newRun();
fit();
requestAnimationFrame(frame);
