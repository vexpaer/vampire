'use strict';
// ---------------------------------------------------------------------------
// DOM overlays: title & character select, level-up cards, pause, results,
// banners, boss title card, achievement toasts, settings.
// ---------------------------------------------------------------------------

const UI = {
  el: {}, opts: [], mode: 'level', focus: 0, lockUntil: 0, choosing: false,
  bannerQ: [], bannerBusy: false, selectedChar: 'bellringer', newAch: [],

  init() {
    const $ = id => document.getElementById(id);
    for (const id of ['loading', 'title', 'levelup', 'pause', 'result', 'achievements', 'settings', 'chars', 'char-detail', 'records',
      'cards', 'lu-kicker', 'lu-title', 'btn-reroll', 'banner', 'notice', 'bosscard', 'toasts', 'pause-build', 'pause-stats',
      'result-title', 'result-sub', 'result-stats', 'result-build', 'result-dmg', 'result-unlocks', 'ach-list', 'touch']) this.el[id] = $(id);
    $('btn-start').onclick = () => this.startRun();
    $('btn-ach').onclick = () => this.openPanel('achievements');
    $('btn-settings').onclick = () => this.openPanel('settings');
    $('btn-ach-close').onclick = () => this.closePanel('achievements');
    $('btn-settings-close').onclick = () => this.closePanel('settings');
    $('btn-resume').onclick = () => this.resume();
    $('btn-pause-settings').onclick = () => this.openPanel('settings');
    $('btn-restart').onclick = () => this.restart();
    $('btn-quit').onclick = () => this.toTitle();
    $('btn-again').onclick = () => this.restart();
    $('btn-change').onclick = () => this.toTitle();
    this.el['btn-reroll'].onclick = () => this.reroll();
    // Settings controls
    const s = G.settings;
    const bind = (id, key, fn) => {
      const input = $(id);
      if (input.type === 'checkbox') input.checked = !!s[key]; else input.value = s[key];
      input.oninput = () => { s[key] = input.type === 'checkbox' ? input.checked : parseFloat(input.value); fn && fn(); Progress.save(); };
    };
    const vol = () => Sfx.setVolumes(s.master, s.music, s.sfx);
    bind('set-master', 'master', vol); bind('set-music', 'music', vol); bind('set-sfx', 'sfx', vol);
    bind('set-numbers', 'numbers'); bind('set-shake', 'shake');
    document.querySelectorAll('.btn').forEach(b => b.addEventListener('mouseenter', () => Sfx.play('hover')));
  },

  show(id) { this.el[id].hidden = false; requestAnimationFrame(() => this.el[id].classList.add('in')); this.syncModal(); },
  hide(id) { this.el[id].classList.remove('in'); this.el[id].hidden = true; this.syncModal(); },
  syncModal() {
    const open = ['levelup', 'pause', 'result'].some(id => this.el[id] && !this.el[id].hidden);
    document.body.classList.toggle('modal', open);
  },

  // ---- Title ---------------------------------------------------------------
  showTitle() {
    for (const id of ['levelup', 'pause', 'result', 'achievements', 'settings']) this.hide(id);
    this.hide('loading');
    this.el.touch.hidden = true;
    this.selectedChar = Progress.data.lastChar && Progress.isCharUnlocked(CHARACTERS.find(c => c.id === Progress.data.lastChar)) ? Progress.data.lastChar : 'bellringer';
    this.renderChars();
    this.renderRecords();
    this.show('title');
    G.state = 'title';
  },

  renderChars() {
    const wrap = this.el.chars;
    wrap.innerHTML = '';
    CHARACTERS.forEach((c, i) => {
      const unlocked = Progress.isCharUnlocked(c);
      const b = document.createElement('button');
      b.className = 'char' + (unlocked ? '' : ' locked') + (c.id === this.selectedChar ? ' selected' : '');
      b.setAttribute('aria-label', unlocked ? c.name : 'Locked character');
      b.innerHTML = `<img alt="" src="${spriteURL(c.sprite, 4)}"><span class="char-name">${unlocked ? c.name.replace('The ', '') : '???'}</span><span class="char-key">${i + 1}</span>`;
      b.onclick = () => { if (!unlocked) { Sfx.play('deny'); this.selectedChar = c.id; this.renderChars(); return; } this.selectedChar = c.id; Sfx.play('hover'); this.renderChars(); };
      b.ondblclick = () => { if (unlocked) this.startRun(); };
      wrap.appendChild(b);
    });
    const c = CHARACTERS.find(x => x.id === this.selectedChar);
    const unlocked = Progress.isCharUnlocked(c);
    const w = WEAPONS[c.weapon];
    const ach = ACHIEVEMENTS.find(a => a.id === c.unlock);
    this.el['char-detail'].innerHTML = unlocked
      ? `<h3>${c.name}</h3><p class="blurb">${c.blurb}</p>
         <div class="detail-row"><img alt="" src="${iconURL(w.icon, 3)}"><div><b>${w.name}</b><span>${w.desc[0]}</span></div></div>
         <div class="perk">${c.perk}</div>`
      : `<h3>Locked</h3><p class="blurb">Earn the achievement <b>${ach.name}</b> to unlock: ${ach.desc}</p>`;
    document.getElementById('btn-start').disabled = !unlocked;
  },

  renderRecords() {
    const d = Progress.data;
    const best = d.best.time ? fmtTime(d.best.time) : '—';
    const got = ACHIEVEMENTS.filter(a => d.achievements[a.id]).length;
    this.el.records.innerHTML = `<span>Best vigil <b>${best}</b></span><span>Dawns <b>${d.totals.wins}</b></span><span>Souls silenced <b>${d.totals.kills.toLocaleString()}</b></span><span>Achievements <b>${got}/${ACHIEVEMENTS.length}</b></span>`;
  },

  startRun() {
    const c = CHARACTERS.find(x => x.id === this.selectedChar);
    if (!Progress.isCharUnlocked(c) && !Debug.bot) { Sfx.play('deny'); return; }
    Sfx.init();
    Sfx.setVolumes(G.settings.master, G.settings.music, G.settings.sfx);
    Progress.data.lastChar = c.id; Progress.save();
    this.newAch = [];
    this.bannerQ.length = 0;
    this.hide('title');
    this.el.touch.hidden = !Input.isTouch;
    document.body.classList.add('fade');
    setTimeout(() => document.body.classList.remove('fade'), 600);
    newRun(c.id);
    R.makeFogPatterns();
    Sfx.Music.start('calm');
    Sfx.Music.setIntensity(0);
    Sfx.play('bell');
    UI.banner(PHASES[0].name, PHASES[0].sub, 'bone', 3);
  },

  restart() {
    for (const id of ['pause', 'result', 'settings']) this.hide(id);
    G.resultShown = false;
    this.startRun();
  },

  toTitle() {
    Sfx.resume();
    Sfx.Music.stop();
    G.resultShown = false;
    G.player = null;
    World.generate((Math.random() * 1e9) | 0);
    R.makeFogPatterns();
    Director.mood = 0; Director.moodTarget = 0;
    this.showTitle();
    setTimeout(() => { if (G.state === 'title') Sfx.Music.start('title'); }, 400);
  },

  // ---- Level up -------------------------------------------------------------
  openLevelUp(mode) {
    G.state = 'levelup';
    this.mode = mode;
    if (mode === 'level') G.levelQueue--;
    this.opts = buildOptions(mode);
    this.renderCards();
    this.show('levelup');
    Sfx.play(mode === 'chest' ? 'chest' : 'levelup');
    Sfx.play('cardIn');
  },

  renderCards() {
    const P = G.player;
    const kicker = this.el['lu-kicker'], title = this.el['lu-title'];
    if (this.mode === 'chest') {
      const evo = this.opts[0] && this.opts[0].kind === 'evolution';
      kicker.textContent = 'Reliquary opened';
      title.textContent = evo ? 'An Ascension Awaits' : 'Claim a Relic';
    } else {
      kicker.textContent = 'Level ' + (P.level - G.levelQueue);
      title.textContent = 'Choose a Boon';
    }
    const wrap = this.el.cards;
    wrap.innerHTML = '';
    wrap.className = 'cards' + (this.opts.length === 1 ? ' single' : '');
    this.opts.forEach((o, i) => {
      const d = describeOption(o);
      const b = document.createElement('button');
      b.className = 'card ' + RARITY[d.rarity].cls;
      b.style.setProperty('--i', i);
      const pips = d.maxLv ? `<div class="card-pips">${Array.from({ length: d.maxLv }, (_, k) => `<i class="${k < d.curLv - 1 ? 'on' : k === d.curLv - 1 ? 'next' : ''}"></i>`).join('')}</div>` : '';
      b.innerHTML = `
        <div class="card-top"><span class="card-tag">${d.tag}</span><span class="card-rarity">${d.rarity === 'common' || d.rarity === 'rare' ? RARITY[d.rarity].label : ''}</span></div>
        <div class="card-icon"><img alt="" src="${iconURL(d.icon, 4)}"></div>
        <div class="card-name">${d.name}</div>
        <div class="card-level">${d.level}</div>
        ${pips}
        <p class="card-text">${d.text}</p>
        ${d.sub ? `<div class="card-sub">${d.sub}</div>` : ''}
        <div class="card-chips">${d.chips.map(c => `<span class="chip ${c.cls}">${c.text}</span>`).join('')}</div>
        <span class="card-key">${i + 1}</span>`;
      b.onclick = () => this.choose(i);
      b.onmouseenter = () => { this.setFocus(i); Sfx.play('hover'); };
      wrap.appendChild(b);
    });
    this.focus = 0;
    this.setFocus(0);
    this.lockUntil = performance.now() + 420;
    this.choosing = false;
    const rr = this.el['btn-reroll'];
    rr.hidden = this.mode === 'chest' && this.opts[0] && this.opts[0].kind === 'evolution';
    rr.textContent = `Reroll (${G.rerolls})`;
    rr.disabled = G.rerolls <= 0;
    document.getElementById('lu-hint').innerHTML = this.opts.length === 1
      ? '<kbd>1</kbd> or click to claim'
      : '<kbd>1</kbd><kbd>2</kbd><kbd>3</kbd> or click to choose · <kbd>R</kbd> reroll';
  },

  setFocus(i) {
    this.focus = i;
    [...this.el.cards.children].forEach((c, k) => c.classList.toggle('focus', k === i));
  },

  levelKey(code) {
    if (performance.now() < this.lockUntil || this.choosing) return;
    const n = this.opts.length;
    if (code === 'ArrowLeft' || code === 'KeyA') { this.setFocus((this.focus + n - 1) % n); Sfx.play('hover'); }
    else if (code === 'ArrowRight' || code === 'KeyD') { this.setFocus((this.focus + 1) % n); Sfx.play('hover'); }
    else if (code === 'Enter' || code === 'Space') this.choose(this.focus);
    else if (code === 'KeyR') this.reroll();
    else {
      const m = /^(Digit|Numpad)([1-3])$/.exec(code);
      if (m && +m[2] <= n) this.choose(+m[2] - 1);
    }
  },

  choose(i) {
    if (performance.now() < this.lockUntil || this.choosing) return;
    const o = this.opts[i];
    if (!o) return;
    this.choosing = true;
    applyOption(o);
    Sfx.play('select');
    [...this.el.cards.children].forEach((c, k) => c.classList.add(k === i ? 'chosen' : 'dismissed'));
    setTimeout(() => {
      if (G.levelQueue > 0) { this.mode = 'level'; G.levelQueue--; this.opts = buildOptions('level'); this.renderCards(); Sfx.play('cardIn'); }
      else if (G.pendingChest > 0) { G.pendingChest--; this.mode = 'chest'; this.opts = buildOptions('chest'); this.renderCards(); Sfx.play('chest'); }
      else { this.hide('levelup'); G.state = 'play'; }
    }, 300);
  },

  reroll() {
    if (this.opts.length === 1 && this.opts[0].kind === 'evolution') return;
    if (G.rerolls <= 0 || this.choosing || performance.now() < this.lockUntil - 200) { Sfx.play('deny'); return; }
    G.rerolls--;
    this.opts = buildOptions(this.mode);
    this.renderCards();
    Sfx.play('cardIn');
  },

  // ---- Pause ------------------------------------------------------------------
  pause() {
    if (G.state !== 'play' || G.player.dead || G.victory) return;
    G.state = 'paused';
    this.renderBuild(this.el['pause-build'], true);
    const P = G.player;
    this.el['pause-stats'].innerHTML = [
      ['Time', fmtTime(G.time)], ['Level', P.level], ['Slain', G.stats.kills], ['Damage', Math.round(P.s.might * 100) + '%'],
      ['Cooldown', Math.round((1 - P.s.cdMul) * 100) + '%'], ['Area', Math.round(P.s.area * 100) + '%'], ['Crit', Math.round(P.s.crit * 100) + '%'],
      ['Armor', P.s.armor], ['Speed', Math.round(P.s.speed)], ['Pickup', Math.round(P.s.magnet)],
    ].map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('');
    this.show('pause');
    Sfx.suspend();
  },

  resume() {
    if (G.state !== 'paused') return;
    this.hide('pause'); this.hide('settings');
    G.state = 'play';
    Sfx.resume();
  },

  renderBuild(el, detailed) {
    const P = G.player;
    const item = (icon, name, sub, cls = '') => `<div class="build-item ${cls}" title="${name}"><img alt="" src="${iconURL(icon, 3)}">${detailed ? `<div><b>${name}</b><span>${sub}</span></div>` : ''}</div>`;
    let html = '';
    for (const w of P.weapons) { const d = WEAPONS[w.id]; html += item(d.icon, d.name, d.evolved ? 'Evolved' : 'Level ' + w.lv + ' / ' + d.max, d.evolved ? 'evo' : ''); }
    for (const id of P.passiveOrder) { const d = PASSIVES[id]; html += item(d.icon, d.name, 'Level ' + P.passives[id] + ' · ' + d.text); }
    for (const id of P.covenants) { const d = COVENANTS[id]; html += item(d.icon, d.name, d.text, 'cov'); }
    el.innerHTML = html;
  },

  // ---- Panels -------------------------------------------------------------------
  openPanel(id) {
    if (id === 'achievements') {
      const d = Progress.data;
      this.el['ach-list'].innerHTML = ACHIEVEMENTS.map(a => `
        <div class="ach ${d.achievements[a.id] ? 'got' : ''}">
          <div class="ach-mark">${d.achievements[a.id] ? '✦' : '·'}</div>
          <div><b>${a.name}</b><span>${a.desc}</span>${a.reward ? `<em>${a.reward}</em>` : ''}</div>
        </div>`).join('');
    }
    this.show(id);
  },
  closePanel(id) { this.hide(id); },

  // ---- Results ----------------------------------------------------------------------
  showResult(victory) {
    if (G.resultShown) return;
    G.resultShown = true;
    G.state = 'result';
    this.el.touch.hidden = true;
    Progress.recordRun(victory);
    const P = G.player;
    const el = this.el.result;
    el.classList.toggle('victory', victory);
    this.el['result-title'].textContent = victory ? 'Dawn Breaks' : 'The Bell Falls Silent';
    this.el['result-sub'].textContent = victory
      ? 'The Hollow Archbishop is unmade. The city may finally sleep.'
      : 'You held the vigil for ' + fmtTime(G.time) + '. The moon ' + (G.time > 300 ? 'was swallowed whole.' : 'still wanes.');
    const stats = [
      ['Survived', fmtTime(G.time)], ['Enemies slain', G.stats.kills.toLocaleString()], ['Level reached', P.level],
      ['Elites slain', G.stats.elites], ['Bell rings', G.stats.rings], ['Evolutions', G.stats.evolutions],
    ];
    this.el['result-stats'].innerHTML = stats.map(([k, v]) => `<div><b>${v}</b><span>${k}</span></div>`).join('');
    this.renderBuild(this.el['result-build'], false);
    const names = Object.assign({}, ...Object.entries(WEAPONS).map(([k, w]) => ({ [k]: w.name })), {
      bleed: 'Bleed', burn: 'Burn', bell: 'The Last Bell', crimsonHarvest: 'Crimson Harvest', soulMagnet: 'Soul Nova', glass: 'Glass shards', moonlitStride: 'Moonlit Stride',
    });
    const dmg = Object.entries(G.stats.damageBy).filter(([k]) => names[k]).sort((a, b) => b[1] - a[1]).slice(0, 6);
    const top = dmg.length ? dmg[0][1] : 1;
    this.el['result-dmg'].innerHTML = dmg.map(([k, v]) => `<div class="dmg-row"><span>${names[k]}</span><i style="--w:${(v / top) * 100}%"></i><b>${Math.round(v).toLocaleString()}</b></div>`).join('');
    this.el['result-unlocks'].innerHTML = this.newAch.length
      ? '<h4>New this run</h4>' + this.newAch.map(a => `<div class="unlock"><b>${a.name}</b>${a.reward ? `<span>${a.reward}</span>` : ''}</div>`).join('')
      : '';
    this.show('result');
    setTimeout(() => document.getElementById('btn-again').focus({ preventScroll: true }), 50);
  },

  // ---- Banners and notices ------------------------------------------------------------
  banner(title, sub, style = 'bone', dur = 2.6, small = false) {
    if (small || !title) { this.notice(sub, style, dur); return; }
    this.bannerQ.push({ title, sub, style, dur });
    if (!this.bannerBusy) this.nextBanner();
  },

  nextBanner() {
    const b = this.bannerQ.shift();
    if (!b) { this.bannerBusy = false; return; }
    this.bannerBusy = true;
    const el = this.el.banner;
    el.className = 'banner ' + b.style;
    el.innerHTML = `<div class="b-rule"></div><div class="b-title">${b.title}</div><div class="b-sub">${b.sub || ''}</div><div class="b-rule"></div>`;
    el.hidden = false;
    void el.offsetWidth;
    el.classList.add('in');
    setTimeout(() => {
      el.classList.remove('in');
      el.classList.add('out');
      setTimeout(() => { el.hidden = true; el.classList.remove('out'); this.nextBanner(); }, 450);
    }, b.dur * 1000);
  },

  notice(text, style, dur) {
    const el = this.el.notice;
    el.className = 'notice ' + style;
    el.textContent = text;
    el.hidden = false;
    void el.offsetWidth;
    el.classList.add('in');
    clearTimeout(this.noticeT);
    this.noticeT = setTimeout(() => { el.classList.remove('in'); setTimeout(() => { if (!el.classList.contains('in')) el.hidden = true; }, 400); }, dur * 1000);
  },

  bossTitle(name, sub) {
    const el = this.el.bosscard;
    el.innerHTML = `<div class="bc-bar top"></div><div class="bc-text"><div class="bc-kicker">${sub}</div><div class="bc-name">${name}</div></div><div class="bc-bar bottom"></div>`;
    el.hidden = false;
    void el.offsetWidth;
    el.classList.add('in');
    setTimeout(() => { el.classList.remove('in'); el.classList.add('out'); setTimeout(() => { el.hidden = true; el.classList.remove('out'); }, 700); }, 3000);
  },

  toast(a) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.innerHTML = `<div class="toast-kicker">Achievement</div><b>${a.name}</b><span>${a.reward || a.desc}</span>`;
    this.el.toasts.appendChild(t);
    requestAnimationFrame(() => t.classList.add('in'));
    setTimeout(() => { t.classList.remove('in'); setTimeout(() => t.remove(), 500); }, 3800);
    Sfx.play('achievement');
  },
};
