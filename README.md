# Greedkeep 🏰🪙

A prototype mashing up three things we love:

- **Income TD** (StarCraft/WC3 custom games) — every wave pays out income; you can
  *invest* gold to permanently grow it, and sending waves early pays an interest
  bonus. Towers now vs. economy later is the core decision.
- **Mazing TD** — open grid, towers physically block the board, creeps pathfind
  around whatever you build. The maze *is* your defense.
- **Roguelike** — every 4th wave you hit a power spike and draft 1-of-3 random
  relics (Ravenswatch-style). Endless scaling, run ends at 0 lives.
- **Roguelite meta** — runs earn **cores**; the Workshop spends them to unlock
  towers, equip **variant branches**, and buy permanent buffs. Your first run
  has only the Arrow tower — everything else is earned.

No build step, no dependencies — pure HTML/Canvas/JS.

## Two loops

**In a run** — build a maze, survive waves, draft relics, push for a high wave.
Relics **stack with diminishing returns** per copy, but belong to families
(⚔️ Offense / 💰 Economy / 🧊 Control); collecting 3 / 5 / 7 of a family triggers
a big set-bonus spike, so you choose between spreading wide or committing deep.

**Between runs** — cores (= waves survived, +bonus for a new best) buy:
- **Towers**: Frost, Cannon, Sniper, then Poison (DoT) and Tesla (chain).
- **Variant branches**: each tower has an alt you equip as a loadout choice —
  Arrow→Scattershot, Frost→Glacier, Cannon→Mortar, Sniper→Railgun,
  Poison→Plague, Tesla→Arc Coil.
- **Permanent buffs**: Treasury (+start gold), Trust Fund (+base income),
  Battlements (+lives).

## Play it

**Locally:** open `index.html` in a browser, or run any static server:

```sh
python3 -m http.server 8080
# → http://localhost:8080
```

**On your phone:** the included GitHub Actions workflow deploys to GitHub Pages on
every push. Enable it once in repo **Settings → Pages → Source: GitHub Actions**.

## How to play

| Thing | How |
|---|---|
| Build | Tap a tower button, tap a tile to preview, tap again to confirm |
| Maze | Towers block creeps — the dotted line shows their current path |
| Upgrade / sell | Tap a placed tower |
| Invest 📈 | Spend gold for permanent +income (price rises each time) |
| Send early ▶ | Start the next wave before the timer for bonus gold |
| Draft | Every 4th wave (a ⚡ power spike), pick 1 of 3 relics (or skip for gold) |

Income is paid at the end of **every** wave; the relic draft only triggers on the
⚡ power-spike waves (every 4th). Kills pay small bounties. Leaks cost lives
(bosses cost 5). Boss every 5th wave; creep types rotate
grunt → swarm → fast → tank.

### Towers (unlock in the Workshop; Arrow is free)

| | Role | Variant branch |
|---|---|---|
| 🏹 Arrow | Cheap, fast single-target | 🪶 Scattershot — hits 2 targets |
| ❄️ Frost | Slows creeps | 🧊 Glacier — stronger slow, shorter range |
| 💣 Cannon | Splash, answers swarms | 🎆 Mortar — bigger, slower booms |
| 🎯 Sniper | Long range, big hits | 🛰️ Railgun — huge slow shots w/ cleave |
| ☠️ Poison | Damage-over-time | 🦠 Plague — stronger, longer DoT |
| ⚡ Tesla | Chain lightning | 🌩️ Arc Coil — chains to far more targets |

## Roadmap (rough)

1. Prototype loop — maze + income + draft ✅
2. Roguelite meta — cores, tower/variant unlocks, permanent buffs ✅
3. Balance pass + juice (sounds, hit effects), more relics & creep abilities
4. More variant branches per tower; relic synergies across families
5. The real dream: **income wars** — opponents (AI, then PvP) where *you send
   the creeps* at each other, WC3 style
6. Package as a mobile app (PWA → Capacitor) once the loop is proven

## Code map

- `game.js` — everything: config, relics, waves, BFS flow-field pathing,
  combat, economy, draft, rendering, UI
- `index.html` / `style.css` — shell + dark UI
