/* ============================================================================
   Bug Wars — ui.js   (v6: upgrades + doctrines)
   ----------------------------------------------------------------------------
   Menu, faction picker, build/train/upgrade panel, turn banner, tutorial.
   ========================================================================== */

window.BW = window.BW || {};

(function () {
  const $ = id => document.getElementById(id);
  const cfg = BW.config;

  const NAMES = {
    worker: 'Worker', soldier: 'Soldier', fireant: 'Fire Ant', leafcutter: 'Leafcutter',
    drone: 'Drone', guard: 'Guard Bee', striker: 'Striker', carpenter: 'Carpenter', hornet: 'Hornet',
    grub: 'Grub', bruiser: 'Bruiser', bombardier: 'Bombardier', ram: 'Ram Beetle',
    spiderling: 'Spiderling', hunter: 'Hunter', spitter: 'Spitter', weaver: 'Weaver', balloonist: 'Balloonist',
    barracks: 'Barracks', workshop: 'Workshop', granary: 'Granary', tower: 'Tower', wall: 'Wall',
    hive: 'Hive', brood: 'Brood', apiary: 'Apiary',
    mound: 'Mound', den: 'Den', burrow: 'Burrow',
    lair: 'Lair', nursery: 'Nursery', spinnery: 'Spinnery',
    outpost: 'Outpost',
  };
  const DESC = {
    worker: 'move 3 · harvests', soldier: 'move 4 · beats skirmishers · digs nests', fireant: 'move 4 · range 2 · venom · AA', leafcutter: 'move 2 · siege buildings',
    drone: 'move 3 · harvests', guard: 'move 4 · frontline', striker: 'move 4 · range 2 · venom · AA', carpenter: 'move 2 · siege', hornet: 'move 5 · flyer · over walls',
    grub: 'move 3 · harvests', bruiser: 'move 3 · heavy tank', bombardier: 'move 3 · range 2 · AA', ram: 'move 2 · cracks walls',
    spiderling: 'move 3 · harvests', hunter: 'move 4 · agile', spitter: 'move 4 · range 2 · venom', weaver: 'move 2 · siege', balloonist: 'move 5 · flyer',
    barracks: 'soldiers / fire ants', workshop: 'leafcutters', granary: '+40% nearby harvest · +pop', tower: 'fires each turn · prioritizes siege', wall: 'blocks · siege only',
    brood: 'guards / strikers', apiary: 'carpenters + hornets',
    den: 'bruisers / bombardiers', burrow: 'rams',
    nursery: 'hunters / spitters', spinnery: 'weavers + balloonists',
  };
  const ICON = { food: '🍞', mud: '🟫', honeydew: '🍯' };
  const costStr = cost => Object.keys(cost).map(k => ICON[k] + ' ' + cost[k]).join(' ') || '—';

  const span = (cls, text) => { const e = document.createElement('span'); e.className = cls; e.textContent = text; return e; };
  function makeBtn(cls, dataKey, kind, cost, hotkey, desc) {
    const btn = document.createElement('button');
    btn.className = cls; btn.dataset[dataKey] = kind;
    btn.append(span('bk', NAMES[kind] || kind), span('bc', cost));
    if (hotkey != null) btn.append(span('bh', hotkey));
    btn.append(span('bd', desc || DESC[kind] || ''));
    return btn;
  }
  function rowLabel(text, small) {
    const e = span('row-label', text + ' ');
    if (small) { const sm = document.createElement('small'); sm.textContent = small; e.append(sm); }
    return e;
  }
  function buildPanel(faction) {
    const F = cfg.FACTIONS[faction]; if (!F) return;
    const br = $('buildRow'), tr = $('trainRow'), ur = $('upgradeRow');
    if (br) { br.replaceChildren(rowLabel('Build', '(Mud)')); F.buildMenu.forEach(k => br.append(makeBtn('buildbtn', 'build', k, costStr(cfg.BUILDING_STATS[k].cost)))); }
    if (tr) { tr.replaceChildren(rowLabel('Train')); F.trainMenu.forEach((k, i) => tr.append(makeBtn('trainbtn', 'train', k, costStr(cfg.UNIT_STATS[k].cost), i + 1))); }
    if (ur) {
      ur.replaceChildren(rowLabel('Tech', '(Honeydew)'));
      (F.upgradeMenu || []).forEach(k => {
        const up = cfg.UPGRADES[k];
        if (!up) return;
        const btn = document.createElement('button');
        btn.className = 'upgradebtn';
        btn.dataset.upgrade = k;
        btn.append(span('bk', up.name), span('bc', costStr(up.cost)), span('bd', up.desc));
        ur.append(btn);
      });
    }
  }

  function refreshUpgradeState() {
    const ur = $('upgradeRow');
    if (!ur || !BW.state || !BW.state.upgrades) return;
    const bag = BW.state.upgrades.player || {};
    ur.querySelectorAll('.upgradebtn').forEach(btn => {
      const done = !!bag[btn.dataset.upgrade];
      btn.classList.toggle('done', done);
      btn.disabled = done;
    });
  }

  const pf = () => (BW.state && BW.state.faction) ? BW.state.faction.player : 'ants';
  const STEPS = [
    { text: 'Tap a gatherer. Blue tiles = move range. Tap Food/Mud to harvest — they collect at the start of each turn while adjacent. Build a Granary near piles for +40% yield.',
      done: s => s.units.some(u => u.team === 'player' && u.kind === cfg.FACTIONS[pf()].gatherer && u.gathering != null) },
    { text: 'Gather Mud, then place a production building. Capture the green Outposts mid-map (attack until claimed) for income. Contest Honeydew — it does not regen.',
      done: s => s.buildings.some(b => b.team === 'player' && b.kind === cfg.FACTIONS[pf()].producers[0]) },
    { text: 'Train fighters. Skirmishers have range 2; siege is slow but wrecks buildings; flyers ignore walls. Multi-select Army then tap a target to move the group. Counters show on hover (×1.6).',
      done: s => s.units.some(u => u.team === 'player' && u.kind !== cfg.FACTIONS[pf()].gatherer) },
    { text: 'Spend Honeydew on Tech upgrades. Walls + towers defend. End Turn when ready — destroy their nest to win.',
      done: () => false },
  ];
  let stepIdx = 0, lastPhase = 'menu', selectedFaction = 'ants', selectedMap = 'skirmish';

  function tick() {
    const s = BW.state;
    const menu = $('menu'); if (menu) menu.classList.toggle('show', s.phase === 'menu');

    const sb = $('spectateBadge');
    if (sb) sb.classList.toggle('show', !!s.watchMode && s.phase === 'playing');

    const sp = $('selPanel');
    if (sp) sp.style.display = (s.phase === 'playing' && !s.watchMode) ? '' : 'none';

    const endBtn = $('endTurnBtn');
    if (endBtn) {
      const yours = s.phase === 'playing' && !s.watchMode && s.turn && s.turn.side === 'player' && !s.turn.busy;
      endBtn.disabled = !yours;
      endBtn.classList.toggle('ready', yours);
      endBtn.textContent = !s.turn ? 'End Turn'
        : s.turn.busy ? '…'
        : s.turn.side === 'enemy' ? 'Enemy turn'
        : 'End Turn';
    }

    const turnEl = $('turnBanner');
    if (turnEl && s.turn) {
      if (s.phase !== 'playing') turnEl.classList.remove('show');
      else {
        turnEl.classList.add('show');
        const side = s.turn.side === 'player' ? 'Your turn' : 'Enemy turn';
        turnEl.textContent = 'Turn ' + s.turn.number + ' · ' + side;
        turnEl.classList.toggle('enemy', s.turn.side === 'enemy');
      }
    }

    if (s.phase !== lastPhase) {
      if (BW.sound && s.phase === 'won') BW.sound.play('win');
      else if (BW.sound && s.phase === 'lost') BW.sound.play('lose');
      lastPhase = s.phase;
    }

    const wb = $('warnBanner');
    if (wb) wb.classList.toggle('show', !s.watchMode && s.phase === 'playing' && s.alerts.some(a => a.type === 'incoming' && a.until > s.time));

    const tc = $('tutorial');
    if (tc) {
      if (s.phase !== 'playing' || s.watchMode) tc.classList.remove('show');
      else {
        while (stepIdx < STEPS.length - 1 && STEPS[stepIdx].done(s)) stepIdx++;
        const t = $('tutorialText'); if (t) t.textContent = STEPS[stepIdx].text;
        tc.classList.add('show');
      }
    }

    refreshUpgradeState();

    // Faction blurb under menu buttons
    const blurb = $('facBlurb');
    if (blurb && cfg.FACTIONS[selectedFaction]) blurb.textContent = cfg.FACTIONS[selectedFaction].blurb || '';
  }
  function resetTutorial() { stepIdx = 0; }

  function attach() {
    document.querySelectorAll('.facbtn').forEach(b => b.addEventListener('click', () => {
      selectedFaction = b.dataset.faction;
      document.querySelectorAll('.facbtn').forEach(x => x.classList.toggle('selected', x === b));
      const blurb = $('facBlurb');
      if (blurb && cfg.FACTIONS[selectedFaction]) blurb.textContent = cfg.FACTIONS[selectedFaction].blurb || '';
    }));
    document.querySelectorAll('.mapbtn').forEach(b => b.addEventListener('click', () => {
      selectedMap = b.dataset.map;
      document.querySelectorAll('.mapbtn').forEach(x => x.classList.toggle('selected', x === b));
    }));
    document.querySelectorAll('.diffbtn').forEach(b => b.addEventListener('click', () => BW.startGame(b.dataset.diff, { faction: selectedFaction, map: selectedMap })));
    document.querySelectorAll('.watchbtn').forEach(b => b.addEventListener('click', () => BW.startGame(b.dataset.diff, { playerAI: true, faction: selectedFaction, map: selectedMap })));
    document.querySelectorAll('[data-action="menu"]').forEach(b => b.addEventListener('click', () => BW.toMenu()));
    const close = $('tutorialClose'); if (close) close.addEventListener('click', () => { const tc = $('tutorial'); if (tc) tc.style.display = 'none'; });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', attach); else attach();

  BW.ui = { tick, resetTutorial, buildPanel };
})();
