# The Last Bell

A dark fantasy survivor roguelite for the browser. Hold a seven-minute vigil in a ruined cathedral courtyard beneath a dying moon, build a ridiculous weapon synergy, ring the Last Bell, and face the Hollow Archbishop.

Pure HTML5 Canvas and Web Audio. No build step, no dependencies, no external assets: every sprite is hand-authored pixel art in code and every sound is synthesised at runtime.

## Play

Open `index.html` in a modern browser, or serve the folder:

```
npx http-server -p 8123 .
# then open http://localhost:8123
```

| Key | Action |
| --- | --- |
| WASD / Arrows | Move (8 directions) |
| Shift / K | Dash (brief invulnerability, cooldown) |
| Space / L | Ring the Last Bell when Resonance is full |
| 1 2 3 / ← → Enter | Choose a level-up card |
| R | Reroll cards · restart from the results screen |
| Esc / P | Pause |
| M | Mute |

Touch devices get a virtual stick plus Dash and Bell buttons.

## The run

| Time | Phase | What changes |
| --- | --- | --- |
| 0:00 | Awakening | Husks only. Learn to move, collect shards, pick upgrades. |
| 1:30 | Gathering Darkness | Gloomwing flankers, Choir Acolytes with telegraphed bolts, an encirclement with two gaps. |
| 3:00 | Breaking Point | Grave Hounds that charge after a warning lane, armoured Penitents, the first elite. |
| 5:00 | The Eclipse | The moon is swallowed, the light drops, formations close in from every side. |
| 6:30 | Final Reckoning | The courtyard is silenced and the Hollow Archbishop descends. |

## Systems

- **Weapons (6)**: Bone Daggers, Spectral Scythe, Moonfire Orbs, Gravebreaker, Chain Lightning, Blood Sigil. Each has 5 levels and a distinct rhythm, range and targeting rule. Four weapon slots, four passive slots.
- **Evolutions (6)**: a max-level weapon plus its paired passive evolves at the next reliquary or level-up: Ossuary Tempest, Harvest Moon, Eclipse Halo, Titan's Requiem, Tempest Choir, Crimson Cathedral.
- **Passives (10)** and **Covenants (14)**: one-time, build-defining modifiers such as Crimson Harvest, Storm Conductor, Glass Covenant, Soul Magnet, and five that rewrite the bell.
- **The Last Bell**: enemies drop cyan Echoes that charge Resonance. A full bell releases a shockwave that stuns, pushes back, Exposes elites (+50% damage taken), erases hostile projectiles and silences the Archbishop's toll. Ring it during one of his wind-ups to interrupt the attack and stagger him.
- **Enemies**: Husks, Gloomwings, Choir Acolytes, Grave Hounds, Penitents, the Lantern Thief, and three randomised elites (Grave Warden, Gloom Matriarch, Bone Flayer) that drop reliquaries.
- **The Hollow Archbishop**: telegraphed charges, radial hymns with clear gaps, pillar fields with summons; at half health a second phase adds triple charges, spirals, a chasing procession of pillars and the Bell of Unmaking.
- **Progression**: achievements stored in `localStorage` unlock four more bearers (Gravedigger, Moonwitch, Stormcaller, Penitent) and extra rerolls. The first run already contains everything.

## Project layout

```
index.html         page shell and DOM overlays
css/style.css      UI styling
js/util.js         math, RNG, noise, pools, spatial grid, storage
js/audio.js        procedural sound effects and adaptive music
js/sprites.js      pixel-art sprite and icon maps, baked variants
js/data.js         characters, passives, covenants, enemies, timeline, achievements
js/world.js        arena generation, scenery, collision
js/weapons.js      weapon behaviour and evolutions
js/game.js         simulation: player, enemies, combat, pickups, upgrades
js/director.js     wave director and set pieces
js/boss.js         the Hollow Archbishop
js/render.js       low-res world renderer, light map, HUD
js/ui.js           title, level-up cards, pause, results, banners
js/main.js         input, persistence, main loop, autopilot
tools/playtest.cjs headless autopilot playtest
```

## Automated playtesting

The game ships with an autopilot used for balance passes. With a local server on port 8123:

```
NODE_PATH=$(npm root -g) node tools/playtest.cjs "bot=1&speed=8" playtest-out
```

URL options: `bot=1` autopilot, `speed=N` simulation steps per frame, `pick=random` random upgrade choices, `char=<id>` starting bearer, `start=<seconds>` skip ahead. Autopilot runs never write to your save.

## Credits

Fonts: [Jacquarda Bastarda 9](https://github.com/scfried/soft-type-jacquarda-bastarda) and [Pixelify Sans](https://github.com/eifetx/Pixelify-Sans), both under the SIL Open Font License (see `assets/fonts`). Everything else is original to this project.
