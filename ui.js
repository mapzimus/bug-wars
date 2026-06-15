/* ============================================================================
   Bug Wars — ui.js   (v3 — faction-aware)
   ----------------------------------------------------------------------------
   The onboarding + HUD-chrome layer: start menu, faction picker, difficulty,
   the dynamically-built build/train panel for the chosen faction, the attack
   warning, and a faction-aware tutorial. Only observes state + updates DOM.
   (Panel buttons are built with safe DOM methods, not innerHTML.)
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
    worker: 'gathers resources', soldier: 'tanky · beats skirmishers', fireant: 'fast · venom · anti-air & siege', leafcutter: 'siege · wrecks buildings & walls',
    drone: 'gathers resources', guard: 'tanky frontline', striker: 'fast · venom · anti-air & siege', carpenter: 'siege · wrecks buildings & walls', hornet: 'flyer · raids · ignores walls',
    grub: 'gathers resources', bruiser: 'slow heavy tank', bombardier: 'acid spit · anti-air & siege', ram: 'siege · cracks walls & buildings',
    spiderling: 'gathers resources', hunter: 'agile frontline', spitter: 'venom · anti-air & siege', weaver: 'siege · wrecks buildings & walls', balloonist: 'flyer · drifts over walls',
    barracks: 'makes soldiers / fire ants', workshop: 'makes leafcutters', granary: 'closer drop-off', tower: 'shoots attackers (+ flyers)', wall: 'tough barrier · only siege cracks it',
    brood: 'makes guards / strikers', apiary: 'makes carpenters + hornets',
    den: 'makes bruisers / bombardiers', burrow: 'makes rams',
    nursery: 'makes hunters / spitters', spinnery: 'makes weavers + balloonists',
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
  // Rebuild the build/train buttons for the player's faction (safe DOM, no innerHTML).
  function buildPanel(faction) {
    const F = cfg.FACTIONS[faction]; if (!F) return;
    const br = $('buildRow'), tr = $('trainRow');
    if (br) { br.replaceChildren(rowLabel('Build', '(Mud)')); F.buildMenu.forEach(k => br.append(makeBtn('buildbtn', 'build', k, costStr(cfg.BUILDING_STATS[k].cost)))); }
    if (tr) { tr.replaceChildren(rowLabel('Train')); F.trainMenu.forEach((k, i) => tr.append(makeBtn('trainbtn', 'train', k, costStr(cfg.UNIT_STATS[k].cost), i + 1))); }
  }

  // Faction-aware tutorial (works for ants or bees).
  const pf = () => (BW.state && BW.state.faction) ? BW.state.faction.player : 'ants';
  const STEPS = [
    { text: "Drag a box over your gatherers, then RIGHT-CLICK a Food pile (green) to mine it. Scroll the map with WASD / arrows / screen edges — or click the minimap.",
      done: s => s.units.some(u => u.team === 'player' && u.kind === cfg.FACTIONS[pf()].gatherer && (u.order.type === 'gather' || u.order.type === 'returning')) },
    { text: "You need MUD (brown) to build. With ~120 mud, click your production building below and place it near your base.",
      done: s => s.buildings.some(b => b.team === 'player' && b.kind === cfg.FACTIONS[pf()].producers[0]) },
    { text: "Train fighters from it (number keys). Counters matter — skirmishers shoot down flyers, siege wrecks buildings.",
      done: s => s.units.some(u => u.team === 'player' && u.kind !== cfg.FACTIONS[pf()].gatherer) },
    { text: "Defend with a Tower + Walls, keep your economy running, and RIGHT-CLICK the enemy base to destroy it. A warning shows when they attack!",
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
