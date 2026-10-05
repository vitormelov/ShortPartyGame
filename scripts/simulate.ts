import { FeedDirector } from '../shared/feed';
import type { PlayerInfo, BotDifficulty } from '../shared/types';
import { DEFAULT_CONFIG } from '../shared/types';

const diffs: BotDifficulty[] = ['easy', 'medium', 'hard', 'medium', 'easy', 'medium', 'hard', 'easy'];
const runs = Number(process.argv[2] ?? 5);
for (let run = 0; run < runs; run++) {
  const players: PlayerInfo[] = diffs.map((d, i) => ({ id: i, name: `B${i}`, character: i, isBot: true, difficulty: d }));
  const dir = new FeedDirector(players, DEFAULT_CONFIG, 1000 + run);
  const deathsByGame: Record<string, number> = {};
  let ticks = 0;
  let lastClip = '';
  const clipsByGame: Record<string, number> = {};
  let lastCount = 0;
  while (dir.snapshot().phase !== 'over' && ticks < 60 * 60 * 20) {
    dir.tick(1 / 60);
    const s = dir.snapshot();
    if (s.clip) lastClip = s.clip.defId;
    if (s.clipCount !== lastCount && s.clip) {
      lastCount = s.clipCount;
      clipsByGame[s.clip.defId] = (clipsByGame[s.clip.defId] ?? 0) + 1;
    }
    for (const e of dir.drainEvents()) if (e.type === 'lifeLost') deathsByGame[lastClip] = (deathsByGame[lastClip] ?? 0) + 1;
    ticks++;
  }
  const s = dir.snapshot();
  const flops = s.players.reduce((n, p) => n + p.stats.flops, 0);
  console.log(`run ${run}: ${s.phase} in ${(s.matchTime / 60).toFixed(1)} min, ${s.clipCount} clips, winners=${s.winners.map((w) => diffs[w] + w)}, deaths=${JSON.stringify(deathsByGame)}, flops=${flops}, clips=${JSON.stringify(clipsByGame)}`);
}
