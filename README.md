# Greedkeep 🏰🪙

A prototype mashing up three things we love:

- **Income TD** (StarCraft/WC3 custom games) — every wave pays out income; you can
  *invest* gold to permanently grow it, and sending waves early pays an interest
  bonus. Towers now vs. economy later is the core decision.
- **Mazing TD** — open grid, towers physically block the board, creeps pathfind
  around whatever you build. The maze *is* your defense.
- **Roguelike** — every few waves you hit a power spike and draft 1-of-3 random
  relics (Ravenswatch-style). Endless scaling, run ends at 0 lives, chase your
  best wave.

No build step, no dependencies — pure HTML/Canvas/JS.

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

### Towers

| | Cost | Role |
|---|---|---|
| 🏹 Arrow | 25 | Cheap, fast single-target — maze filler |
| ❄️ Frost | 35 | Slows creeps — multiplies the value of your maze |
| 💣 Cannon | 50 | Splash — answers swarms |
| 🎯 Sniper | 70 | Long range, big hits — answers tanks/bosses |

## Roadmap (rough)

1. **This prototype** — validate that maze + income + draft is fun ✅
2. Balance pass, juice (sounds, hit effects), more relics & creep abilities
3. Meta-progression between runs (unlock towers/relics), seeded runs
4. The real dream: **income wars** — opponents (AI, then PvP) where *you send
   the creeps* at each other, WC3 style
5. Package as a mobile app (PWA → Capacitor) once the loop is proven

## Code map

- `game.js` — everything: config, relics, waves, BFS flow-field pathing,
  combat, economy, draft, rendering, UI
- `index.html` / `style.css` — shell + dark UI
