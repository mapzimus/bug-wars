const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
global.window = global;
global.document = { getElementById:()=>null, querySelector:()=>null, querySelectorAll:()=>[], addEventListener:()=>{}, readyState:'complete' };
global.performance = { now: () => Date.now() };
for (const f of ['config.js','world.js','systems.js','ai.js']) eval(fs.readFileSync(path.join(root,f),'utf8'));

function play(f1, f2, diff, maxHalf) {
  BW.world.initWorld(diff, { map: 'skirmish', playerAI: true, faction: f1, enemyFaction: f2 });
  BW.state.phase = 'playing';
  BW.systems.beginTurn('player');
  let half = 0;
  while (BW.state.phase === 'playing' && half < maxHalf) {
    const q = []; BW.ai.takeTurn(BW.state.turn.side, fn => q.push(fn));
    for (const fn of q) fn();
    BW.removeDead();
    if (BW.state.phase !== 'playing') break;
    const next = BW.state.turn.side === 'player' ? 'enemy' : 'player';
    if (next === 'player') BW.state.turn.number += 1;
    BW.systems.beginTurn(next);
    half++;
  }
  const winner = BW.state.phase === 'won' ? f1 : BW.state.phase === 'lost' ? f2 : 'draw';
  return { winner, turns: BW.state.turn.number, phase: BW.state.phase };
}

const factions = ['ants','bees','beetles','spiders'];
const wins = Object.fromEntries(factions.map(f => [f, 0]));
let draws = 0, games = 0;
for (const a of factions) for (const b of factions) {
  if (a === b) continue;
  for (let i = 0; i < 2; i++) {
    const r = play(a, b, 'normal', 200);
    games++;
    if (r.winner === 'draw') draws++; else wins[r.winner]++;
    console.log(a, 'vs', b, '->', r.winner, 't'+r.turns);
  }
}
console.log('\nWins', wins, 'draws', draws, 'games', games);
