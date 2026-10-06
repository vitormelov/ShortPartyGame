import { FeedDirector } from '../shared/feed';
import { MINIGAMES } from '../shared/minigames';
import type { BotDifficulty, PlayerInfo } from '../shared/types';
import { DEFAULT_CONFIG } from '../shared/types';

// Usage: tsx scripts/simulate-minigames.ts [runs] [minigameId]
// Plays the minigames mode (one minigame, elimination) with 8 bots and reports how long it takes.
const diffs: BotDifficulty[] = ['easy', 'medium', 'hard', 'medium', 'easy', 'medium', 'hard', 'easy'];
const runs = Number(process.argv[2] ?? 3);
const only = process.argv[3];
for (const def of MINIGAMES.filter((d) => !only || d.id === only)) {
  const times: string[] = [];
  for (let run = 0; run < runs; run++) {
    const players: PlayerInfo[] = diffs.map((d, i) => ({ id: i, name: `B${i}`, character: i, isBot: true, difficulty: d }));
    const dir = new FeedDirector(players, { ...DEFAULT_CONFIG, mode: 'minigame', onlyGame: def.id }, 2000 + run);
    let ticks = 0;
    while (dir.snapshot().phase !== 'over' && ticks < 60 * 60 * 10) {
      dir.tick(1 / 60);
      dir.drainEvents();
      ticks++;
    }
    const s = dir.snapshot();
    times.push(s.phase === 'over' ? `${Math.round(s.matchTime)}s (r${s.round}, ${s.winners.map((w) => diffs[w][0] + w).join('+')})` : 'NÃO ACABOU');
  }
  console.log(`${def.id.padEnd(9)} ${times.join('  ')}`);
}
