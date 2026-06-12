#!/usr/bin/env node
'use strict';
/* Headless smoke test: stubs the DOM, loads game.js, builds a small maze,
   and simulates many waves to catch runtime errors / softlocks.
   Run: node scripts/smoketest.js */

const fs = require('fs');
const path = require('path');

/* ---- DOM stubs ---- */
function makeEl() {
  const el = {
    innerHTML: '', textContent: '', dataset: {}, style: {},
    children: [], disabled: false,
    classList: { add() {}, remove() {}, toggle() {} },
    addEventListener() {},
    appendChild(c) { this.children.push(c); },
    querySelectorAll() { return []; },
    getBoundingClientRect() { return { left: 0, top: 0 }; },
    clientWidth: 400, clientHeight: 600,
    width: 0, height: 0,
    getContext() {
      return new Proxy({}, {
        get(t, k) { if (!(k in t)) t[k] = () => {}; return t[k]; },
        set(t, k, v) { t[k] = v; return true; },
      });
    },
  };
  return el;
}
const els = new Map();
global.document = {
  getElementById(id) { if (!els.has(id)) els.set(id, makeEl()); return els.get(id); },
  createElement() { return makeEl(); },
};
global.window = { addEventListener() {}, devicePixelRatio: 1 };
global.localStorage = { getItem: () => null, setItem() {} };
global.performance = { now: () => Date.now() };
global.requestAnimationFrame = () => {};
global.confirm = () => true;

/* ---- load game + drive it ---- */
const src = fs.readFileSync(path.join(__dirname, '..', 'game.js'), 'utf8');

const harness = `
;(function runSmokeTest() {
  const assert = (cond, msg) => { if (!cond) throw new Error('ASSERT: ' + msg); };

  // Start a run (boot drops us on the title menu).
  newRun();
  assert(state.phase === 'prep', 'newRun should enter prep, got ' + state.phase);

  // Build a serpentine maze with arrows (only tower unlocked by default)
  state.gold = 100000; // test rig: ignore economy constraints for placement
  let placed = 0;
  state.buildType = 'arrow';
  for (let y = 2; y < ROWS - 2; y += 3) {
    const gapLeft = ((y / 3) | 0) % 2 === 0;
    for (let x = 0; x < COLS; x++) {
      if (gapLeft && x === 0) continue;
      if (!gapLeft && x === COLS - 1) continue;
      if (canPlace(x, y)) { tryBuild(x, y); placed++; }
    }
  }
  assert(placed > 30, 'maze should mostly build, placed=' + placed);
  assert(state.path.length > 40, 'serpentine path should be long, len=' + state.path.length);

  state.gold = 100;
  state.buildType = null;

  // Diminishing returns + family set-bonus: stack 3 copies of 'sharp'.
  state.relics = []; recomputeMods();
  const d0 = state.mods.dmg.arrow;
  pickRelic(RELIC_BY_ID.sharp);
  const d1 = state.mods.dmg.arrow;
  pickRelic(RELIC_BY_ID.sharp);
  const d2 = state.mods.dmg.arrow;
  assert(d1 > d0, 'first sharp must raise arrow dmg');
  const gain1 = d1 / d0 - 1, gain2 = d2 / d1 - 1;
  assert(gain2 < gain1 - 1e-9, '2nd copy must diminish (g1=' + gain1.toFixed(3) + ' g2=' + gain2.toFixed(3) + ')');
  pickRelic(RELIC_BY_ID.overclock); // 3rd offense relic -> crosses family threshold
  assert(state.fam.offense >= 3, 'offense family should be >=3');
  const beforeBonus = state.mods.dmg.all;
  assert(beforeBonus > 1.0001, 'offense set-bonus should boost dmg.all, got ' + beforeBonus);

  // Income recompute: a Dividend raises effective income.
  state.relics = []; recomputeMods();
  const incBefore = state.income;
  pickRelic(RELIC_BY_ID.dividend);
  assert(state.income > incBefore, 'dividend must raise income (' + incBefore + ' -> ' + state.income + ')');

  // Reset relics, then simulate ~16 waves to confirm draft cadence holds.
  state.relics = []; recomputeMods();
  state.lives = 99999; state.gold = 99999;
  const draftWaves = [];
  let drafted = 0, simT = 0;
  const DT = 1 / 30;
  while (state.wave < 16 && state.phase !== 'over' && simT < 6000) {
    if (state.phase === 'prep') doSend();
    if (state.phase === 'draft') {
      drafted++; draftWaves.push(state.wave);
      pickRelic(rollDraft()[0].r);
    }
    if (state.phase === 'wave') update(DT);
    simT += DT;
  }
  assert(simT < 6000, 'simulation must not softlock (timed out)');
  console.log('waves cleared:', state.wave, '| drafts at:', draftWaves.join(','),
              '| income:', state.income, '| relics:', state.relics.length);
  assert(drafted >= 3, 'should have drafted at least 3 times by wave 16, got ' + drafted);
  assert(draftWaves.every(w => w % CFG.draftEvery === 0),
    'every draft must land on a multiple of draftEvery=' + CFG.draftEvery + ', got ' + draftWaves.join(','));

  // Meta unlock flow: buying a tower with cores adds it to the build menu.
  meta.cores = 100;
  assert(!meta.unlocked.cannon, 'cannon should start locked');
  meta.cores -= TOWER_TREE.find(n => n.base === 'cannon').baseCost;
  meta.unlocked.cannon = true; meta.equipped.cannon = 'cannon';
  newRun();
  const types = Array.from(document.getElementById('buildBtns').children).map(b => b.dataset.type);
  assert(types.includes('arrow') && types.includes('cannon'),
    'build menu should include unlocked towers, got ' + types.join(','));

  // Equip a variant branch -> build button reflects it.
  meta.unlocked.cannon_mortar = true; meta.equipped.cannon = 'cannon_mortar';
  newRun();
  const types2 = Array.from(document.getElementById('buildBtns').children).map(b => b.dataset.type);
  assert(types2.includes('cannon_mortar'), 'equipped variant should appear, got ' + types2.join(','));

  // Permanent buff carries into a fresh run.
  meta.buffs.lives = 2;
  newRun();
  assert(state.lives === CFG.startLives + 6, 'lives buff should apply, got ' + state.lives);

  // Economy actions on the live run.
  state.gold = 1000;
  const inc2 = state.income;
  doInvest();
  assert(state.income > inc2, 'invest must raise income');

  // Build, upgrade, then sell a tower on the fresh board.
  state.gold = 1000; state.buildType = 'arrow';
  let bx = -1, by = -1;
  for (let y = 3; y < ROWS - 3 && bx < 0; y++)
    for (let x = 1; x < COLS - 1; x++) { if (canPlace(x, y)) { bx = x; by = y; break; } }
  assert(bx >= 0, 'should find a buildable tile');
  tryBuild(bx, by);
  assert(state.towers.length >= 1, 'tower should be built');
  state.buildType = null;
  state.selected = state.towers[0];
  const lvlBefore = state.selected.lvl;
  doUpgrade();
  assert(state.towers[0].lvl === lvlBefore + 1, 'upgrade must raise level');
  const nTowers = state.towers.length;
  doSell();
  assert(state.towers.length === nTowers - 1, 'sell must remove tower');
  assert(state.path.length > 0, 'path must still exist after sell');

  // ---- Fusion synergies ----
  meta.unlocked.frost = true; meta.unlocked.cannon = true; meta.unlocked.poison = true; meta.unlocked.tesla = true;
  meta.equipped.frost = 'frost'; meta.equipped.cannon = 'cannon'; meta.equipped.poison = 'poison'; meta.equipped.tesla = 'tesla';
  newRun();
  state.gold = 100000; state.relics = []; recomputeMods();

  // A lone tower has no links and no combos.
  state.buildType = 'cannon'; state.ghost = { x: 2, y: 5, ok: true }; tryBuild(2, 5);
  let cannon = towerAt(2, 5);
  assert(state.links === 0, 'single tower => 0 links, got ' + state.links);
  assert(cannon.eff.combos.length === 0, 'lone cannon has no combos');
  const dmgAlone = towerDmg(cannon) * cannon.eff.dmgMul;

  // Place a Frost next to it -> Shatter combo + a fusion link + diversity dmg.
  state.buildType = 'frost'; state.ghost = { x: 3, y: 5, ok: true }; tryBuild(3, 5);
  cannon = towerAt(2, 5);
  assert(state.links === 1, 'adjacent pair => 1 link, got ' + state.links);
  assert(cannon.eff.combos.includes('Shatter'), 'frost+cannon should Shatter, got ' + cannon.eff.combos.join(','));
  assert(cannon.eff.bonusVsSlow > 0, 'Shatter must grant bonusVsSlow');
  assert(cannon.eff.dmgMul > 1.0001, 'diverse neighbor should raise dmgMul, got ' + cannon.eff.dmgMul);
  const dmgFused = towerDmg(cannon) * cannon.eff.dmgMul;
  assert(dmgFused > dmgAlone + 1e-6, 'fused cannon should out-damage lone cannon');

  // Tesla + Poison adjacency -> Plague (chain spreads poison).
  state.buildType = 'tesla';  state.ghost = { x: 6, y: 8, ok: true }; tryBuild(6, 8);
  state.buildType = 'poison'; state.ghost = { x: 7, y: 8, ok: true }; tryBuild(7, 8);
  const tesla = towerAt(6, 8);
  assert(tesla.eff.combos.includes('Plague'), 'tesla+poison should be Plague, got ' + tesla.eff.combos.join(','));
  assert(tesla.eff.chainPoison && tesla.eff.chainPoison.dps > 0, 'Plague must attach chainPoison');

  // Overload relic: damage scales with the board's link count.
  const before = towerDmg(cannon);
  pickRelic(RELIC_BY_ID.overload);
  assert(state.mods.perLink > 0, 'overload should set perLink');
  assert(towerDmg(cannon) > before + 1e-6, 'overload must raise damage via links');

  // Variant combat: poison applies a DoT via a real (eff-bearing) tower.
  state.towers = []; recomputeSynergies();
  state.relics = []; recomputeMods();
  state.gold = 100000; state.buildType = 'poison'; state.ghost = { x: 2, y: 9, ok: true }; tryBuild(2, 9);
  const pTower = towerAt(2, 9);
  assert(pTower && pTower.eff.poison, 'poison tower should carry a poison effect');
  spawnEnemy({ hp: 500, speed: 0, bounty: 1, leak: 1, kind: 'grunt', color: '#fff', r: 0.26 });
  const victim = state.enemies[0];
  fire(pTower, victim);
  const proj = state.projs[state.projs.length - 1];
  proj.x = victim.x; proj.y = victim.y; // force immediate hit next update
  state.phase = 'wave';
  update(1 / 30);
  assert(victim.poisonT > 0 || victim.dead, 'poison should apply a DoT');

  console.log('SMOKE TEST PASSED');
})();
`;

try {
  // eslint-disable-next-line no-eval
  eval(src + harness);
} catch (err) {
  console.error('SMOKE TEST FAILED:', err);
  process.exit(1);
}
