/* Headless smoke + short AI-vs-AI match for Bug Wars v6 */
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');

global.window = global;
global.document = {
  getElementById: () => null,
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener: () => {},
  readyState: 'complete',
};
global.performance = { now: () => Date.now() };

for (const f of ['config.js','world.js','systems.js','ai.js']) {
  eval(fs.readFileSync(path.join(root, f), 'utf8'));
}

function assert(cond, msg) { if (!cond) { console.error('FAIL:', msg); process.exit(1); } }

// --- Derive roles differ ---
const stats = BW.config.UNIT_STATS;
assert(stats.bruiser.move === 3, 'bruiser move 3');
assert(stats.spitter.move === 4, 'spitter move 4');
assert(stats.fireant.atkTiles === 2, 'fireant range 2');
assert(stats.soldier.atkTiles === 1, 'soldier range 1');
assert(stats.soldier.move === 4, 'soldier move 4');
assert(stats.hornet.move === 5, 'hornet move 5');
assert(stats.leafcutter.move === 2, 'siege slow');
assert(stats.balloonist.move === 5, 'balloonist move 5');
console.log('OK roles', Object.fromEntries(Object.keys(stats).map(k => [k, {m:stats[k].move,a:stats[k].atkTiles}])));

// --- Init world ---
BW.world.initWorld('normal', { map: 'skirmish', playerAI: true, faction: 'ants', enemyFaction: 'bees' });
assert(BW.state.upgrades && BW.state.upgrades.player, 'upgrades bag');
const outposts = BW.state.buildings.filter(b => b.kind === 'outpost');
assert(outposts.length >= 2, 'outposts present: ' + outposts.length);
assert(outposts.every(b => b.team == null), 'outposts neutral');
assert(BW.state.res.player.mud === 60, 'scarce mud start');
assert(BW.state.units.filter(u => u.team === 'player').length === 3, '3 starting workers');

// --- Venom is flat dmg ---
const spit = stats.spitter.venom.dmg;
assert(spit === 6, 'venom dmg flat');

// --- Manual combat: capture outpost ---
BW.startMatch();
const post = outposts[0];
const nest = BW.state.buildings.find(b => b.team === 'player' && BW.config.BUILDING_STATS[b.kind].category === 'nest');
// Spawn a soldier next to outpost
const near = BW.world.tileCenter(post.gx + 1, post.gy);
const sol = BW.world.createUnit('soldier', 'player', near.x, near.y);
sol.acted = false;
BW.state.units.push(sol);
let hits = 0;
while (post.team !== 'player' && hits < 80) {
  sol.acted = false;
  const r = BW.systems.actAttack(sol, post);
  assert(r.ok, 'attack outpost ' + r.reason);
  hits++;
  // keep adjacent
  if (Math.abs(sol.gx - post.gx) + Math.abs(sol.gy - post.gy) > 1) {
    sol.gx = post.gx + 1; sol.gy = post.gy;
    const c = BW.world.tileCenter(sol.gx, sol.gy); sol.x = c.x; sol.y = c.y;
  }
}
assert(post.team === 'player', 'captured outpost after ' + hits + ' hits');
assert(post.hp === post.maxHp, 'outpost healed on capture');
console.log('OK outpost capture in', hits, 'hits');

// --- Upgrade ---
BW.state.res.player.honeydew = 100;
BW.state.res.player.food = 100;
BW.state.turn.side = 'player';
const up = BW.tryUpgrade('forage', 'player');
assert(up.ok, 'upgrade forage: ' + up.reason);
assert(BW.state.upgrades.player.forage && BW.state.upgrades.player.harvestMult === 1.3, 'forage applied');
console.log('OK upgrade');

// --- Granary harvest bonus path ---
const w = BW.state.units.find(u => u.team === 'player' && u.kind === 'worker');
assert(!!w, 'worker exists');
const node = BW.state.nodes.find(n => n.resource === 'food' && n.amount > 0);
assert(!!node, 'food node');
// place granary near nest (find valid tile)
BW.state.res.player.mud = 200;
BW.state.turn.side = 'player';
let gok = { ok: false };
for (let a = 0; a < 24 && !gok.ok; a++) {
  const ang = a / 24 * Math.PI * 2;
  const x = nest.x + Math.cos(ang) * 128;
  const y = nest.y + Math.sin(ang) * 96;
  gok = BW.tryBuild('granary', 'player', x, y);
}
assert(gok.ok, 'build granary ' + gok.reason);
assert(BW.systems.effectivePopCap('player') > BW.config.popCap, 'pop cap bump');
console.log('OK granary + pop', BW.systems.effectivePopCap('player'));

// --- Short AI-vs-AI (manual turn stepping, no setTimeout chain) ---
BW.world.initWorld('normal', { map: 'skirmish', playerAI: true, faction: 'spiders', enemyFaction: 'beetles' });
BW.state.phase = 'playing';
BW.systems.beginTurn('player');

function aiAct(team) {
  const q = [];
  BW.ai.takeTurn(team, fn => q.push(fn));
  for (const fn of q) fn();
  BW.removeDead();
}
function flip() {
  const next = BW.state.turn.side === 'player' ? 'enemy' : 'player';
  if (next === 'player') BW.state.turn.number += 1;
  BW.systems.beginTurn(next);
}

let guard = 0;
while (BW.state.phase === 'playing' && guard < 80) {
  aiAct(BW.state.turn.side);
  if (BW.state.phase !== 'playing') break;
  flip();
  guard++;
}
console.log('AI match phase=', BW.state.phase, 'turns=', BW.state.turn.number,
  'P', BW.state.units.filter(u => u.team === 'player').length,
  'E', BW.state.units.filter(u => u.team === 'enemy').length,
  'posts', BW.state.buildings.filter(b => b.kind === 'outpost').map(b => b.team));
assert(BW.state.turn.number > 8 || BW.state.phase !== 'playing', 'match progressed');
assert(BW.state.buildings.some(b => b.kind === 'barracks' || b.kind === 'nursery' || b.kind === 'den' || b.kind === 'brood'),
  'AI built a producer');
console.log('OK AI progression');

// --- Counter preview ---
BW.world.initWorld('normal', { map: 'skirmish', faction: 'ants', enemyFaction: 'bees' });
const a = BW.world.createUnit('soldier', 'player', 100, 100);
const b = BW.world.createUnit('striker', 'enemy', 200, 200);
const dmg = BW.systems.previewDamage(a, b);
const flat = BW.config.UNIT_STATS.soldier.damage;
assert(dmg > flat, 'counter bonus vs skirmisher: ' + dmg + ' > ' + flat);
assert(BW.systems.counterLabel(a, b).includes('1.6'), 'counter label');
console.log('OK counters', dmg, BW.systems.counterLabel(a, b));

console.log('\nALL SMOKE CHECKS PASSED');
