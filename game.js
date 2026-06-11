'use strict';

/* =====================================================================
   GREEDKEEP — income maze TD roguelite
   Run loop: mazing TD + per-wave income + relic power-spikes.
   Meta loop: earn cores -> Workshop unlocks towers, variant branches,
              and permanent buffs that carry across runs.
   ===================================================================== */

/* ---------------- Board ---------------- */

const COLS = 12, ROWS = 18;
const SPAWN = { x: Math.floor(COLS / 2), y: 0 };
const EXIT  = { x: Math.floor(COLS / 2), y: ROWS - 1 };
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

const CFG = {
  startGold: 80,
  startIncome: 12,
  startLives: 20,
  firstPrep: 30,
  prepTime: 16,
  investBase: 30,
  investIncomeGain: 3,
  investGrowth: 1.25,
  sellRatio: 0.7,
  maxLevel: 7,
  skipDraftGold: 20,
  draftEvery: 4,    // relic power-spike cadence
  diminish: 0.6,    // each extra copy of a relic gives this fraction of the last
};

/* ---------------- Towers (base + variant branches) ----------------
   `fam` ties a variant to its base family so damage relics apply to both. */

const TOWERS = {
  arrow:         { fam: 'arrow',  name: 'Arrow',      icon: '🏹', cost: 25,  dmg: 8,   rate: 1.8,  range: 2.3, color: '#7dd3fc', projSpeed: 9,  blurb: 'Cheap, fast single-target. Maze filler.' },
  arrow_multi:   { fam: 'arrow',  name: 'Scattershot',icon: '🪶', cost: 35,  dmg: 6,   rate: 1.6,  range: 2.3, color: '#7dd3fc', projSpeed: 9,  multi: 2, blurb: 'Hits two targets at once.' },
  frost:         { fam: 'frost',  name: 'Frost',      icon: '❄️', cost: 35,  dmg: 4,   rate: 1.0,  range: 2.1, color: '#a5b4fc', projSpeed: 7,  slow: 0.45, slowDur: 1.6, blurb: 'Slows creeps — force-multiplies the maze.' },
  frost_glacial: { fam: 'frost',  name: 'Glacier',    icon: '🧊', cost: 50,  dmg: 6,   rate: 0.9,  range: 1.8, color: '#a5b4fc', projSpeed: 7,  slow: 0.62, slowDur: 2.0, blurb: 'Much stronger slow, shorter range.' },
  cannon:        { fam: 'cannon', name: 'Cannon',     icon: '💣', cost: 50,  dmg: 24,  rate: 0.55, range: 2.6, color: '#fdba74', projSpeed: 6,  splash: 1.0, blurb: 'Splash damage — answers swarms.' },
  cannon_mortar: { fam: 'cannon', name: 'Mortar',     icon: '🎆', cost: 70,  dmg: 34,  rate: 0.38, range: 3.1, color: '#fdba74', projSpeed: 4,  splash: 1.6, blurb: 'Bigger, slower booms.' },
  sniper:        { fam: 'sniper', name: 'Sniper',     icon: '🎯', cost: 70,  dmg: 48,  rate: 0.33, range: 5.5, color: '#f9a8d4', projSpeed: 16, blurb: 'Long range, big hits. Answers tanks.' },
  sniper_rail:   { fam: 'sniper', name: 'Railgun',    icon: '🛰️', cost: 100, dmg: 110, rate: 0.2,  range: 6.5, color: '#f9a8d4', projSpeed: 30, splash: 0.7, blurb: 'Devastating slow shots with cleave.' },
  poison:        { fam: 'poison', name: 'Poison',     icon: '☠️', cost: 45,  dmg: 3,   rate: 1.2,  range: 2.2, color: '#86efac', projSpeed: 8,  poison: { dps: 6, dur: 3 }, blurb: 'Damage-over-time. Melts high-HP creeps.' },
  poison_plague: { fam: 'poison', name: 'Plague',     icon: '🦠', cost: 60,  dmg: 3,   rate: 1.1,  range: 2.3, color: '#86efac', projSpeed: 8,  poison: { dps: 9, dur: 4.5 }, blurb: 'Stronger, longer-lasting poison.' },
  tesla:         { fam: 'tesla',  name: 'Tesla',      icon: '⚡', cost: 60,  dmg: 14,  rate: 0.9,  range: 2.4, color: '#67e8f9', projSpeed: 20, chain: { hops: 3, falloff: 0.6 }, blurb: 'Chains lightning between packed creeps.' },
  tesla_arc:     { fam: 'tesla',  name: 'Arc Coil',   icon: '🌩️', cost: 80,  dmg: 11,  rate: 0.85, range: 2.5, color: '#67e8f9', projSpeed: 20, chain: { hops: 5, falloff: 0.72 }, blurb: 'Lightning chains to far more targets.' },
};

// Unlock tree: each base costs cores; its alt variant costs more and needs the base.
const TOWER_TREE = [
  { base: 'arrow',  variant: 'arrow_multi',   baseCost: 0,  varCost: 5 },
  { base: 'frost',  variant: 'frost_glacial', baseCost: 3,  varCost: 6 },
  { base: 'cannon', variant: 'cannon_mortar', baseCost: 6,  varCost: 8 },
  { base: 'sniper', variant: 'sniper_rail',   baseCost: 10, varCost: 12 },
  { base: 'poison', variant: 'poison_plague', baseCost: 12, varCost: 12 },
  { base: 'tesla',  variant: 'tesla_arc',     baseCost: 16, varCost: 14 },
];

// Permanent buffs purchased with cores (level-based).
const BUFFS = [
  { id: 'gold',   icon: '🪙', name: 'Treasury',    per: 15, max: 6, base: 4, step: 3, unit: 'starting gold' },
  { id: 'income', icon: '📈', name: 'Trust Fund',  per: 1,  max: 6, base: 5, step: 4, unit: 'base income' },
  { id: 'lives',  icon: '❤️', name: 'Battlements', per: 3,  max: 5, base: 4, step: 3, unit: 'starting lives' },
];
const buffCost = (b, lvl) => b.base + lvl * b.step;

/* ---------------- Relics ----------------
   stat relics feed `recomputeMods` (with diminishing returns per copy);
   instant relics fire once on pick. `family` drives threshold set-bonuses. */

const RELICS = [
  // -- Offense --
  { id: 'sharp',     icon: '🏹', rarity: 'common', family: 'offense', req: 'arrow',  name: 'Sharpened Arrows', stat: 'dmg.arrow',  mode: 'mul', base: 0.45, suffix: 'Arrow damage' },
  { id: 'shells',    icon: '💣', rarity: 'common', family: 'offense', req: 'cannon', name: 'Heavy Shells',     stat: 'dmg.cannon', mode: 'mul', base: 0.45, suffix: 'Cannon damage' },
  { id: 'nest',      icon: '🎯', rarity: 'common', family: 'offense', req: 'sniper', name: "Sniper's Nest",   stat: 'dmg.sniper', mode: 'mul', base: 0.5,  suffix: 'Sniper damage' },
  { id: 'rime',      icon: '❄️', rarity: 'common', family: 'offense', req: 'frost',  name: 'Rime Coating',     stat: 'dmg.frost',  mode: 'mul', base: 0.55, suffix: 'Frost damage' },
  { id: 'venom',     icon: '☠️', rarity: 'common', family: 'offense', req: 'poison', name: 'Concentrate',      stat: 'dmg.poison', mode: 'mul', base: 0.5,  suffix: 'Poison damage' },
  { id: 'volt',      icon: '⚡', rarity: 'common', family: 'offense', req: 'tesla',  name: 'High Voltage',     stat: 'dmg.tesla',  mode: 'mul', base: 0.5,  suffix: 'Tesla damage' },
  { id: 'overclock', icon: '⚙️', rarity: 'common', family: 'offense', name: 'Overclock',  stat: 'rate',  mode: 'mul', base: 0.16, suffix: 'attack speed' },
  { id: 'watch',     icon: '🔭', rarity: 'rare',   family: 'offense', name: 'Long Watch', stat: 'range', mode: 'add', base: 0.4,  suffix: 'tower range' },
  { id: 'crit',      icon: '🎲', rarity: 'rare',   family: 'offense', name: 'Headshot',   stat: 'crit',  mode: 'add', base: 0.10, pct: true, suffix: 'crit (2.5×)' },
  { id: 'glass',     icon: '🍷', rarity: 'epic',   family: 'offense', name: 'Glass Cannon', stat: 'dmg.all', mode: 'mul', base: 0.40, suffix: 'all damage',
    instantNote: 'Lose 4 lives', instant: s => { s.lives = Math.max(1, s.lives - 4); } },
  // -- Economy --
  { id: 'bounty',    icon: '💰', rarity: 'common', family: 'economy', name: 'Bounty Hunter', stat: 'bounty',      mode: 'mul', base: 0.45, suffix: 'kill gold' },
  { id: 'dividend',  icon: '🏦', rarity: 'common', family: 'economy', name: 'Dividend',      stat: 'incomeFlat',  mode: 'add', base: 6,    suffix: 'income' },
  { id: 'compound',  icon: '🪙', rarity: 'common', family: 'economy', name: 'Compound Interest', stat: 'investBonus', mode: 'add', base: 1, suffix: 'income per Invest' },
  { id: 'taxbreak',  icon: '🧾', rarity: 'rare',   family: 'economy', name: 'Tax Break',     stat: 'growthDelta', mode: 'add', base: -0.05, staticDesc: 'Invest prices rise more slowly.' },
  { id: 'chest',     icon: '🧰', rarity: 'common', family: 'economy', name: 'War Chest',     instantNote: 'Gain 90 gold now', instant: s => { s.gold += 90; } },
  { id: 'golden',    icon: '👑', rarity: 'epic',   family: 'economy', name: 'Golden Age',    stat: 'incomeMul',   mode: 'mul', base: 0.30, suffix: 'income payout' },
  { id: 'midas',     icon: '✨', rarity: 'epic',   family: 'economy', name: 'Midas Touch',   instantNote: 'Gain gold = income, +2 income',
    instant: s => { s.gold += s.income; s.investIncome += 2; } },
  // -- Control --
  { id: 'freeze',    icon: '🧊', rarity: 'common', family: 'control', req: 'frost',  name: 'Deep Freeze',   stat: 'slowBonus', mode: 'add', base: 0.12, pct: true, suffix: 'slow' },
  { id: 'boom',      icon: '💥', rarity: 'common', family: 'control', req: 'cannon', name: 'Bigger Booms',  stat: 'splash',    mode: 'mul', base: 0.30, suffix: 'splash radius' },
  { id: 'glacier',   icon: '⛄', rarity: 'rare',   family: 'control', name: 'Permafrost',    stat: 'slowBonus', mode: 'add', base: 0.08, pct: true, suffix: 'slow' },
  { id: 'rampart',   icon: '🛡️', rarity: 'common', family: 'control', name: 'Rampart',       instantNote: 'Gain 5 lives', instant: s => { s.lives += 5; } },
];
const RELIC_BY_ID = Object.fromEntries(RELICS.map(r => [r.id, r]));
const RARITY_WEIGHT = { common: 6, rare: 3, epic: 1 };

// Family set-bonuses: crossing a count threshold grants an adjacency spike.
const FAMILY = {
  offense: { icon: '⚔️', name: 'Offense', steps: [{ at: 3, dmgAll: 0.12 }, { at: 5, dmgAll: 0.15 }, { at: 7, dmgAll: 0.20 }] },
  economy: { icon: '💰', name: 'Economy', steps: [{ at: 3, incomeMul: 0.10 }, { at: 5, incomeMul: 0.12 }, { at: 7, incomeMul: 0.15 }] },
  control: { icon: '🧊', name: 'Control', steps: [{ at: 3, slow: 0.06, splash: 0.10 }, { at: 5, slow: 0.08, splash: 0.12 }] },
};

/* ---------------- Waves ---------------- */

function waveDef(n) {
  const hpBase = 18 * Math.pow(1.27, n - 1);
  const bountyBase = Math.max(1, Math.round(2 + hpBase * 0.035));
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
    case 2: return { kind: 'fast', color: '#fbbf24', count, hp: hpBase * 0.7, speed: 2.5,
                     bounty: bountyBase, leak: 1, interval: 0.6, r: 0.22 };
    default: return { kind: 'tank', color: '#c084fc', count: Math.max(4, Math.round(count * 0.55)), hp: hpBase * 2.5, speed: 1.05,
                      bounty: bountyBase * 2, leak: 2, interval: 1.4, r: 0.32 };
  }
}

/* ---------------- Meta (persistent) ---------------- */

const META_KEY = 'greedkeep_meta';
let meta = loadMeta();

function defaultMeta() {
  return { cores: 0, best: 0, unlocked: { arrow: true }, equipped: { arrow: 'arrow' }, buffs: {} };
}
function loadMeta() {
  try {
    const m = JSON.parse(localStorage.getItem(META_KEY));
    if (!m || typeof m !== 'object') return defaultMeta();
    return Object.assign(defaultMeta(), m,
      { unlocked: Object.assign({ arrow: true }, m.unlocked),
        equipped: Object.assign({ arrow: 'arrow' }, m.equipped),
        buffs: Object.assign({}, m.buffs) });
  } catch (_) { return defaultMeta(); }
}
function saveMeta() {
  try { localStorage.setItem(META_KEY, JSON.stringify(meta)); } catch (_) {}
}

/* ---------------- State ---------------- */

let state = null;

function freshMods() {
  return {
    dmg: { arrow: 1, frost: 1, cannon: 1, sniper: 1, poison: 1, tesla: 1, all: 1 },
    rate: 1, range: 0, bounty: 1, splash: 1, slowBonus: 0, crit: 0,
    investBonus: 0, incomeMul: 1, incomeFlat: 0, growthDelta: 0,
  };
}

function newRun() {
  const buffs = meta.buffs || {};
  state = {
    gold: CFG.startGold + (buffs.gold || 0) * 15,
    baseIncome: CFG.startIncome + (buffs.income || 0),
    investIncome: 0,
    income: 0,
    lives: CFG.startLives + (buffs.lives || 0) * 3,
    wave: 0,
    phase: 'prep',
    prepLeft: CFG.firstPrep,
    investCost: CFG.investBase,
    towers: [],
    enemies: [],
    projs: [],
    zaps: [],
    floaters: [],
    blocked: new Uint8Array(COLS * ROWS),
    dist: null,
    path: [],
    spawnQueue: 0,
    spawnSpec: null,
    spawnTimer: 0,
    mods: freshMods(),
    relics: [],
    fam: { offense: 0, economy: 0, control: 0 },
    speed: 1,
    selected: null,
    buildType: null,
    ghost: null,
    best: meta.best,
  };
  recomputeFlow();
  recomputeMods();
  hideOverlay();
  panelSig = '';
  buildButtons();
  syncTowerPanel();
  renderRelicBar();
}

/* ---------------- Mods recompute (diminishing returns + set bonuses) ---------------- */

function addStat(m, path, mode, v) {
  const parts = path.split('.');
  const obj = parts.length === 2 ? m[parts[0]] : m;
  const key = parts.length === 2 ? parts[1] : parts[0];
  if (mode === 'mul') obj[key] *= (1 + v);
  else obj[key] += v;
}

function recomputeMods() {
  const m = freshMods();
  const counts = {};
  for (const id of state.relics) counts[id] = (counts[id] || 0) + 1;
  for (const id in counts) {
    const r = RELIC_BY_ID[id];
    if (!r || !r.stat) continue;
    for (let k = 0; k < counts[id]; k++) {
      addStat(m, r.stat, r.mode, r.base * Math.pow(CFG.diminish, k));
    }
  }
  const fam = { offense: 0, economy: 0, control: 0 };
  for (const id of state.relics) { const r = RELIC_BY_ID[id]; if (r && r.family) fam[r.family]++; }
  for (const f in FAMILY) {
    for (const step of FAMILY[f].steps) {
      if (fam[f] < step.at) continue;
      if (step.dmgAll) m.dmg.all *= (1 + step.dmgAll);
      if (step.incomeMul) m.incomeMul *= (1 + step.incomeMul);
      if (step.slow) m.slowBonus += step.slow;
      if (step.splash) m.splash *= (1 + step.splash);
    }
  }
  m.crit = Math.min(m.crit, 0.6);
  m.slowBonus = Math.min(m.slowBonus, 0.5);
  m.growthDelta = Math.max(m.growthDelta, -0.15);
  state.mods = m;
  state.fam = fam;
  state.income = Math.round(state.baseIncome + state.investIncome + m.incomeFlat);
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
  return base.dmg * Math.pow(1.5, t.lvl - 1) * state.mods.dmg[base.fam] * state.mods.dmg.all;
}
function towerRange(t) { return TOWERS[t.type].range + 0.18 * (t.lvl - 1) + state.mods.range; }
function towerRate(t) { return TOWERS[t.type].rate * state.mods.rate; }
function upgradeCost(t) { return Math.round(TOWERS[t.type].cost * 0.8 * Math.pow(1.55, t.lvl - 1)); }
function sellValue(t) { return Math.round(t.spent * CFG.sellRatio); }
function sendBonus() { return Math.ceil(state.prepLeft * state.income * 0.05); }
function towerAt(x, y) { return state.towers.find(t => t.x === x && t.y === y) || null; }

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
  state.gold -= c; t.spent += c; t.lvl++;
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
  state.investIncome += gain;
  recomputeMods();
  addFloater(COLS / 2, ROWS / 2, `+${trim(gain)} income`, '#4ade80');
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
  const hp = Math.max(1, Math.round(def.hp));
  state.enemies.push({
    x: SPAWN.x + 0.5, y: -0.5,
    next: { x: SPAWN.x, y: SPAWN.y },
    hp, maxHp: hp,
    speed: def.speed, bounty: def.bounty, leak: def.leak,
    kind: def.kind, color: def.color, r: def.r,
    slowT: 0, slowPct: 0, poisonT: 0, poisonDps: 0, dead: false,
  });
}

function endWave() {
  const payout = Math.round(state.income * state.mods.incomeMul);
  state.gold += payout;
  addFloater(COLS / 2, ROWS / 2 - 1, `+${payout}🪙 income`, '#4ade80');
  if (state.wave % CFG.draftEvery === 0) openDraft(payout);
  else advanceToPrep();
}

function advanceToPrep() {
  checkGameOver();
  if (state.phase !== 'over') {
    state.phase = 'prep';
    state.prepLeft = CFG.prepTime;
  }
}

function checkGameOver() {
  if (state.lives > 0 || state.phase === 'over') return;
  state.phase = 'over';
  showGameOver();
}

/* ---------------- Combat ---------------- */

function damage(e, amt, canCrit) {
  if (e.dead) return;
  let dmg = amt, crit = false;
  if (canCrit && state.mods.crit > 0 && Math.random() < state.mods.crit) { dmg *= 2.5; crit = true; }
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

function teslaChain(origin, dmg, chain) {
  let cur = dmg * chain.falloff;
  const hit = new Set([origin]);
  let from = origin;
  const pts = [[from.x, from.y]];
  for (let h = 0; h < chain.hops; h++) {
    let best = null, bd = 1.9 * 1.9;
    for (const e of state.enemies) {
      if (e.dead || hit.has(e) || e.y < 0) continue;
      const dx = e.x - from.x, dy = e.y - from.y, d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = e; }
    }
    if (!best) break;
    damage(best, cur, false);
    hit.add(best); pts.push([best.x, best.y]); from = best; cur *= chain.falloff;
  }
  if (pts.length > 1) state.zaps.push({ pts, t: 0 });
}

function leak(e) {
  e.dead = true;
  state.lives -= e.leak;
  addFloater(EXIT.x + 0.5, EXIT.y - 0.5, `-${e.leak}❤️`, '#f87171');
  checkGameOver();
}

function pickTarget(t) {
  return pickTargets(t, 1)[0] || null;
}
function pickTargets(t, n) {
  const range = towerRange(t), tx = t.x + 0.5, ty = t.y + 0.5;
  const inRange = [];
  for (const e of state.enemies) {
    if (e.dead || e.y < 0) continue;
    const dx = e.x - tx, dy = e.y - ty;
    if (dx * dx + dy * dy > range * range) continue;
    const ni = idx(e.next.x, e.next.y);
    const remaining = (state.dist[ni] >= 0 ? state.dist[ni] : 999) +
      Math.hypot(e.next.x + 0.5 - e.x, e.next.y + 0.5 - e.y);
    inRange.push({ e, remaining });
  }
  inRange.sort((a, b) => a.remaining - b.remaining);
  return inRange.slice(0, n).map(o => o.e);
}

function fire(t, target) {
  const base = TOWERS[t.type];
  const p = {
    x: t.x + 0.5, y: t.y + 0.5, type: t.type, color: base.color,
    speed: base.projSpeed, dmg: towerDmg(t), target, lastX: target.x, lastY: target.y,
  };
  if (base.splash) p.splash = base.splash * state.mods.splash;
  if (base.slow) { p.slow = base.slow; p.slowDur = base.slowDur; }
  if (base.poison) p.poison = { dps: base.poison.dps * Math.pow(1.5, t.lvl - 1) * state.mods.dmg[base.fam] * state.mods.dmg.all, dur: base.poison.dur };
  if (base.chain) p.chain = base.chain;
  state.projs.push(p);
}

/* ---------------- Update ---------------- */

function update(dt) {
  if (state.phase === 'prep') {
    state.prepLeft -= dt;
    if (state.prepLeft <= 0) { state.prepLeft = 0; startWave(); }
  }

  if (state.phase === 'wave') {
    if (state.spawnQueue > 0) {
      state.spawnTimer -= dt;
      while (state.spawnTimer <= 0 && state.spawnQueue > 0) {
        spawnEnemy(state.spawnSpec); state.spawnQueue--; state.spawnTimer += state.spawnSpec.interval;
      }
    }
    for (const e of state.enemies) {
      if (e.dead) continue;
      if (e.poisonT > 0) { e.poisonT -= dt; damage(e, e.poisonDps * dt, false); if (e.dead) continue; }
      const slowed = e.slowT > 0;
      if (slowed) e.slowT -= dt;
      const sp = e.speed * (slowed ? 1 - e.slowPct : 1);
      let step = sp * dt;
      while (step > 0 && !e.dead) {
        const tx = e.next.x + 0.5, ty = e.next.y + 0.5;
        const dx = tx - e.x, dy = ty - e.y, d = Math.hypot(dx, dy);
        if (d <= step) {
          e.x = tx; e.y = ty; step -= d;
          if (state.dist[idx(e.next.x, e.next.y)] === 0) { leak(e); break; }
          const nx = nextTile(e.next.x, e.next.y);
          if (nx.x === e.next.x && nx.y === e.next.y) break;
          e.next = nx;
        } else { e.x += dx / d * step; e.y += dy / d * step; step = 0; }
      }
    }
    state.enemies = state.enemies.filter(e => !e.dead);
    if (state.spawnQueue === 0 && state.enemies.length === 0 && state.phase === 'wave') endWave();
  }

  for (const t of state.towers) {
    t.cd -= dt;
    if (t.cd > 0) continue;
    const base = TOWERS[t.type];
    const targets = base.multi ? pickTargets(t, base.multi) : (pickTarget(t) ? [pickTarget(t)] : []);
    if (targets.length) { for (const tg of targets) fire(t, tg); t.cd = 1 / towerRate(t); }
    else t.cd = 0;
  }

  for (const p of state.projs) {
    const alive = p.target && !p.target.dead;
    const tx = alive ? p.target.x : p.lastX, ty = alive ? p.target.y : p.lastY;
    if (alive) { p.lastX = tx; p.lastY = ty; }
    const dx = tx - p.x, dy = ty - p.y, d = Math.hypot(dx, dy), step = p.speed * dt;
    if (d <= step + 0.05) {
      p.x = tx; p.y = ty; p.hit = true;
      if (p.splash > 0) {
        for (const e of state.enemies) {
          if (e.dead) continue;
          const ex = e.x - p.x, ey = e.y - p.y;
          if (ex * ex + ey * ey <= p.splash * p.splash) damage(e, p.dmg, true);
        }
      } else if (alive) {
        damage(p.target, p.dmg, true);
        if (p.slow > 0 && !p.target.dead) applySlow(p.target, p.slow, p.slowDur);
        if (p.poison && !p.target.dead) {
          p.target.poisonDps = Math.max(p.target.poisonDps, p.poison.dps);
          p.target.poisonT = Math.max(p.target.poisonT, p.poison.dur);
        }
        if (p.chain) teslaChain(p.target, p.dmg, p.chain);
      }
    } else { p.x += dx / d * step; p.y += dy / d * step; }
  }
  state.projs = state.projs.filter(p => !p.hit);

  for (const z of state.zaps) z.t += dt;
  state.zaps = state.zaps.filter(z => z.t < 0.22);

  for (const f of state.floaters) { f.t += dt; f.y -= dt * 0.8; }
  state.floaters = state.floaters.filter(f => f.t < 1.2);
}

function addFloater(x, y, txt, color) {
  if (state.floaters.length > 40) state.floaters.shift();
  state.floaters.push({ x, y, txt, color, t: 0 });
}

/* ---------------- Rendering ---------------- */

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
let ts = 24, ox = 0, oy = 0;

function fit() {
  const wrap = document.getElementById('canvasWrap');
  const w = wrap.clientWidth, h = wrap.clientHeight, dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ts = Math.floor(Math.min(w / COLS, h / ROWS));
  ox = Math.floor((w - ts * COLS) / 2); oy = Math.floor((h - ts * ROWS) / 2);
}
function px(x) { return ox + x * ts; }
function py(y) { return oy + y * ts; }

function draw() {
  const w = canvas.width / (window.devicePixelRatio || 1), h = canvas.height / (window.devicePixelRatio || 1);
  ctx.clearRect(0, 0, w, h);
  for (let y = 0; y < ROWS; y++)
    for (let x = 0; x < COLS; x++) {
      ctx.fillStyle = (x + y) % 2 === 0 ? '#11161f' : '#0f141d';
      ctx.fillRect(px(x), py(y), ts, ts);
    }

  ctx.fillStyle = '#1d3325'; ctx.fillRect(px(SPAWN.x), py(SPAWN.y), ts, ts);
  ctx.fillStyle = '#3a2330'; ctx.fillRect(px(EXIT.x), py(EXIT.y), ts, ts);
  ctx.font = `${ts * 0.55}px serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = '#4ade80'; ctx.fillText('▼', px(SPAWN.x) + ts / 2, py(SPAWN.y) + ts / 2);
  ctx.fillStyle = '#f87171'; ctx.fillText('⌂', px(EXIT.x) + ts / 2, py(EXIT.y) + ts / 2);

  if (state.path.length > 1) {
    ctx.strokeStyle = 'rgba(244, 208, 63, 0.30)'; ctx.lineWidth = Math.max(2, ts * 0.12);
    ctx.setLineDash([ts * 0.3, ts * 0.25]); ctx.beginPath();
    ctx.moveTo(px(state.path[0][0]) + ts / 2, py(state.path[0][1]) + ts / 2);
    for (let i = 1; i < state.path.length; i++) ctx.lineTo(px(state.path[i][0]) + ts / 2, py(state.path[i][1]) + ts / 2);
    ctx.stroke(); ctx.setLineDash([]);
  }

  for (const t of state.towers) {
    const base = TOWERS[t.type];
    ctx.fillStyle = '#1c2430'; roundRect(px(t.x) + 2, py(t.y) + 2, ts - 4, ts - 4, ts * 0.18); ctx.fill();
    ctx.strokeStyle = base.color; ctx.lineWidth = t === state.selected ? 2.5 : 1.2;
    roundRect(px(t.x) + 2, py(t.y) + 2, ts - 4, ts - 4, ts * 0.18); ctx.stroke();
    ctx.font = `${ts * 0.48}px serif`; ctx.fillStyle = '#fff';
    ctx.fillText(base.icon, px(t.x) + ts / 2, py(t.y) + ts * 0.46);
    if (t.lvl > 1) {
      ctx.fillStyle = '#f4d03f'; ctx.font = `bold ${ts * 0.26}px sans-serif`;
      ctx.fillText(String(t.lvl), px(t.x) + ts * 0.74, py(t.y) + ts * 0.76);
    }
  }

  if (state.selected) drawRange(state.selected.x, state.selected.y, towerRange(state.selected), 'rgba(125, 211, 252, 0.5)');

  if (state.buildType && state.ghost) {
    const g = state.ghost, base = TOWERS[state.buildType], ok = g.ok && state.gold >= base.cost;
    drawRange(g.x, g.y, base.range + state.mods.range, ok ? 'rgba(74, 222, 128, 0.5)' : 'rgba(248, 113, 113, 0.5)');
    ctx.globalAlpha = 0.6; ctx.fillStyle = ok ? '#1d3325' : '#3a2330';
    roundRect(px(g.x) + 2, py(g.y) + 2, ts - 4, ts - 4, ts * 0.18); ctx.fill();
    ctx.font = `${ts * 0.48}px serif`; ctx.fillStyle = '#fff';
    ctx.fillText(base.icon, px(g.x) + ts / 2, py(g.y) + ts * 0.5); ctx.globalAlpha = 1;
  }

  for (const z of state.zaps) {
    ctx.strokeStyle = `rgba(103,232,249,${1 - z.t / 0.22})`; ctx.lineWidth = 2.2;
    ctx.beginPath(); ctx.moveTo(px(z.pts[0][0]), py(z.pts[0][1]));
    for (let i = 1; i < z.pts.length; i++) ctx.lineTo(px(z.pts[i][0]), py(z.pts[i][1]));
    ctx.stroke();
  }

  for (const e of state.enemies) {
    if (e.y < -0.4) continue;
    const ex = px(e.x), ey = py(e.y), r = e.r * ts;
    ctx.fillStyle = e.color; ctx.beginPath(); ctx.arc(ex, ey, r, 0, Math.PI * 2); ctx.fill();
    if (e.slowT > 0) { ctx.strokeStyle = '#a5b4fc'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(ex, ey, r, 0, Math.PI * 2); ctx.stroke(); }
    if (e.poisonT > 0) { ctx.strokeStyle = '#86efac'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(ex, ey, r + 2.5, 0, Math.PI * 2); ctx.stroke(); }
    if (e.hp < e.maxHp) {
      const bw = ts * 0.6;
      ctx.fillStyle = '#0d1117'; ctx.fillRect(ex - bw / 2, ey - r - 6, bw, 4);
      ctx.fillStyle = '#4ade80'; ctx.fillRect(ex - bw / 2, ey - r - 6, bw * Math.max(0, e.hp / e.maxHp), 4);
    }
  }

  for (const p of state.projs) {
    ctx.fillStyle = p.color; ctx.beginPath();
    ctx.arc(px(p.x), py(p.y), p.splash ? ts * 0.12 : ts * 0.08, 0, Math.PI * 2); ctx.fill();
  }

  for (const f of state.floaters) {
    ctx.globalAlpha = Math.max(0, 1 - f.t / 1.2); ctx.fillStyle = f.color;
    ctx.font = `bold ${ts * 0.38}px sans-serif`; ctx.fillText(f.txt, px(f.x), py(f.y)); ctx.globalAlpha = 1;
  }
}

function drawRange(x, y, range, color) {
  ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.setLineDash([5, 4]);
  ctx.beginPath(); ctx.arc(px(x) + ts / 2, py(y) + ts / 2, range * ts, 0, Math.PI * 2); ctx.stroke();
  ctx.setLineDash([]);
}
function roundRect(x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

/* ---------------- UI ---------------- */

const $ = id => document.getElementById(id);
const elGold = $('stGold'), elIncome = $('stIncome'), elLives = $('stLives'), elWave = $('stWave');
const btnInvest = $('btnInvest'), btnSend = $('btnSend'), btnSpeed = $('btnSpeed'), btnRestart = $('btnRestart');
const towerPanel = $('towerPanel'), overlay = $('overlay'), hintEl = $('hint'), relicBar = $('relicBar');

let hintOverride = '', panelSig = '';
function setHint(t) { hintOverride = t; if (t) setTimeout(() => { if (hintOverride === t) hintOverride = ''; }, 2500); }
function trim(v) { return Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/0+$/, '').replace(/\.$/, ''); }

function toggleBuild(key) {
  if (state.buildType === key) { state.buildType = null; state.ghost = null; }
  else { state.buildType = key; state.ghost = null; state.selected = null; }
}

function buildButtons() {
  const wrap = $('buildBtns'); wrap.innerHTML = '';
  for (const node of TOWER_TREE) {
    if (!meta.unlocked[node.base]) continue;
    const typeId = meta.equipped[node.base] || node.base;
    const t = TOWERS[typeId];
    const b = document.createElement('button');
    b.innerHTML = `<span class="ico">${t.icon}</span>${t.name}<br>${t.cost}🪙`;
    b.dataset.type = typeId;
    b.addEventListener('click', () => toggleBuild(typeId));
    wrap.appendChild(b);
  }
}

function syncUI() {
  elGold.textContent = `🪙 ${state.gold}`;
  elIncome.textContent = `📈 ${state.income}`;
  elLives.textContent = `❤️ ${state.lives}`;
  elWave.textContent = `🌊 ${state.wave}${state.best ? ` · best ${state.best}` : ''}`;

  for (const b of $('buildBtns').children) {
    const t = TOWERS[b.dataset.type];
    b.disabled = state.gold < t.cost && state.buildType !== b.dataset.type;
    b.classList.toggle('active', state.buildType === b.dataset.type);
  }

  const gain = CFG.investIncomeGain + state.mods.investBonus;
  btnInvest.innerHTML = `📈 Invest +${trim(gain)}<br>${state.investCost}🪙`;
  btnInvest.disabled = state.gold < state.investCost || state.phase === 'over';

  if (state.phase === 'prep') {
    const spike = (state.wave % CFG.draftEvery === CFG.draftEvery - 1) ? '⚡ ' : '';
    btnSend.innerHTML = `${spike}▶ Send wave ${state.wave + 1}<br>+${sendBonus()}🪙 · ${Math.ceil(state.prepLeft)}s`;
    btnSend.disabled = false;
  } else if (state.phase === 'wave') {
    btnSend.innerHTML = `Wave ${state.wave}<br>${state.enemies.length + state.spawnQueue} left`;
    btnSend.disabled = true;
  } else { btnSend.innerHTML = '—'; btnSend.disabled = true; }

  btnSpeed.textContent = `${state.speed}×`;

  if (hintOverride) hintEl.textContent = hintOverride;
  else if (state.buildType && !state.ghost) hintEl.textContent = 'Tap a tile to preview · tap again to build';
  else if (state.buildType && state.ghost) hintEl.textContent = state.ghost.ok ? 'Tap the tile again to confirm' : 'Blocked — the maze must leave a path';
  else if (state.wave === 0) hintEl.textContent = 'Build a maze between ▼ and ⌂, then send the wave';
  else {
    const togo = CFG.draftEvery - (state.wave % CFG.draftEvery);
    hintEl.textContent = togo === 1 ? '⚡ Relic power spike after the next wave!' : `Invest to grow income · ${togo} waves to next relic`;
  }

  syncTowerPanel();
}

function syncTowerPanel() {
  const t = state.selected;
  const sig = t ? `${t.x},${t.y},${t.lvl},${state.gold >= upgradeCost(t)},${t.lvl >= CFG.maxLevel}` : '';
  if (sig === panelSig) return;
  panelSig = sig;
  if (!t) { towerPanel.classList.add('hidden'); towerPanel.innerHTML = ''; return; }
  const base = TOWERS[t.type], maxed = t.lvl >= CFG.maxLevel;
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
  const counts = {};
  for (const id of state.relics) counts[id] = (counts[id] || 0) + 1;
  const fam = state.fam || { offense: 0, economy: 0, control: 0 };
  const famPart = Object.keys(FAMILY).map(f => `${FAMILY[f].icon}${fam[f]}`).join(' ');
  const relicPart = Object.keys(counts).map(id => {
    const r = RELIC_BY_ID[id];
    return `${r.icon}${counts[id] > 1 ? `<sup>${counts[id]}</sup>` : ''}`;
  }).join(' ');
  relicBar.innerHTML = `<span class="fam">${famPart}</span>${relicPart ? '  ·  ' + relicPart : ''}`;
}

/* ---------------- Draft ---------------- */

function relicDesc(r, owned) {
  const parts = [];
  if (r.instantNote) parts.push(r.instantNote);
  if (r.staticDesc) parts.push(r.staticDesc);
  else if (r.stat) {
    const v = r.base * Math.pow(CFG.diminish, owned);
    if (r.mode === 'mul' || r.pct) parts.push(`+${Math.round(v * 100)}% ${r.suffix}`);
    else parts.push(`+${trim(v)} ${r.suffix}`);
  }
  let s = parts.join(' · ');
  if (owned > 0 && r.stat) s += `  ·  stack ${owned + 1}`;
  return s;
}

function rollDraft() {
  const owned = {};
  for (const id of state.relics) owned[id] = (owned[id] || 0) + 1;
  const pool = RELICS.filter(r => !r.req || meta.unlocked[r.req]);
  const picks = [];
  while (picks.length < 3 && pool.length > 0) {
    let tot = 0;
    for (const r of pool) tot += RARITY_WEIGHT[r.rarity];
    let roll = Math.random() * tot, ci = 0;
    for (let i = 0; i < pool.length; i++) { roll -= RARITY_WEIGHT[pool[i].rarity]; if (roll <= 0) { ci = i; break; } }
    picks.push(pool[ci]); pool.splice(ci, 1);
  }
  return picks.map(r => ({ r, owned: owned[r.id] || 0 }));
}

function openDraft(payout) {
  state.phase = 'draft';
  const picks = rollDraft();
  overlay.innerHTML = `
    <div class="modal">
      <h2>⚡ Power Spike — Wave ${state.wave}</h2>
      <div class="sub">+${payout}🪙 income paid · choose a relic</div>
      <div class="cards">
        ${picks.map((p, i) => `
          <button class="card ${p.r.rarity}" data-i="${i}">
            <span class="ico">${p.r.icon}</span>
            <span><span class="nm">${p.r.name}${p.owned > 0 ? ` ×${p.owned}` : ''}</span><br>
              <span class="ds">${relicDesc(p.r, p.owned)}</span></span>
          </button>`).join('')}
      </div>
      <button class="minor" id="skipDraft">Skip (+${CFG.skipDraftGold}🪙)</button>
    </div>`;
  overlay.classList.remove('hidden');
  overlay.querySelectorAll('.card').forEach(btn => btn.addEventListener('click', () => pickRelic(picks[Number(btn.dataset.i)].r)));
  $('skipDraft').addEventListener('click', () => { state.gold += CFG.skipDraftGold; closeDraft(); });
}

function pickRelic(r) {
  const oldFam = Object.assign({}, state.fam);
  state.relics.push(r.id);
  if (r.instant) r.instant(state);
  recomputeMods();
  for (const f in FAMILY)
    for (const step of FAMILY[f].steps)
      if (state.fam[f] === step.at && oldFam[f] < step.at)
        addFloater(COLS / 2, ROWS / 2, `${FAMILY[f].icon} ${FAMILY[f].name} bonus!`, '#f4d03f');
  renderRelicBar();
  closeDraft();
}

function closeDraft() { hideOverlay(); advanceToPrep(); }

/* ---------------- Menu / Workshop / Game over ---------------- */

function showTitle() {
  state.phase = 'menu';
  overlay.innerHTML = `
    <div class="modal">
      <h2>🏰 Greedkeep</h2>
      <div class="sub">income · mazing · roguelite</div>
      <div class="metaRow">🔩 ${meta.cores} cores  ·  🌊 best wave ${meta.best}</div>
      <button class="big" id="btnPlay">▶ Play</button>
      <button class="minor" id="btnShop">🔧 Workshop</button>
    </div>`;
  overlay.classList.remove('hidden');
  $('btnPlay').addEventListener('click', () => newRun());
  $('btnShop').addEventListener('click', () => showWorkshop());
}

function showWorkshop() {
  const towerRows = TOWER_TREE.map(node => {
    const baseUnlocked = !!meta.unlocked[node.base];
    const bt = TOWERS[node.base], vt = TOWERS[node.variant];
    const equipped = meta.equipped[node.base] || node.base;
    let chips;
    if (!baseUnlocked) {
      chips = `<button class="chipBtn buy" data-unlock="${node.base}" ${meta.cores < node.baseCost ? 'disabled' : ''}>Unlock 🔩${node.baseCost}</button>`;
    } else {
      const baseChip = `<button class="chipBtn ${equipped === node.base ? 'on' : ''}" data-equip="${node.base}">${bt.icon} ${bt.name}</button>`;
      const varUnlocked = !!meta.unlocked[node.variant];
      const varChip = varUnlocked
        ? `<button class="chipBtn ${equipped === node.variant ? 'on' : ''}" data-equip="${node.variant}">${vt.icon} ${vt.name}</button>`
        : `<button class="chipBtn buy" data-unlock="${node.variant}" data-of="${node.base}" ${meta.cores < node.varCost ? 'disabled' : ''}>${vt.icon} ${vt.name} 🔩${node.varCost}</button>`;
      chips = baseChip + varChip;
    }
    const tip = baseUnlocked ? TOWERS[equipped].blurb : bt.blurb;
    return `<div class="shopRow"><div class="shopName">${bt.icon} ${bt.fam[0].toUpperCase() + bt.fam.slice(1)}</div>
      <div class="chips">${chips}</div><div class="shopTip">${tip}</div></div>`;
  }).join('');

  const buffRows = BUFFS.map(b => {
    const lvl = meta.buffs[b.id] || 0, maxed = lvl >= b.max, cost = buffCost(b, lvl);
    return `<div class="shopRow"><div class="shopName">${b.icon} ${b.name}</div>
      <div class="chips"><button class="chipBtn buy" data-buff="${b.id}" ${maxed || meta.cores < cost ? 'disabled' : ''}>${maxed ? 'MAX' : `🔩${cost}`}</button></div>
      <div class="shopTip">Lv ${lvl}/${b.max} · +${b.per} ${b.unit} each</div></div>`;
  }).join('');

  overlay.innerHTML = `
    <div class="modal wide">
      <h2>🔧 Workshop</h2>
      <div class="metaRow">🔩 ${meta.cores} cores</div>
      <div class="shopSection">Towers — unlock, then equip a branch</div>
      ${towerRows}
      <div class="shopSection">Permanent upgrades</div>
      ${buffRows}
      <button class="minor" id="wkBack">← Back</button>
    </div>`;
  overlay.classList.remove('hidden');

  overlay.querySelectorAll('[data-unlock]').forEach(b => b.addEventListener('click', () => {
    const id = b.dataset.unlock, node = TOWER_TREE.find(n => n.base === id || n.variant === id);
    const cost = node.base === id ? node.baseCost : node.varCost;
    if (meta.unlocked[id] || meta.cores < cost) return;
    meta.cores -= cost; meta.unlocked[id] = true;
    if (b.dataset.of) meta.equipped[b.dataset.of] = id;       // auto-equip a freshly bought variant
    else if (node.base === id) meta.equipped[id] = id;
    saveMeta(); showWorkshop();
  }));
  overlay.querySelectorAll('[data-equip]').forEach(b => b.addEventListener('click', () => {
    const id = b.dataset.equip, node = TOWER_TREE.find(n => n.base === id || n.variant === id);
    meta.equipped[node.base] = id; saveMeta(); showWorkshop();
  }));
  overlay.querySelectorAll('[data-buff]').forEach(b => b.addEventListener('click', () => {
    const def = BUFFS.find(x => x.id === b.dataset.buff), lvl = meta.buffs[def.id] || 0;
    if (lvl >= def.max || meta.cores < buffCost(def, lvl)) return;
    meta.cores -= buffCost(def, lvl); meta.buffs[def.id] = lvl + 1; saveMeta(); showWorkshop();
  }));
  $('wkBack').addEventListener('click', () => showTitle());
}

function showGameOver() {
  const survived = state.wave;
  let bonus = 0;
  if (survived > meta.best) { bonus = (survived - meta.best) * 3; meta.best = survived; }
  const earned = survived + bonus;
  meta.cores += earned; saveMeta();
  state.best = meta.best;
  overlay.innerHTML = `
    <div class="modal">
      <h2>💀 The keep has fallen</h2>
      <div class="sub">Survived ${survived} wave${survived === 1 ? '' : 's'} · best ${meta.best}</div>
      <div class="metaRow">+${earned} 🔩 cores${bonus ? ` (incl. +${bonus} new-best)` : ''} · ${meta.cores} total</div>
      <button class="big" id="goAgain">⚔️ Run it back</button>
      <button class="minor" id="goShop">🔧 Workshop</button>
    </div>`;
  overlay.classList.remove('hidden');
  $('goAgain').addEventListener('click', () => newRun());
  $('goShop').addEventListener('click', () => showWorkshop());
}

function hideOverlay() { overlay.classList.add('hidden'); overlay.innerHTML = ''; }

/* ---------------- Input ---------------- */

canvas.addEventListener('pointerdown', ev => {
  if (state.phase === 'draft' || state.phase === 'over' || state.phase === 'menu') return;
  const rect = canvas.getBoundingClientRect();
  const x = Math.floor((ev.clientX - rect.left - ox) / ts);
  const y = Math.floor((ev.clientY - rect.top - oy) / ts);
  if (x < 0 || y < 0 || x >= COLS || y >= ROWS) { state.selected = null; state.ghost = null; return; }
  const t = towerAt(x, y);
  if (t) { state.selected = t; state.ghost = null; return; }
  if (state.buildType) {
    if (state.ghost && state.ghost.x === x && state.ghost.y === y) tryBuild(x, y);
    else state.ghost = { x, y, ok: canPlace(x, y) };
    return;
  }
  state.selected = null;
});

btnInvest.addEventListener('click', doInvest);
btnSend.addEventListener('click', doSend);
btnSpeed.addEventListener('click', () => { state.speed = state.speed >= 3 ? 1 : state.speed + 1; });
btnRestart.addEventListener('click', () => { if (state.phase === 'menu') return; if (state.phase === 'over' || confirm('Abandon run and return to menu?')) showTitle(); });
window.addEventListener('resize', fit);

/* ---------------- Main loop ---------------- */

let lastT = performance.now();
function frame(now) {
  let dt = Math.min(0.05, (now - lastT) / 1000);
  lastT = now;
  if (state.phase === 'prep' || state.phase === 'wave') update(dt * state.speed);
  draw();
  syncUI();
  requestAnimationFrame(frame);
}

/* ---------------- Boot ---------------- */

newRun();
showTitle();
fit();
requestAnimationFrame(frame);
