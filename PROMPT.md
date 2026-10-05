# ShortParty — Prompt de Criação

## Visão geral

Crie **ShortParty**, um party game **multiplayer online** para **4 a 8 jogadores**, cada um na sua casa, com **bots** completando as vagas vazias. É no estilo Mario Party, mas construído como uma **sátira aos Reels/Shorts/TikTok**: os jogadores nunca terminam nada. A cada **5–10 segundos** o jogo dá um "swipe" e troca para outro minigame completamente diferente. De tempos em tempos, o feed **volta para um minigame que já foi jogado, exatamente no estado em que foi congelado**. A bomba que estava na sua frente no Bomberman continua lá, e o carro que entrava na curva continua entrando na curva. Quem não lembrou onde estava, morre.

Cada jogador começa com **5 vidas (❤)**. Toda morte, em qualquer minigame, custa uma vida. **Vence o último jogador vivo.**

## Pilares de design

1. **Dopamina rápida:** cada clipe dura pouco e a troca é instantânea e barulhenta.
2. **Estado persistente:** todo minigame é pausável e retomável no frame exato. Nada é resetado ao voltar.
3. **Controles mínimos:** só direcional (4 direções) + 1 botão de ação (`WASD` + `Espaço`, setas + `Enter` como alternativa, ou gamepad). Todo minigame deve ser entendível em 1 segundo.
4. **Sátira visível:** a interface imita um feed de vídeos curtos (swipe vertical, barra de progresso do clipe, botões de curtir/comentar na lateral). As vidas são corações, como curtidas.
5. **Mesma visão para todos:** todos os jogadores veem a cena inteira do minigame (sem câmera por jogador), o que deixa a troca legível na hora e simplifica a rede.

## Fluxo do jogo

1. **Tela título:** logo em pixel art, opções `Criar sala` / `Entrar com código`, campo de apelido.
2. **Lobby (seleção de jogadores):** 8 slots. O anfitrião cria a sala e recebe um **código curto** (ex.: `K7QX`) para mandar aos amigos. Cada jogador escolhe personagem/cor e marca "Pronto". O anfitrião pode adicionar **bots** (Fácil/Médio/Difícil) nos slots vazios e iniciar quando houver pelo menos 4 participantes.
3. **Configuração (anfitrião):** número de vidas (padrão 5), duração do clipe (5–10 s ou aleatório), chance de "retorno" a um minigame anterior.
4. **O Feed:** loop principal.
   - Sorteia o próximo clipe: um minigame novo **ou** um já iniciado, retomado no estado congelado.
   - Transição de swipe (~300 ms) com o nome do minigame grande na tela.
   - Joga por X segundos (barra de progresso no topo, como um story).
   - Congela o estado e volta ao início do loop.
5. **Eliminação e espectador:** quem perde a última vida vira espectador e continua assistindo ao feed (pode mandar emojis/reações).
6. **Resultado final:** pódio com o último sobrevivente e estatísticas engraçadas ("morreu mais vezes em retornos", "durou menos de 1 s depois de um swipe", etc.). Botão de revanche com a mesma sala.

## Vidas e mortes

- Cada morte em qualquer minigame tira **1 vida**.
- Quem morre dentro de um minigame fica fora **daquele minigame** até ele aparecer de novo no feed. Ao reaparecer, renasce num ponto seguro com ~1 s de invencibilidade (pisca). Assim a punição é a vida perdida, e a pessoa continua jogando.
- **Regra do retorno:** ao retomar um minigame, mostra o frame congelado por um instante curto (configurável, padrão ~0,4 s) antes de liberar. Dá tempo do "ah não", não de reagir com calma.
- **Ritmo de fim de jogo:** quando restam poucos jogadores (ex.: 2–3), os clipes ficam mais curtos e a chance de retorno aumenta, para a partida não se arrastar.
- **Velocidade de reprodução (1,25x / 1,5x / 2x):** de vez em quando um clipe roda acelerado, como quando a pessoa assiste a um vídeo em velocidade maior. O clipe dura o mesmo tempo real, então passa mais jogo nele. Aparece um selo "2x ▶▶" no canto, e o card de título avisa. Um retorno também pode voltar acelerado. A chance é configurável (NUNCA / ÀS VEZES / MUITO) e sobe com o calor.
- **"O algoritmo acelerou" (calor):** depois de ~2 min, um nível de calor sobe de 0 a 1 e cada minigame fica mais perigoso (karts mais rápidos, bombas de "anúncio" caindo no Bomb Feed). O calor também sobe quando restam poucos jogadores. Meta: partidas de 3 a 6 minutos.
- Um minigame que "termina" (ex.: corrida completa) sai do pool e é substituído por uma nova instância ou outro minigame.

## Minigames iniciais (MVP)

Todos com direcional + ação, tela única, 4–8 jogadores simultâneos, e com perigos que **continuam ativos no estado congelado** (essa é a graça):

| # | Nome provisório | Inspiração | Resumo | Ação | Como se morre |
|---|---|---|---|---|---|
| 1 | **Kart Rush** | Super Mario Kart | Corrida vista de cima em pista com curvas fechadas e precipícios | Drift / item | Cair da pista |
| 2 | **Bomb Feed** | Bomberman | Arena em grade, bombas com pavio que atravessa as trocas de clipe | Soltar bomba | Explosão |
| 3 | **Hyper Zero** | F-Zero | Corrida de naves ultra-rápida, barreiras laterais drenam energia | Boost (gasta energia) | Energia zerada / colisão |
| 4 | **Slug Squad** | Metal Slug | Arena de tiro lateral, projéteis voando na tela | Atirar (pular com ↑) | Ser atingido |
| 5 | **Shaft Escape** | Metroid | Escalada vertical com lava subindo | Pular | Tocar na lava |
| 6 | **Sumo Scroll** | Mario Party | Empurrar os outros para fora de uma plataforma que encolhe | Investida | Cair da plataforma |

| 7 | **Meteor Feed** | Mario Party | Meteoros caem onde há sombras crescendo; a cratera queima por ~2 s | Dash (empurra os outros) | Impacto / cratera |
| 9 | **Lanterna Feed** | Sweet Home / Clock Tower | Mansão escura; cada um só vê o cone da própria lanterna. Fantasmas vêm do escuro; a luz empurra e queima, mas gasta bateria | Liga/desliga a lanterna | Ser tocado por um fantasma |

| 10 | **Laser Grid** | Mario Party | Emissor central gira feixes de laser rentes ao chão (que às vezes invertem o sentido, com aviso piscando); paredes de laser atravessam a arena com 2-3 buracos | Pular os feixes | Feixe (sem pular) / parede |
| 11 | **Elevador Social** | Metroid / Doodle Jump | Subida vertical pulando entre plataformas (algumas móveis); a tela sobe sozinha e a lava vem junto com a borda de baixo | Pular | Lava |
| 12 | **Laser Beam** | Bullet hell | Feixes vêm de todas as bordas (linha de aviso piscando, depois disparo grosso), rajadas de 4-6 feixes paralelos e tiros rápidos cruzando a tela | Dash | Feixe ou tiro |
| 13 | **Mimic Me** | Shy Guy Says (Mario Party) | Um influencer mostra um comando (↑ ↓ ← →, ESPAÇO ou PARADO; às vezes "CONTRÁRIO!") e todos precisam estar segurando o certo quando o tempo acaba. Dá para ver o que os outros seguram | A própria resposta | Errar o comando (cai na piscina) |
| 14 | **Termos de Uso** | Booksquirm (Mario Party 4) | Páginas gigantes dos "TERMOS DE USO" despencam sobre o chão; cada página tem buracos recortados, e quem não estiver dentro de um quando ela bate é esmagado. Buracos menores e menos tempo a cada página | Empurrão (tira os outros do buraco) | Fora de um buraco quando a página bate |
| 15 | **Bolha Social** | Bumper Balls (Mario Party) | Cada um em cima de uma bola numa plataforma redonda sobre o mar, que encolhe com o tempo. Física com inércia e trombadas | Investida (arrancada que bate mais forte) | Cair da plataforma |
| 16 | **Cancelamento** | Pushy Penguins (Mario Party 4) | Todos numa placa de gelo escorregadia; ondas de pinguins bravos (filas com buracos, colunas, V ou um pinguim solitário bem rápido) atravessam e empurram quem estiver no caminho | Empurrão | Cair na água |

**Já implementados:** Kart Rush, Bomb Feed, Meteor Feed, Lanterna Feed, Laser Grid, Elevador Social, Laser Beam, Mimic Me, Termos de Uso, Bolha Social, Cancelamento. (Snake Royale e Neon Cycle foram testados e removidos.)

Novos minigames serão adicionados depois. A arquitetura deve tornar isso trivial.

### Eventos do feed


- **Notificação:** no meio de um clipe, uma notificação grande ("SEU EX COMEÇOU A TE SEGUIR", "BATERIA EM 1%"...) aparece no centro da tela por 1,5 s e tapa parte da jogada, que continua rodando. Chance padrão: 15% dos clipes.

- **Propagandas (3 tipos):** às vezes, no lugar de um clipe, entra uma propaganda. Elas nunca voltam no feed e sempre rodam em 1x.
  - **PATROCINADO:** contagem "PULAR EM N" (N sorteado entre 1, 2 e 3, com segundos levemente irregulares). Apertar antes da hora tira uma vida ("APRESSADO"); não pular dentro da janela (~1,2 s) também ("ASSISTIU TUDO").
  - **ANÚNCIO:** mostra um código de 3 a 6 movimentos (só WASD) para decorar. Ninguém morre nele.
  - **COMPRA:** tela de "finalizar compra" em que cada um precisa digitar exatamente o código do último ANÚNCIO. Mostra quantos movimentos são, mas não quais. Um movimento errado ou não terminar a tempo custa uma vida; no fim, revela o código.
  - ANÚNCIO e COMPRA sempre se revezam: depois de um ANÚNCIO, a próxima propaganda é obrigatoriamente a COMPRA (mesmo vários clipes depois). Sem ANÚNCIO pendente, a propaganda sorteada é PATROCINADO ou um ANÚNCIO novo (50/50). A frequência é a opção ANÚNCIOS (NUNCA / ÀS VEZES / MUITO).

## Direção de arte e áudio

- **Estilo 16-bit** inspirado em Super Mario Kart e F-Zero (SNES), Metroid/Super Metroid e Metal Slug (Neo Geo): pixel art nítida, paletas saturadas, contornos escuros, sprites pequenos e expressivos.
- Resolução interna fixa (ex.: **384×216**), escalada por inteiro para a janela, sem filtro (nearest-neighbor).
- Cada minigame tem paleta própria e bem distinta, para que a troca seja reconhecida na hora.
- HUD do feed sobreposto: barra de progresso do clipe, ícones laterais de rede social, @nome do minigame e a lista de jogadores com seus ❤ restantes.
- No começo, gráficos gerados por código (placeholders), substituíveis por spritesheets depois.
- Áudio chiptune: cada minigame tem um loop musical próprio. A troca corta a música seca, com um "swoosh" de swipe.

## Multiplayer online

- **Servidor autoritativo:** toda a simulação (todos os minigames, o FeedDirector, as vidas e os bots) roda no servidor. Os clientes só enviam input e desenham o que recebem. Isso evita trapaça e dessincronização, e torna o "estado congelado" trivial: ele vive no servidor.
- **Protocolo:**
  - Cliente → servidor: `PlayerInput { dx, dy, action }` a cada mudança (ou a 60 Hz), com número de sequência.
  - Servidor → clientes: snapshots do clipe atual a ~30 Hz, mais eventos discretos (troca de clipe, morte, perda de vida, eliminação, fim de partida).
- **Suavização no cliente:** interpolação entre snapshots (~100 ms de buffer). Predição local do próprio personagem para os minigames de movimento, com correção suave pelo servidor.
- **Salas:** código de 4 letras, até 8 slots, anfitrião com poderes de config/kick/bots.
- **Desconexão:** se alguém cai, um bot assume o personagem; se a pessoa voltar com o mesmo código/apelido, retoma o controle.
- **Só o clipe ativo é transmitido:** minigames congelados não geram tráfego. Ao retomar um, o servidor manda um snapshot completo dele.

## Bots

- Rodam no servidor e geram o mesmo `PlayerInput` de um humano.
- Cada minigame implementa sua própria IA simples, com três níveis de dificuldade.
- Bots também "esquecem": ao retomar um minigame, têm um atraso de reação parecido com o de um humano distraído, para ser justo e engraçado.

## Arquitetura técnica

- **Stack:**
  - Monorepo TypeScript (`client`, `server`, `shared`).
  - **Cliente:** Vite + HTML5 Canvas 2D, roda no navegador (basta mandar o link para os amigos).
  - **Servidor:** Node.js + WebSocket (`ws`, ou Colyseus para salas e sincronização de estado).
  - **Shared:** tipos, protocolo, constantes e a lógica dos minigames (usada no servidor e na predição do cliente).
  - **Deploy:** cliente na **Vercel** (site estático). O servidor de jogo **não pode ficar na Vercel**, porque as funções serverless dela não mantêm WebSocket aberto nem um loop rodando continuamente. Ele vai para um serviço que roda processo Node contínuo: **Railway** (preferido, deploy pelo GitHub igual à Vercel), Fly.io ou Render.
- **Transporte plugável:** o cliente conversa com a simulação por uma interface `Transport`:
  - `LocalTransport`: a simulação (FeedDirector + minigames + bots) roda **dentro do próprio navegador**, sem servidor. Usado no modo solo (1 humano + bots) e em todo o desenvolvimento inicial.
  - `WebSocketTransport`: conecta ao servidor online.
  Como a simulação vive em `shared`, o mesmo código roda nos dois modos. Ligar o online depois não muda nada nos minigames.
- **Loop do servidor com timestep fixo** (60 ticks/s). Snapshots a 30 Hz.
- **Interface de minigame** (em `shared`):
  ```ts
  interface Minigame {
    id: string;
    name: string;
    init(players: PlayerInfo[], seed: number): void;
    update(dt: number, inputs: Map<PlayerId, PlayerInput>): void;
    onSuspend(): void;                       // congelado (sai do feed)
    onResume(): void;                        // volta ao feed no mesmo estado
    isFinished(): boolean;
    drainEvents(): GameEvent[];              // mortes, etc.
    snapshot(): MinigameSnapshot;            // serializável para rede
    botInput(id: PlayerId, difficulty: BotDifficulty): PlayerInput;
  }

  // no cliente
  interface MinigameRenderer {
    render(ctx: CanvasRenderingContext2D, snap: MinigameSnapshot, alpha: number): void;
  }
  ```
- **FeedDirector** (servidor): sorteia clipe novo vs. retorno, controla o timer, aplica perda de vidas, elimina jogadores e detecta o vencedor.
- **Estrutura sugerida:**
  ```
  shared/   protocol.ts, types.ts, minigames/<nome>/logic.ts
  server/   index.ts, Room.ts, FeedDirector.ts, bots/
  client/   main.ts, net/, core/ (input, audio, renderer, scaler),
            screens/ (título, lobby, resultado), feed/ (HUD, transições),
            minigames/<nome>/render.ts, assets/
  ```

## Roteiro de desenvolvimento

**Fase 1: local, 1 humano + bots (sem servidor)**
1. **Base:** monorepo, canvas escalado, loop fixo, input, `LocalTransport`.
2. **Seleção de jogadores local:** você + 3 a 7 bots, personagem/cor, config.
3. **FeedDirector:** timer, swipe, suspensão/retomada, vidas e HUD. Testado com 2 minigames simples.
4. **Kart Rush + Bomb Feed com bots:** provam o conceito do retorno cruel.
5. **Eliminação, espectador e tela de resultado.**

**Fase 2: online**
6. Servidor Node + WebSocket, `WebSocketTransport`, salas com código, lobby online, interpolação/predição, reconexão.
7. Deploy: cliente na Vercel e servidor no Railway.

**Fase 3: conteúdo e polimento**
8. **Minigames 3–6.**
9. **Polimento:** áudio chiptune, juice (screen shake, partículas, flashes), sprites finais, revanche.
