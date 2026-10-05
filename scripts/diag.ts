import { getMinigameDef } from '../shared/minigames';
import type { BotDifficulty, PlayerInfo, TickInput } from '../shared/types';

// Usage: tsx scripts/diag.ts <minigameId> [clips]
// Plays one minigame with 8 bots in 7s clips (resume between clips) and reports deaths per clip.
const id = process.argv[2];
const clips = Number(process.argv[3] ?? 7);
const diffs: BotDifficulty[] = ['easy', 'medium', 'hard', 'medium', 'easy', 'medium', 'hard', 'easy'];
const players: PlayerInfo[] = diffs.map((d, i) => ({ id: i, name: 'B' + i, character: i, isBot: true, difficulty: d }));
let total = 0;
const byDiff: Record<string, number> = {};
const sfx: Record<string, number> = {};
for (let run = 0; run < 10; run++) {
  const g = getMinigameDef(id).create(players, 100 + run);
  for (let c = 0; c < clips && !g.isFinished(); c++) {
    if (c > 0) g.onResume();
    for (let t = 0; t < 60 * 7; t++) {
      const inputs = new Map<number, TickInput>();
      const prev = new Map<number, boolean>();
      for (const p of players) {
        const i = g.botInput(p.id, p.difficulty);
        inputs.set(p.id, { ...i, pressed: i.action && !prev.get(p.id) });
      }
      g.update(1 / 60, inputs, 0);
      for (const e of g.drainEvents()) {
        if (e.type === 'death') {
          total++;
          byDiff[diffs[e.player]] = (byDiff[diffs[e.player]] ?? 0) + 1;
        }
        if (e.type === 'sfx') sfx[e.name] = (sfx[e.name] ?? 0) + 1;
      }
    }
    g.onSuspend();
  }
}
console.log(`${id}: ${(total / (10 * clips)).toFixed(2)} deaths per 7s clip`, byDiff, sfx);
