'use strict';
// ---------------------------------------------------------------------------
// Game data: characters, passives, covenants, enemies, timeline, achievements.
// Weapon behaviour lives in weapons.js next to its numbers.
// ---------------------------------------------------------------------------

const ARENA = { w: 2400, h: 2400, pad: 46, top: 392 };

const BASE_STATS = {
  maxHp: 100, speed: 84, armor: 0, regen: 0, magnet: 44, might: 1, cdMul: 1, area: 1, amount: 0,
  duration: 1, projSpeed: 1, crit: 0.05, critMul: 1.75, growth: 1, dashCd: 3.0, dashCharges: 1,
  resGain: 1, bellRadius: 150, bellDmg: 1, bleedMul: 1,
};

const CHARACTERS = [
  {
    id: 'bellringer', name: 'The Bellringer', sprite: 'bellringer', weapon: 'dagger',
    blurb: 'Last keeper of the cathedral bell. Quick hands, quicker feet.',
    perk: 'Resonance charges 20% faster.',
    apply: s => { s.resGain *= 1.2; },
    unlock: null,
  },
  {
    id: 'gravedigger', name: 'The Gravedigger', sprite: 'gravedigger', weapon: 'grave',
    blurb: 'Buried the kingdom one stone at a time. Slow, stubborn, unbreakable.',
    perk: '+30 Max HP, +1 Armor, 8% slower.',
    apply: s => { s.maxHp += 30; s.armor += 1; s.speed *= 0.92; },
    unlock: 'survive3',
  },
  {
    id: 'moonwitch', name: 'The Moonwitch', sprite: 'moonwitch', weapon: 'orbs',
    blurb: 'She stole the last light of the dying moon and keeps it close.',
    perk: '+15% Area, +10% Duration, -15 Max HP.',
    apply: s => { s.area *= 1.15; s.duration *= 1.1; s.maxHp -= 15; },
    unlock: 'elite',
  },
  {
    id: 'stormcaller', name: 'The Stormcaller', sprite: 'stormcaller', weapon: 'chain',
    blurb: 'A choir singer whose hymn turned to thunder.',
    perk: '-8% Cooldowns, +5% Critical chance.',
    apply: s => { s.cdMul *= 0.92; s.crit += 0.05; },
    unlock: 'eclipse',
  },
  {
    id: 'penitent', name: 'The Penitent', sprite: 'penitent', weapon: 'sigil',
    blurb: 'Bleeds for every sin of the fallen city, and makes the dead bleed too.',
    perk: '+0.4 HP/s regeneration, Bleed deals +30% damage.',
    apply: s => { s.regen += 0.4; s.bleedMul *= 1.3; },
    unlock: 'evolve',
  },
];

const PASSIVES = {
  haste: { name: 'Hourglass of Ash', icon: 'haste', max: 4, text: '-8% weapon cooldowns.', apply: (s, lv) => { s.cdMul *= Math.pow(0.92, lv); } },
  area: { name: 'Votive Candle', icon: 'area', max: 4, text: '+10% attack area.', apply: (s, lv) => { s.area *= 1 + 0.1 * lv; } },
  duration: { name: 'Black Censer', icon: 'duration', max: 4, text: '+12% effect duration, +8% projectile speed.', apply: (s, lv) => { s.duration *= 1 + 0.12 * lv; s.projSpeed *= 1 + 0.08 * lv; } },
  armor: { name: 'Iron Reliquary', icon: 'armor', max: 4, text: '+1 Armor, +10 Max HP.', apply: (s, lv) => { s.armor += lv; s.maxHp += 10 * lv; } },
  crit: { name: 'Wraith Lens', icon: 'crit', max: 4, text: '+5% critical chance, +15% critical damage.', apply: (s, lv) => { s.crit += 0.05 * lv; s.critMul += 0.15 * lv; } },
  regen: { name: 'Crimson Vial', icon: 'regen', max: 4, text: '+0.35 HP/s regeneration, +5 Max HP.', apply: (s, lv) => { s.regen += 0.35 * lv; s.maxHp += 5 * lv; } },
  speed: { name: 'Raven Feather', icon: 'speed', max: 4, text: '+8% move speed, -8% dash cooldown.', apply: (s, lv) => { s.speed *= 1 + 0.08 * lv; s.dashCd *= Math.pow(0.92, lv); } },
  magnet: { name: 'Lodestone Rosary', icon: 'magnet', max: 4, text: '+30% pickup range, +5% experience.', apply: (s, lv) => { s.magnet *= 1 + 0.3 * lv; s.growth *= 1 + 0.05 * lv; } },
  might: { name: 'Whetted Fang', icon: 'might', max: 4, text: '+10% damage.', apply: (s, lv) => { s.might *= 1 + 0.1 * lv; } },
  amount: { name: 'Twin Chalice', icon: 'amount', max: 2, text: '+1 projectile, orb, strike or sigil.', apply: (s, lv) => { s.amount += lv; } },
};

// Covenants: one-time, build-defining modifiers. `req` gates them behind the
// pieces they synergise with so they never show up as dead picks.
const COVENANTS = {
  crimsonHarvest: {
    name: 'Crimson Harvest', icon: 'crimsonHarvest', tag: 'Synergy',
    text: 'Bleeding enemies burst when slain, spilling bleed onto everything nearby.',
    req: P => P.hasWeapon('sigil') || P.hasWeapon('crimsonCathedral') || P.covenants.has('serrated') || P.char.id === 'penitent',
    hint: 'Needs a Bleed source',
  },
  serrated: {
    name: 'Serrated Bone', icon: 'serrated', tag: 'Synergy',
    text: 'Daggers, scythes and tombstones make enemies Bleed.',
    req: P => ['dagger', 'ossuary', 'scythe', 'harvestMoon', 'grave', 'titansRequiem'].some(id => P.hasWeapon(id)),
  },
  stormConductor: {
    name: 'Storm Conductor', icon: 'stormConductor', tag: 'Synergy',
    text: 'Lightning Slows its targets. Each strike on an already-slowed enemy leaps one extra time.',
    req: P => P.hasWeapon('chain') || P.hasWeapon('tempestChoir'),
  },
  orbitingDeath: {
    name: 'Orbiting Death', icon: 'orbitingDeath', tag: 'Synergy',
    text: 'Moonfire gains 2 more moons, a 40% wider orbit and 2s longer duration.',
    req: P => P.hasWeapon('orbs') || P.hasWeapon('eclipseHalo'),
  },
  executioner: {
    name: "Executioner's Pact", icon: 'executioner', tag: 'Momentum',
    text: 'Slaying an elite, or every 150th kill, triggers Frenzy: all weapons fire 60% faster for 8s.',
    req: () => true,
  },
  glass: {
    name: 'Glass Covenant', icon: 'glass', tag: 'Risk',
    text: 'Lose 40% Max HP. +20% crit chance, crits deal +100% damage and shatter onto nearby enemies.',
    req: () => true,
  },
  soulMagnet: {
    name: 'Soul Magnet', icon: 'soulMagnet', tag: 'Momentum',
    text: 'Every 60 experience shards you collect release a Soul Nova that scorches the area around you.',
    req: () => true,
  },
  moonlitStride: {
    name: 'Moonlit Stride', icon: 'moonlitStride', tag: 'Mobility',
    text: '+1 dash charge. Dashing leaves a trail of moonfire and scorches enemies you pass through.',
    req: () => true,
  },
  lastRites: {
    name: 'Last Rites', icon: 'lastRites', tag: 'Survival',
    text: 'Once per run, lethal damage instead leaves you at 50% HP and rings the bell for free.',
    req: () => true,
  },
  echoingPeal: {
    name: 'Echoing Peal', icon: 'echoingPeal', tag: 'Bell',
    text: 'The bell tolls twice more after each ring, sending weaker aftershock waves.',
    req: () => true,
  },
  ironRequiem: {
    name: 'Iron Requiem', icon: 'ironRequiem', tag: 'Bell',
    text: 'Knockback becomes damage: the shockwave deals 4x damage and Exposes every enemy it hits.',
    req: () => true,
  },
  funeralCurse: {
    name: 'Funeral Curse', icon: 'funeralCurse', tag: 'Bell',
    text: 'The shockwave Curses enemies for 8s: 35% slower, +35% damage taken, triple Echo drops.',
    req: () => true,
  },
  resonantFury: {
    name: 'Resonant Fury', icon: 'resonantFury', tag: 'Bell',
    text: 'After ringing the bell, weapons fire 50% faster and deal 25% more damage for 7s.',
    req: () => true,
  },
  deepReservoir: {
    name: 'Deep Reservoir', icon: 'deepReservoir', tag: 'Bell',
    text: 'Resonance charges 40% faster. The shockwave reaches 30% further.',
    req: () => true,
  },
};

// Evolutions: weapon at max level + paired passive.
const EVOLUTIONS = {
  dagger: { into: 'ossuary', pair: 'haste' },
  scythe: { into: 'harvestMoon', pair: 'area' },
  orbs: { into: 'eclipseHalo', pair: 'duration' },
  grave: { into: 'titansRequiem', pair: 'armor' },
  chain: { into: 'tempestChoir', pair: 'crit' },
  sigil: { into: 'crimsonCathedral', pair: 'regen' },
};

const ENEMIES = {
  husk: { sprite: 'husk', hp: 8, speed: 34, dmg: 7, r: 5, xp: 1, mass: 1, behavior: 'chase', anim: 5 },
  gloomwing: { sprite: 'gloomwing', hp: 5, speed: 90, dmg: 5, r: 4, xp: 1, mass: 0.5, behavior: 'flank', flying: true, anim: 9 },
  acolyte: { sprite: 'acolyte', hp: 16, speed: 40, dmg: 6, r: 5, xp: 2, mass: 1, behavior: 'ranged', anim: 3 },
  hound: { sprite: 'hound', hp: 22, speed: 50, dmg: 11, r: 6, xp: 2, mass: 1.6, behavior: 'charger', anim: 8 },
  penitent: { sprite: 'penitentEnemy', hp: 68, speed: 26, dmg: 15, r: 7, xp: 4, mass: 4, armor: 2, kbResist: 0.7, behavior: 'chase', anim: 3 },
  thief: { sprite: 'thief', hp: 45, speed: 64, dmg: 0, r: 5, xp: 12, mass: 1, behavior: 'flee', anim: 4, special: 'thief' },
  warden: { sprite: 'warden', hp: 760, speed: 30, dmg: 22, r: 11, xp: 40, mass: 14, kbResist: 0.93, behavior: 'warden', anim: 3, elite: true, title: 'Grave Warden' },
  matriarch: { sprite: 'matriarch', hp: 600, speed: 44, dmg: 18, r: 10, xp: 40, mass: 10, kbResist: 0.9, behavior: 'matriarch', flying: true, anim: 4, elite: true, title: 'Gloom Matriarch' },
  flayer: { sprite: 'flayer', hp: 640, speed: 46, dmg: 20, r: 10, xp: 40, mass: 12, kbResist: 0.92, behavior: 'flayer', anim: 7, elite: true, title: 'Bone Flayer' },
  archbishop: { sprite: 'archbishop', hp: 16000, speed: 40, dmg: 22, r: 15, xp: 0, mass: 999, kbResist: 1, behavior: 'boss', flying: true, anim: 2, boss: true, title: 'The Hollow Archbishop' },
};

const PHASES = [
  { t: 0, name: 'Awakening', sub: 'The bell remembers your hands' },
  { t: 90, name: 'Gathering Darkness', sub: 'The faithful dead return to mass' },
  { t: 180, name: 'Breaking Point', sub: 'Something old stirs beneath the nave' },
  { t: 300, name: 'The Eclipse', sub: 'The moon is swallowed' },
  { t: 390, name: 'Final Reckoning', sub: 'The Archbishop answers the bell' },
];

const SPAWN_KEYS = [
  { t: 0, rate: 1.0, mix: { husk: 1 } },
  { t: 30, rate: 1.6, mix: { husk: 1 } },
  { t: 45, rate: 2.0, mix: { husk: 0.8, gloomwing: 0.2 } },
  { t: 90, rate: 2.6, mix: { husk: 0.6, gloomwing: 0.2, acolyte: 0.2 } },
  { t: 135, rate: 3.3, mix: { husk: 0.52, gloomwing: 0.18, acolyte: 0.15, hound: 0.15 } },
  { t: 180, rate: 4.4, mix: { husk: 0.46, gloomwing: 0.15, acolyte: 0.13, hound: 0.12, penitent: 0.14 } },
  { t: 240, rate: 6.0, mix: { husk: 0.42, gloomwing: 0.18, acolyte: 0.14, hound: 0.12, penitent: 0.14 } },
  { t: 300, rate: 8.5, mix: { husk: 0.4, gloomwing: 0.2, acolyte: 0.12, hound: 0.12, penitent: 0.16 } },
  { t: 360, rate: 11.5, mix: { husk: 0.36, gloomwing: 0.22, acolyte: 0.12, hound: 0.14, penitent: 0.16 } },
  { t: 390, rate: 0, mix: { husk: 1 } },
];

// Authored set pieces layered over the procedural spawn stream.
const EVENTS = [
  { t: 0.6, type: 'pack', kind: 'husk', n: 7 },
  { t: 62, type: 'procession', kind: 'husk', n: 14 },
  { t: 90, type: 'banner', phase: 1 },
  { t: 106, type: 'flock', n: 14 },
  { t: 126, type: 'ring', kind: 'husk', n: 26, r: 190 },
  { t: 150, type: 'thief' },
  { t: 180, type: 'banner', phase: 2 },
  { t: 184, type: 'elite' },
  { t: 222, type: 'pack', kind: 'hound', n: 5 },
  { t: 252, type: 'phalanx', kind: 'penitent', n: 8 },
  { t: 270, type: 'elite' },
  { t: 300, type: 'banner', phase: 3 },
  { t: 316, type: 'thief' },
  { t: 328, type: 'ring', kind: 'husk', n: 34, r: 210, outer: 'penitent', outerN: 10 },
  { t: 344, type: 'elite', escort: true },
  { t: 366, type: 'flock', n: 24, both: true },
  { t: 376, type: 'pack', kind: 'hound', n: 7 },
  { t: 390, type: 'boss' },
];

const ACHIEVEMENTS = [
  { id: 'firstToll', name: 'First Toll', desc: 'Ring the Last Bell.' },
  { id: 'survive3', name: 'Breaking Point', desc: 'Survive 3:00 in a single run.', reward: 'Unlocks the Gravedigger' },
  { id: 'elite', name: "Warden's End", desc: 'Defeat an elite enemy.', reward: 'Unlocks the Moonwitch' },
  { id: 'eclipse', name: 'Eclipse Walker', desc: 'Survive 5:00 in a single run.', reward: 'Unlocks the Stormcaller' },
  { id: 'evolve', name: 'Ascension', desc: 'Evolve a weapon.', reward: 'Unlocks the Penitent' },
  { id: 'win', name: 'Dawnbringer', desc: 'Defeat the Hollow Archbishop.', reward: '+1 reroll in every run' },
  { id: 'twoEvo', name: 'Twin Ascension', desc: 'Evolve two weapons in one run.', reward: '+1 reroll in every run' },
  { id: 'kills1000', name: 'Thousand Silences', desc: 'Defeat 1,000 enemies in one run.' },
  { id: 'interrupt', name: 'Hush', desc: 'Interrupt the Archbishop with the bell.' },
  { id: 'fullChoir', name: 'Full Choir', desc: 'Hold four weapons at once.' },
  { id: 'thief', name: 'Caught Light', desc: 'Catch a Lantern Thief.' },
  { id: 'glassWin', name: 'Glass Saint', desc: 'Win a run under the Glass Covenant.' },
];

const RARITY = {
  common: { label: 'Common', cls: 'r-common' },
  rare: { label: 'Rare', cls: 'r-rare' },
  covenant: { label: 'Covenant', cls: 'r-covenant' },
  evolution: { label: 'Evolution', cls: 'r-evolution' },
  relic: { label: 'Relic', cls: 'r-relic' },
};
