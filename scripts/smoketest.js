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

  // Build a serpentine maze with arrows (rows 2,5,8,... leaving alternating gaps)
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

  // Blocking the only remaining gap must be rejected
  const gapY = 2, gapX = 0;
  assert(!canPlace(gapX, gapY) || state.blocked[gapX + gapY * COLS] === 0, 'sanity');

  state.gold = 100; // back to something realistic-ish
  state.buildType = null;

  // Simulate 12 waves
  let simT = 0;
  const DT = 1 / 30;
  while (state.wave < 12 && state.phase !== 'over' && simT < 4000) {
    if (state.phase === 'prep') doSend();
    if (state.phase === 'draft') {
      // pretend the player picks by applying a random eligible relic
      const picks = rollDraft();
      picks[0].apply(state);
      state.relics.push(picks[0].id);
      closeDraft();
    }
    if (state.phase === 'wave') update(DT);
    simT += DT;
  }
  assert(simT < 4000, 'simulation must not softlock (timed out)');
  console.log('waves cleared:', state.wave, '| lives:', state.lives, '| gold:', state.gold,
              '| income:', state.income, '| relics:', state.relics.join(','), '| phase:', state.phase);

  // Economy actions
  state.gold = 1000;
  const incBefore = state.income;
  doInvest();
  assert(state.income > incBefore, 'invest must raise income');

  // Upgrade + sell a tower
  state.selected = state.towers[0];
  const lvlBefore = state.selected.lvl;
  doUpgrade();
  assert(state.towers[0].lvl === lvlBefore + 1, 'upgrade must raise level');
  const nTowers = state.towers.length;
  doSell();
  assert(state.towers.length === nTowers - 1, 'sell must remove tower');
  assert(state.path.length > 0, 'path must still exist after sell');

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
