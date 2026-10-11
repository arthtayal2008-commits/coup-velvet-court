# Coup · Velvet Court — How the Game Works (UI Design Spec)

Everything here is taken from the code. The live server is `api/api/game.js`, the client is `public/public/app.js`, the styles are in `style.css`, and chat and voice are in `chat.js` and `voice.js`.
Where `README.md` or `engine.js` disagree with the deployed code, **the deployed code wins**, and the difference is flagged.

---

## 0. The five facts that shape the UI

1. **The server owns all state, and clients poll it.** Each client asks for the state every **2 s** while the tab is visible. Nothing is pushed to the client. Other players see your move up to about 2 s late. A single poll can contain **several events at once**, for example an action, three automatic passes and a coin gain. **Animations have to be built from a diff between the old and new state and played from a queue.** Don't play them as instant callbacks.
2. **Each phase has a server deadline** (`phase.deadline`, in epoch ms). Turn: **45 s**. Exchange card picking: **30 s**. All other decisions: **20 s**. When a deadline passes, the server makes the choice automatically. Show a timer for every phase.
3. **You only ever see your own hidden cards.** Other players' hidden cards arrive as `{id:"hidden-<playerId>-<index>", revealed:false}` with no role. Revealed cards are public.
4. **A phase always belongs to someone.** In every phase, a specific person, or a specific set of people, has to act. Everyone else is waiting. The most important job of the UI is to make **"Is it me? What can I do? How long do I have?"** obvious at a glance.
5. **No animations exist yet.** The current CSS has no `@keyframes` and no transitions on the game elements. It only has a `prefers-reduced-motion` rule. Everything in §9 is new design work.

---

## 1. Components and numbers

| Thing | Value |
|---|---|
| Players per game | 2–6 seated. More people can join as spectators: up to 30 people who haven't been removed. |
| Court deck | 15 cards, 3 of each of 5 roles |
| Roles | Duke, Assassin, Captain, Ambassador, Contessa |
| Starting hand | 2 hidden cards ("influence") each |
| Starting coins | 2 each. **In a 2-player game, the starting player gets only 1.** |
| Cards left in the court after the deal | 15 − 2 × players (shown as `state.deckCount`) |
| Treasury | Unlimited and **not shown**. Coins come from it and go back to it. |
| Room code | 6 hex characters, A–F and 0–9, for example `3FA9C1`. URL: `/room/CODE` |
| Player name | 1–20 characters. Must be unique at the table, ignoring case. |
| Room expiry | 24 h with no activity |

### Role cards: art, colour and the one-line text on each card

| Role | Action it allows | Block it allows | Card subtitle in the current UI | Standard colour |
|---|---|---|---|---|
| **Duke** | Tax: +3 coins | Blocks Foreign Aid | "Tax +3 · Blocks aid" | Purple |
| **Assassin** | Assassinate: pay 3, target loses a card | — | "Pay 3 · Lose influence" | Black / grey |
| **Captain** | Steal: take up to 2 coins from a target | Blocks Steal | "Steal 2 · Blocks steal" | Blue |
| **Ambassador** | Exchange: draw 2, keep your count, return the rest | Blocks Steal | "Exchange · Blocks steal" | Green |
| **Contessa** | — | Blocks Assassination | "Blocks assassination" | Red |

The portraits are 5 embedded WebP images (`ART.duke`, and so on). The README says the role colours "follow the standard physical game".

---

## 2. Screens and how players move between them

```
Welcome ──create──▶ Lobby (host) ──Start Game──▶ Game table ──last survivor──▶ Round complete
   │                    ▲                                                        │
   └──join (code)───────┘                                     host: "Start next round · ready check"
                                                                                  ▼
                                                     Ready check ──host: "Deal to ready players"──▶ Game table
```

States that apply to one person only:
- **Spectator.** You joined after the game started, or the lobby already had 6 seats filled. You watch until the next round.
- **Eliminated.** You lost both cards. You stay at the table and watch.
- **Removed.** The host removed you, or you were a spectator who didn't poll for more than 2 minutes. You see the "Your seat is no longer active" screen.

### 2.1 Welcome screen (no seat)
- Fields: **Your name**, max 20 characters. **Room code**, max 6 characters, upper-cased automatically, and pre-filled when the URL is `/room/CODE`.
- Buttons: **Create a table** (primary) and **Join table** (secondary). There is an "or join your friends" divider between them.
- Errors appear inline under the form (`#enter-error`):
  - "Choose a name between 1 and 20 characters."
  - "Enter a valid six-character room code."
  - "Room not found or expired."
  - "That name is already at the table."
  - "Room spectator queue is full."
  - "Someone joined at the same time. Please try again."
  - Rate limit: "Too many room requests. Wait a few minutes."
- Your seat token is saved in `localStorage` under the key `coup-seat-<CODE>`. Rejoining in the **same browser** takes you back to your seat automatically. A different browser means a new seat.
- **Account / leaderboard panel** sits under the main area and is visible only when you are not at a table. It has Log in and Sign up. Usernames are 3–20 characters (`a-z0-9_`). Passwords are 8–128 characters. There is no password recovery. The leaderboard shows the top 50 by points.
  ⚠️ No code anywhere awards points or wins (`coup_results` is never written). **The leaderboard will always be empty.** Design for that empty state, or ask the developers to wire up scoring.

### 2.2 Lobby
- Header: room tag **ROOM ABC123** and **Copy invite ↗**, which copies `origin/room/CODE`. Toast: "Invite link copied."
- List of players: avatar initial, name, DM button ✉, and a label:
  - Host → "Host"
  - Spectator → "Spectating · queued"
  - You → "You"
  - Everyone else → "Ready". ⚠️ This is misleading: the lobby has no ready concept.
- Counter: "N / 6 players".
- Host sees **Start Game**. It is disabled until there are at least 2 players. Everyone else sees "Waiting for the host to deal."
- Note text: "The previous winner starts the next round. 45s turns. 30s Ambassador selection. 20s other decisions. AFK choices resolve automatically."
- Host can click any other player's name to reveal **Remove player**. A confirmation dialog follows ("Their seat will be removed from the lobby.").

### 2.3 Game table (main screen)
The desktop layout (≥1270 px) has two columns:

**Left: the table stage (930 × 745 px canvas)**
- **Felt table:** an oval at left 240, top 220, 460 × 300. Green radial gradient, brass border.
- **Court centre:** sits on the felt, at left 255, top 245, width 430. From top to bottom:
  1. The **countdown** (`Ns`). It turns urgent at **≤ 10 s**.
  2. The eyebrow "VELVET COURT".
  3. The **court deck**: two face-down card backs.
  4. "N cards in court".
  5. The current action: "Actor → Target", then "<Action> · in progress / · resolved". Before any action: "<Name>'s turn".
- **Opponent seats:** placed around the top and sides by opponent count (positions are top-left in px):

| Opponents | seat-0 | seat-1 | seat-2 | seat-3 | seat-4 |
|---|---|---|---|---|---|
| 1 | 375,25 | | | | |
| 2 | 265,25 | 485,25 | | | |
| 3 | 35,280 (left) | 375,25 | 715,280 (right) | | |
| 4 | 35,280 | 265,25 | 485,25 | 715,280 | |
| 5 | 35,280 | 135,25 | 360,25 | 585,25 | 715,280 |

  Opponents are seated **in seat order, skipping you**. The array order is the turn order, so play goes left → across the top → right.
- **Each opponent seat** shows: name, "N coins", a DM ✉ button with an unread badge, 2 mini cards (44 × 61; a back "✧" or the revealed portrait in greyscale with the role name under it), and a status line. Possible status lines:
  - "Taking a turn"
  - "Decision needed" (this player owns the current phase)
  - "N influence"
  - "Eliminated" (the seat is drawn at 62 % opacity)
  - "Removed"
  - "Winner" / "Lost this round"
  - "Ready for next round" / "Waiting for Ready"

  The **active-turn** seat gets a gold border. The voice **speaking** seat gets the `voice-speaking` class.
- **Your seat:** bottom centre, at left 320, top 535, 300 × 190. It shows your name, "You", your coins, your **2 face-up cards** (58 × 80 portraits with the role name; revealed ones in greyscale), a status line ("Your turn" / "Your decision" / "Watching the table" / "Eliminated · spectating" / "Winner" / "Round complete") and the voice controls.
  - Spectators see the **first seated player's** seat here instead, with that player's cards face-down.

**Right: the move panel**
1. **Live thread:** "THIS TURN · LIVE" or "LAST TURN · RESOLVED". It has a headline such as "Ana steals up to 2 from Ben", then a list of every event in that turn. Private timeout notices show here prefixed with "**Only you:**".
2. **Decision panel:** what you can do now. All its states are covered in §4.
3. **Spectator queue** (if anyone is queued): "WATCHING · NEXT ROUND QUEUE (n)".
4. **Table history:** a collapsible `<details>` block holding the last 50 turns, newest first, each as "Turn N · summary" with its events.

Footer: connection status ("Connected" / "Reconnecting…") and "Round N · Base Coup".

Below 1270 px the stage stops using absolute positioning. Opponents come first, then the court, then your seat, then the panel in a single column. Action buttons become a 2-column grid, with Coup spanning the full width.

### 2.4 Global UI (always present)
- **Top bar:** "coup." logo (links home), room label, **How to play** (opens the rules dialog), and an audio control ("Sound on/off" toggle plus a 0–0.5 volume slider).
- **Voice bar** (LiveKit): "Room voice" with **Join voice** (joins with the mic **off**), **Mic on/off**, **Leave voice** and **Enable audio**. It lists participants with a speaking dot and a per-person Mute button. During a game these controls move into your seat. While anyone speaks, the music is ducked to 20 %.
- **Messages widget** (bottom-right floating button): private 1:1 DMs. "Messages" shows an unread badge. The panel has a people list (Online / Unavailable · n unread), then a thread, then a textarea of up to 1000 characters and a Send button. Messages are **live only**: they are lost on refresh and can't be sent to someone who is offline ("They are offline. Messages are delivered live only.").
- **Toast** (`#notice`, aria-live): shows for 6 s. It's used for errors and system messages.

---

## 3. The turn engine: every phase

`state.phase.type` is one of the following:

| Phase | Who acts | Who waits | Timer | Auto-choice on timeout |
|---|---|---|---|---|
| `turn` | Current player (`players[turn]`) | Everyone else | 45 s | **Income**. At 10+ coins: **Coup against a random living opponent**. |
| `challenge` | All living players **except the actor** (`eligible`) | Actor | 20 s | Everyone who hasn't answered **passes** (accepts) |
| `block` | Foreign Aid: **all living players except the actor**. Steal / Assassinate: **only the target** | Actor and the rest | 20 s | Pass (allow) |
| `blockChallenge` | All living players **except the blocker** (the actor is included) | Blocker | 20 s | Pass (accept the block) |
| `prove` | The challenged claimant (`player`) | Everyone else | 20 s | **Proves automatically** if they hold the role. Otherwise **concedes**. |
| `lose` | The player losing a card (`player`) | Everyone else | 20 s | A **random** hidden card is revealed |
| `exchange` | The Ambassador player | Everyone else | 30 s | **Keeps their original cards** |

How the response windows resolve:
- **Challenge** is "first click wins". The moment one eligible player clicks Challenge, the window closes and the game moves to `prove`. Other players don't get to respond.
- **Block** is also immediate. The first block goes straight to `blockChallenge`.
- **Pass** only moves the game on once **every** eligible player has passed. The UI shows "Waiting for A, B, C to respond." and should cross names off as they pass. `phase.passed` lists who has passed.
- If nobody is eligible (for example, the only possible blocker just died), the window is skipped.

### 3.1 The full flow of an action

```
TURN ──player picks action (cost paid immediately)──▶
  │
  ├─ Income / Coup ............................................▶ EXECUTE
  ├─ Foreign Aid ─────────────────────────▶ BLOCK window (anyone, Duke)
  ├─ Tax / Exchange ──▶ CHALLENGE window ─────────────────────▶ EXECUTE
  └─ Steal / Assassinate ──▶ CHALLENGE window ──▶ BLOCK window (target only) ──▶ EXECUTE

CHALLENGE window
  all pass ─────────────────────────────▶ next step (BLOCK or EXECUTE)
  someone challenges ──▶ PROVE (actor)
        actor proves ──▶ challenger LOSES a card ──▶ continue (BLOCK or EXECUTE)
        actor concedes ──▶ actor LOSES a card ──▶ action FAILS, cost REFUNDED ──▶ next turn

BLOCK window
  all pass ──▶ EXECUTE
  someone blocks (claims role) ──▶ BLOCK-CHALLENGE window

BLOCK-CHALLENGE window
  all pass ──▶ "The action was blocked." ──▶ next turn (cost NOT refunded)
  someone challenges ──▶ PROVE (blocker)
        blocker proves ──▶ challenger LOSES a card ──▶ blocked ──▶ next turn
        blocker concedes ──▶ blocker LOSES a card ──▶ EXECUTE the original action

EXECUTE
  Income +1 · Aid +2 · Tax +3 · Steal min(2, target coins)
  Exchange ──▶ EXCHANGE phase ──▶ next turn
  Coup / Assassinate ──▶ target LOSES a card ──▶ next turn
```

**Next turn** passes to the next living player in seat order. When only one living player is left, they win immediately and `status = 'finished'`.

### 3.2 Action catalogue (what the action buttons show)

| Key | Button title | Amount label | Sub-label | Cost | Claims | Target? | Can be blocked by | Can be challenged? |
|---|---|---|---|---|---|---|---|---|
| `income` | Income | +1 | — | 0 | — | No | — | No |
| `aid` | Foreign aid | +2 | Duke can block | 0 | — | No | Duke (**any** opponent) | Only the Duke block |
| `tax` | Duke: take 3 | +3 | — | 0 | Duke | No | — | Yes |
| `exchange` | Ambassador: exchange | Draw 2 | — | 0 | Ambassador | No | — | Yes |
| `steal` | Captain: steal 2 | Up to 2 | — | 0 | Captain | Yes | Captain or Ambassador (**target only**) | Yes, and so is the block |
| `assassinate` | Assassinate | Pay 3 | Claim Assassin | **3** | Assassin | Yes | Contessa (**target only**) | Yes, and so is the block |
| `coup` | Coup | Pay 7 | Cannot be blocked | **7** | — | Yes | — | No |

When each action is enabled (**your turn only**):
- **At 10 or more coins, only Coup is enabled.** The panel says "10 coins. You must launch a Coup."
- Coup is disabled below 7 coins. Assassinate is disabled below 3.
- **Every role action is always enabled.** You can claim any role whether you hold it or not. Bluffing is the core of the game, so **don't** grey out or warn on actions whose card you lack. You *could* add a subtle "you hold this" marker for honest plays.
- While a move is being sent (`busy`), everything is disabled and the panel shows "Sending move…".

Choosing a target (Steal, Assassinate, Coup):
- Clicking one of these switches the panel to "**Choose your target.**". It shows one button per **living** opponent: "Name · ◉ coins · N influence". There is also a **Cancel** button.
- Nothing is sent until you pick a target, and the cost is only paid at that point.
- 💡 *Design suggestion:* let players pick the target by clicking the opponent's seat on the table, with the seats glowing as valid targets. Keep the list as a fallback for accessibility and mobile.

---

## 4. Decision panel: every state you need to design

Checked in this order:

| # | Condition | Eyebrow | Headline | Body / controls |
|---|---|---|---|---|
| 1 | Ready check open | NEXT ROUND STARTING | Ready to play? | **Ready · play next round**, which becomes "You are ready ✓" (disabled). "N ready · up to 6 will be dealt in." Host also gets **Deal to ready players** (needs ≥ 2 ready) and the roster with **Move to queue** / **Give seat** buttons. |
| 2 | You were removed | — | Your queue spot is no longer active. | Link: **Join another table** |
| 3 | You are a spectator | SPECTATING · NEXT ROUND | You're spectating. | "…you'll be dealt in next round." or "…queued for the next available seat. The table seats 6." |
| 4 | Round finished | ROUND COMPLETE | You won. / You lost this round. | "**X** is the last player with influence." Host: **Start next round · ready check**. Others: "Waiting for the host to start a rematch." Everyone: **Create or join another table**. |
| 5 | You are eliminated | ELIMINATED · SPECTATING | You are out this round. | Link to another table |
| 6 | Picking a target | ACTION NAME | Choose your target. | Target buttons and Cancel |
| 7 | `turn`, and it's you | YOUR TURN | Make your move. | The 7 action buttons |
| 8 | `turn`, someone else | AT THE TABLE | X's turn. | — |
| 9 | `challenge` and you're eligible | YOUR RESPONSE · CHALLENGE WINDOW | "X claims Duke." | **Challenge** (danger) and **Accept claim** (primary) |
| 10 | `block` and you're eligible | YOUR RESPONSE · COUNTERACTION | "X chose foreign aid." | **Block · Duke** / **Block · Captain** + **Block · Ambassador** / **Block · Contessa**, and **Allow action** |
| 11 | `blockChallenge` and you're eligible | YOUR RESPONSE · ACTION BLOCKED | "Y claims Contessa." | **Challenge** and **Accept claim** |
| 12 | Any window, not eligible or already passed | (no "YOUR RESPONSE") | same as above | "Waiting for A, B to respond." |
| 13 | `prove`, and it's you | YOUR DECISION · YOU WERE CHALLENGED | "C challenged you." | "Prove Duke with a hidden card, or concede and lose influence." Shows **only your hidden cards of that role** as clickable cards. **Concede challenge** (danger). If you don't hold the role, only Concede appears. |
| 14 | `prove`, someone else | CLAIM CHALLENGED | "C challenged X." | "Waiting for X to prove Duke or concede." |
| 15 | `lose`, and it's you | YOUR DECISION · REVEAL A CARD | Cause line (see below) | "Choose a card to reveal. A revealed card no longer gives influence." Your hidden cards are clickable, and one click sends the choice. |
| 16 | `lose`, someone else | LOSE INFLUENCE | Cause line | — |
| 17 | `exchange`, and it's you | YOUR DECISION · KEEP CARDS | Keep N card(s). | Grid of **your hidden cards plus 2 drawn cards** (3 or 4 cards). Click to toggle (label "Choose" / "Selected", gold outline). **Keep selected cards** is enabled only when exactly N are selected. |
| 18 | `exchange`, someone else | COURT EXCHANGE | X is exchanging. | — (the cards are hidden from you) |

The cause lines for the lose phase (`phase.reason.kind`):
- `failedChallenge`: "Your challenge failed - lose a card." / "X's challenge failed - they must lose a card."
- `conceded`: "X conceded their Duke claim after Y challenged it - lose a card."
- `assassinate`: "You were assassinated by Y - lose a card."
- `coup`: "X was couped by Y - lose a card."

---

## 5. Rules worth showing in the UI

1. **Costs are paid when you declare.** Assassinate (3) and Coup (7) coins leave your pile *before* any response. Animate the coins moving at that moment.
2. **Refunds:** a successfully challenged action (the actor **concedes**) refunds its cost. A **blocked** assassination does **not** refund the 3 coins.
3. **Proving a claim** means showing the card. It is then shuffled into the court and you **draw a replacement**. Technically, the card keeps its `id` and its `role` changes. Your hand looks the same size, but that card is now a different role. **Animate this clearly** or players will be confused (see §9, "Prove & replace").
4. **Double loss with Assassinate.** If the target challenges the Assassin and loses, they lose 1 card for the failed challenge **and** 1 for the assassination. If the target falsely claims Contessa and gets caught, the same happens. A 2-card player can be knocked out in one turn. Make both losses readable, one after the other.
5. **Steal takes `min(2, target.coins)`.** It can take 1 or 0. The log says "stole N coin(s)".
6. When a player is eliminated, their remaining coins go back to the treasury (set to 0 at the end of the turn).
7. **The actor can die during their own action.** For example, they concede a challenge on their last card. The action is cancelled.
8. Players eliminated mid-window are skipped. If the target is already dead when the action executes, nothing more happens.
9. **Exchange:** you see all your hidden cards plus 2 from the court, and you keep exactly as many as you had hidden (1 or 2). The rest go back and are shuffled. Revealed cards are never part of an exchange.
10. **The 10+ coin rule** is checked whenever an action is chosen.
11. **Round start:** the previous winner goes first. In the first round, the first seated player (normally the host) goes first.

---

## 6. Rematch, ready check and queue (between rounds)

1. The round ends. Everyone sees ROUND COMPLETE. Seats show "Winner" or "Lost this round".
2. The host clicks **Start next round · ready check**. This opens `state.readyCheck`, and the host is automatically ready.
   Everyone else gets the toast "Next round starting - click Ready to play." plus a two-note chime.
3. Seated players **and spectators** click **Ready**.
4. The host can **Move to queue** any seated player, or **Give seat** to a *ready* spectator if fewer than 6 are seated.
5. The host clicks **Deal to ready players**. This needs at least 2 ready. Up to 6 ready players are dealt in, seated players first and then the queue in order. Anyone not dealt becomes a spectator.
6. Players removed by the host are dropped. Spectators who haven't polled for **more than 2 minutes** are removed automatically.

---

## 7. Host controls

- The host clicks a player's name, which toggles a **Remove player** button.
- Confirmation dialog: "Remove X?" — *in game:* "They will be eliminated. An interrupted action is cancelled and its paid cost returned." with **Cancel** and **Remove player** (danger).
- In game, the removed player's cards are all revealed and their coins set to 0. If they were part of the current action or decision, the action is cancelled, its cost refunded, and play moves to the next turn. Otherwise, any response window simply continues without them.
- The removed player sees: "Your seat is no longer active. The host may have removed you…" with **Return home**.

---

## 8. Every event the server logs (animation triggers)

The log keeps the last 100 entries. `currentThread.events` holds the current turn's entries. **The client finds new events by comparing the log before and after each poll.**

| Log text pattern | Meaning |
|---|---|
| `Round N started.` | Deal |
| `X chose income.` / `aid` / `coup against Y.` | Action declared, no claim |
| `X chose tax (claims Duke).` / `exchange (claims Ambassador).` / `steal (claims Captain) against Y.` / `assassinate (claims Assassin) against Y.` | Action declared with a claim |
| `X challenges Duke.` | Challenge |
| `X proved Duke, then drew a replacement. Y loses the challenge.` | Proof succeeded |
| `X concedes the Duke challenge. Y wins the challenge.` | Proof failed or conceded |
| `X blocks, claiming Contessa.` | Block |
| `X lost Captain.` | Card revealed (lost influence) |
| `X stole 2 coins from Y.` | Steal executed |
| `X exchanged with the court.` | Exchange finished |
| `The action was blocked.` | Block held |
| `Turn resolved.` | End of turn |
| `X wins.` | Game over |
| `X was removed by the host.` / `…and eliminated.` | Removal |
| `Interrupted action cancelled. Paid action cost returned.` | Removal refund |

Private notices (only the affected player sees these, shown as "Only you: …"):
`X's turn timed out. Automatic income/coup.` · `X's response timed out. Automatically passed.` · `X's proof choice timed out.` · `X's reveal choice timed out. Random influence revealed.` · `X's exchange timed out. Original influence kept.`
When one arrives, the toast says "Time ran out. Your choice was resolved automatically - see this turn."

⚠️ Income, Aid and Tax log **no coin-gain line**. Detect coin changes by comparing `player.coins` between states, not from the text.

### Sound cues (already implemented, procedural Web Audio)
Background music is a low pulse every 0.9 s. It is paused when the tab is hidden and ducked during voice chat. Effects, keyed on the new log text:

| Event | Sound |
|---|---|
| wins | Rising 4-note triangle arpeggio |
| a player is eliminated or removed | Deep falling boom |
| lost (a card) | Low falling triangle |
| challenges | Sharp sawtooth and sine sting |
| blocks | Low square thud |
| stole | Two-step down |
| proved | Bright two-note up |
| chose / exchanged | Light chime |
| ready check opened | Two-note chime |

The audio context only unlocks after the first pointer or key press. Mute and volume are stored in `localStorage`.

---

## 9. Recommended animation and motion spec (new)

**Engine rule:** for each new server state, build an **event list** by comparing the old and new state. Look at the log lines, `coins` per player, `revealed` per card, `phase.type` and `turn`. **Play the events one after another**, about 400–900 ms each, before showing the final state. Freeze input on the decision panel only while an animation involves *you*. Respect `prefers-reduced-motion`: replace motion with fades and keep the durations short.

### Where things are on the table (anchor points)
- **Court deck:** the centre of the felt. Cards come from and go to here.
- **Treasury:** add a small coin stack next to the court deck, because none exists yet. All coin gains and payments go through it.
- **Player seat:** their coin label and mini cards.
- **Your seat / hand:** bottom centre.
- **Claim stage:** an area just above the court-deck text, where declared claims and blocks show as large ghosted role cards.

| Moment | Detect | Animation |
|---|---|---|
| **Deal** | `Round N started.` | The court deck shuffles. Cards fly one at a time, clockwise from the starting player, 2 rounds. Your cards flip face-up when they land; opponents' stay face-down. Then 2 coins (or 1) drop into each seat from the treasury. |
| **Turn start** | `turn` index changes | The active seat's gold border pulses. The countdown ring resets. If it's you: "YOUR TURN" banner, the action buttons rise in, and a soft chime plays. |
| **Declare action** | `chose …` | A tag with the action name flies from the actor's seat to the claim stage. If it has a claim, a **ghost card** of the claimed role (outlined, semi-transparent, *not* the real card) appears there with "claims Duke". If it has a target, draw an arrow or line from the actor to the target seat and keep it while the turn is in progress. |
| **Pay cost** | Actor's coins go down at declaration | 3 or 7 coins slide from the actor's coin label to the treasury. |
| **Response window** | `challenge` / `block` / `blockChallenge` | Seats in `eligible` get a "thinking" ring. Each name in `passed` gets a ✓ "accepts" chip. If it's you, the decision panel slides in with Challenge / Block / Accept and a timer bar. |
| **Challenge** | `challenges` | A red "CHALLENGE!" stamp flies from the challenger to the claimant, the screen shakes a little, and a sting plays. |
| **Prove & replace** | `proved …` | The claimant's real card **flips face-up** for everyone, hold 600 ms with a glow, then slide it into the court deck. The deck shuffles. A new card slides back face-down. For the owner, it flips to show the new role, with a "New card" label. The challenger's seat turns red: "loses the challenge". |
| **Concede** | `concedes …` | The ghost claim card cracks or fades. "Bluff called" chip on the claimant. |
| **Block** | `blocks, claiming X` | A second ghost card (the block role) slides in from the blocker and **overlaps** the action ghost card like a shield. |
| **Blocked** | `The action was blocked.` | The action ghost card is pushed back toward the actor and fades. For Assassinate, show "3 coins lost" (they don't come back). |
| **Lose influence (choosing)** | `lose` phase | The losing player's seat glows red. If it's you, your hidden cards lift and wiggle slightly. Hovering one shows a "Reveal this card" hint. |
| **Card revealed** | `X lost Role` / `revealed` flips to true | The card flips face-up, fades to greyscale with a "REVEALED" stamp, and stays in place. It never leaves the seat. |
| **Elimination** | Player has no hidden cards left | The seat dims to 62 %, gets a "Eliminated" ribbon, and a deep boom plays. Any coins drain back to the treasury. |
| **Income / Aid / Tax** | Coins go up | 1, 2 or 3 coins arc one by one from the treasury to the actor's coin label, and the counter ticks up. |
| **Steal** | `stole N coins from Y` | N coins arc **directly from target to actor**. If N = 0, show an empty-handed puff "0 coins". |
| **Assassinate / Coup hit** | Goes to `lose` with reason assassinate/coup | A dagger (Assassin) or crown/gavel (Coup) icon travels along the target arrow and lands on the target's seat. Then the lose step follows. |
| **Exchange** | `exchange` phase | Two cards fly from the court deck to the actor. **For the actor**, a modal fans out all 3–4 cards; picked cards lift and get a gold outline; the counter reads "Keep 1 of 3". On confirm, the unpicked cards fly back into the court deck and it shuffles. **Others** see 2 face-down cards go to the actor, a "choosing…" fan, then 2 cards go back. |
| **Turn resolved** | `Turn resolved.` | Clear the arrows and ghost cards. The live thread header changes to "LAST TURN · RESOLVED". |
| **Win** | `X wins.` | The winner's seat moves to the centre, spotlight, confetti or crown, and the arpeggio plays. Then the ROUND COMPLETE panel. |
| **Timeout auto-move** | A private notice arrives | Toast plus a small "⏱ auto" tag on the affected event in the thread. |

### Countdown design
- Base it on the server time: `deadline − (Date.now() + serverOffset)`. Update it at least every 250 ms.
- **Every phase has a timer.** Show it as a ring around the active player's seat or seats, and as a bar in the decision panel when it's your decision.
- Under 10 s, turn it red with a heartbeat pulse. Optionally play a tick sound at 5, 4, 3, 2, 1 (only when it's your decision).
- Show what will happen on timeout as hover text or small print:
  - Turn: "Income on timeout, mandatory Coup at 10+ coins."
  - Other phases: "Automatic response on timeout."

---

## 10. Who sees what (privacy)

| Data | You | Others | Spectators |
|---|---|---|---|
| Your hidden card roles | ✅ | ❌ (back only) | ❌ |
| Revealed cards | ✅ | ✅ | ✅ |
| Coins of everyone | ✅ | ✅ | ✅ |
| Deck count | ✅ | ✅ | ✅ |
| Exchange choices | Only the exchanger | ❌ ("X is exchanging.") | ❌ |
| Private timeout notices | Only the affected player | ❌ | ❌ |
| DMs | Sender and recipient, live only | ❌ | ❌ |

⚠️ **Prove screen risk.** If the claimant takes a long time on the prove screen, others may guess they are deciding whether to bluff. Keep the "waiting" UI the same for everyone, whatever the claimant actually holds.

---

## 11. Errors and edge states to design

| Situation | Message / behaviour |
|---|---|
| Two players clicked at the same moment | 409: "Another move arrived first. Refreshing the table." / "The table changed. Your view has been refreshed." The client resyncs. Show it as a soft toast, not an error. |
| Clicking after your window closed | 400: "No response needed from you.", "You cannot challenge now.", "Not your turn." |
| Rate limit | "Too many actions. Slow down." |
| Server down | "The table is temporarily unavailable. Try again shortly." Footer shows "Reconnecting…". |
| Seat token invalid (removed) | Full screen "Your seat is no longer active." |
| Room expired (24 h) | "Room not found or expired." |
| Voice not configured or failing | "Voice is not configured yet. The game still works." / "Microphone denied. Allow it in browser settings; listening still works." |
| Remove succeeded but voice kick failed | "Player removed. Voice disconnect could not be confirmed." |
| Tab hidden | Polling and music pause. The **game keeps running on the server**: your timers still expire and auto-choices still happen. On return it syncs immediately. If everyone has the tab closed, timeouts only resolve once someone comes back. |

---

## 12. Gaps and inconsistencies to fix

1. **Timer values disagree.** The live server and in-game rules say 45 / 30 / 20 s. `README.md` and `engine.js` (used by the tests) say 60 / 30 s. Always read the timer from `phase.deadline` and never hardcode it.
2. **No event queue or animations.** Several events in one 2 s poll appear as a single jump today.
3. The **lobby labels every non-host player "Ready"**.
4. **Exchange lets you select more than N cards.** The button is disabled, but the selection isn't capped. Cap it, or swap out the oldest pick.
5. **Losing your last card still needs a click** on the only card left. You could auto-highlight it with a one-tap confirm.
6. **The treasury isn't shown**, so coin movements have no source or destination. Add a treasury stack.
7. **The leaderboard is never filled**, because no scoring is written.
8. The block window for Steal and Assassinate shows non-targets only "Waiting for X to respond." It would help to explain that only the target can block.
9. There is **no spot on the table showing the current claim**. The claim only appears in the side panel text, so add the claim stage from §9.
10. Targeting only works from a list. Make the opponent seats on the table clickable.
11. Live DMs disappear on refresh. Warn people inside the panel ("Lost on refresh or exit." already exists, so keep it visible).
