import { ARENA_H, ARENA_W } from '@shared/arena';
import type { PollState } from '@shared/minigames/poll/logic';
import type { PlayerId } from '@shared/types';
import { drawPoll, pollCard } from '../minigames/poll';
import { Stage3D, addLights, stageRenderer, type StageScene } from './stage';

/**
 * ENQUETE in 3D: the poll stays a 2D story sticker, but each card holds the candidate as a live 3D
 * character (the winners jump and spin). The scene has no background, so it pastes over the cards.
 */

const DIST = (ARENA_H / 2) / Math.tan((34 / 2) * (Math.PI / 180));

class Poll3D extends Stage3D implements StageScene<PollState> {
  constructor() {
    super(ARENA_W / 2, ARENA_H / 2);
    addLights(this.scene, '#ffffff', '#5a2a6a', 1.8);
    this.look([0, 0, DIST], [0, 0, 0]);
  }

  draw(ctx: CanvasRenderingContext2D, st: PollState, time: number, localId: PlayerId): void {
    drawPoll(ctx, st, time, localId, false);
    const reveal = st.phase === 'reveal';
    const me = st.voters.find((v) => v.id === localId);
    this.beginChars();
    st.candidates.forEach((c, i) => {
      const [x, y, w] = pollCard(i);
      const winner = reveal && st.winners.includes(c.id);
      const hovered = !reveal && me?.cursor === i;
      const hop = winner ? Math.abs(Math.sin(time * 9)) * 4 : 0;
      this.placeChar(c.id, c.character, 0, 0, time, {
        world: [x + w / 2 - ARENA_W / 2, ARENA_H / 2 - (y + 33) + hop, 0],
        heading: winner ? time * 6 : hovered ? Math.sin(time * 6) * 0.5 : 0,
        speed: hovered ? 40 : 0,
        height: 30,
      });
    });
    this.endChars(-1, time);
    this.present(ctx);
  }

  positions(): Array<[PlayerId, number, number]> {
    return [];
  }
}

export const poll3dRenderer = stageRenderer(() => new Poll3D());
