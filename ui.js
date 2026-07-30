/* ============================================================================
   Bug Wars — ui.js   (v5: turn-based)
   ----------------------------------------------------------------------------
   Menu, faction picker, build/train panel, turn banner, tutorial.
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
  };
  const DESC = {
    worker: 'gathers each turn', soldier: 'tanky · beats skirmishers', fireant: 'fast · venom · anti-air', leafcutter: 'siege · wrecks buildings',
    drone: 'gathers each turn', guard: 'tanky frontline', striker: 'fast · venom · anti-air', carpenter: 'siege · wrecks buildings', hornet: 'flyer · ignores walls',
    grub: 'gathers each turn', bruiser: 'slow heavy tank', bombardier: 'acid · anti-air', ram: 'siege · cracks walls',
    spiderling: 'gathers each turn', hunter: 'agile frontline', spitter: 'venom · anti-air', weaver: 'siege · wrecks buildings', balloonist: 'flyer · over walls',
    barracks: 'soldiers / fire ants', workshop: 'leafcutters', granary: 'closer drop-off', tower: 'fires each turn', wall: 'blocks · siege only',
    brood: 'guards / strikers', apiary: 'carpenters + hornets',
    den: 'bruisers / bombardiers', burrow: 'rams',
    nursery: 'hunters / spitters', spinnery: 'weavers + balloonists',
  };
  const ICON = { food: '🍞', mud: '🟫', honeydew: '🍯' };
  const costStr = cost => Object.keys(cost).map(k => ICON[k] + ' ' + cost[k]).join(' ') || '—';

  const span = (cls, text) => { const e = document.createElement('span'); e.className = cls; e.textContent = text; return e; };
  function makeBtn(cls, dataKey, kind, cost, hotkey) {
    const btn = document.createElement('button');
    btn.className = cls; btn.dataset[dataKey] = kind;
    btn.append(span('bk', NAMES[kind] || kind), span('bc', cost));
    if (hotkey != null) btn.append(span('bh', hotkey));
    btn.append(span('bd', DESC[kind] || ''));
    return btn;
  }
  function rowLabel(text, small) {
    const e = span('row-label', text + ' ');
    if (small) { const sm = document.createElement('small'); sm.textContent = small; e.append(sm); }
    return e;
  }
  function buildPanel(faction) {
    const F = cfg.FACTIONS[faction]; if (!F) return;
    const br = $('buildRow'), tr = $('trainRow');
    if (br) { br.replaceChildren(rowLabel('Build', '(Mud)')); F.buildMenu.forEach(k => br.append(makeBtn('buildbtn', 'build', k, costStr(cfg.BUILDING_STATS[k].cost)))); }
    if (tr) { tr.replaceChildren(rowLabel('Train')); F.trainMenu.forEach((k, i) => tr.append(makeBtn('trainbtn', 'train', k, costStr(cfg.UNIT_STATS[k].cost), i + 1))); }
  }

  const pf = () => (BW.state && BW.state.faction) ? BW.state.faction.player : 'ants';
  const STEPS = [
    { text: 'Tap a gatherer (highlighted when ready). Blue tiles are move range — tap a Food pile to send them to harvest. They collect automatically at the start of each of your turns while adjacent.',
      done: s => s.units.some(u => u.team === 'player' && u.kind === cfg.FACTIONS[pf()].gatherer && u.gathering != null) },
    { text: 'Gather Mud, then tap a production building in the panel and place it on an empty tile near your nest.',
      done: s => s.buildings.some(b => b.team === 'player' && b.kind === cfg.FACTIONS[pf()].producers[0]) },
    { text: 'Train fighters from the panel. Each unit acts once per turn — tap them, then tap an enemy in the red highlight to attack. Counters matter.',
      done: s => s.units.some(u => u.team === 'player' && u.kind !== cfg.FACTIONS[pf()].gatherer) },
    { text: 'When you\'re done ordering, tap End Turn. The rival colony moves, then it\'s your turn again. Destroy their nest to win!',
      done: () => false },
  ];
  let stepIdx = 0, lastPhase = 'menu', selectedFaction = 'ants';

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
  }
  function resetTutorial() { stepIdx = 0; }

  function attach() {
    document.querySelectorAll('.facbtn').forEach(b => b.addEventListener('click', () => {
      selectedFaction = b.dataset.faction;
      document.querySelectorAll('.facbtn').forEach(x => x.classList.toggle('selected', x === b));
    }));
    document.querySelectorAll('.diffbtn').forEach(b => b.addEventListener('click', () => BW.startGame(b.dataset.diff, { faction: selectedFaction })));
    document.querySelectorAll('.watchbtn').forEach(b => b.addEventListener('click', () => BW.startGame(b.dataset.diff, { playerAI: true, faction: selectedFaction })));
    document.querySelectorAll('[data-action="menu"]').forEach(b => b.addEventListener('click', () => BW.toMenu()));
    const close = $('tutorialClose'); if (close) close.addEventListener('click', () => { const tc = $('tutorial'); if (tc) tc.style.display = 'none'; });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', attach); else attach();

  BW.ui = { tick, resetTutorial, buildPanel };
})();
