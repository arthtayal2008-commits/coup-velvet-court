# Coup · Velvet court

Private-table Coup for 2-6 friends. Join with a name, no accounts. Vercel serverless API, separate Neon Postgres room state, private token-authenticated player views, atomic versioned updates.

## Run tests
`npm test`

## Deploy
Import this private repository into Vercel on the Hobby plan. Set `DATABASE_URL` to the isolated Coup Neon database connection string, never a production database used by another app. No client-side secrets. Rooms expire after 24 hours without a move. Table updates poll every 2 seconds while the page is visible. Free service quotas can limit availability.

## Rules
Base Coup, not Reformation. Printed rulebook mirror: https://www.buffalolib.org/sites/default/files/gaming-unplugged/inst/Coup%20Instructions.pdf. Cross-check: https://rules.dized.com/game/xzsTtI3VTV-2wvos3otxIg/faq. Last winner starts the next round. Two-player starting player gets one coin. 60-second turns and 30-second response/decision windows. Income on turn timeout, mandatory Coup at 10+ coins with random living target. Unanswered response windows pass, proof auto-proves or concedes, reveal picks random hidden influence, exchange keeps original cards. Server-authoritative deadlines resolve on authenticated room requests; a visible table polls every 2 seconds. These timeout defaults are online table rules. First valid concurrent response is used. Steal from an eliminated false-block claimant follows the printed example; remaining coins go to treasury after action completion.

## Art
Original commissioned/generated portraits, no publisher illustrations. Role colors follow the standard physical game. This is an independent fan-made implementation, not affiliated with Indie Boards & Cards.

## Host controls
Only the host can remove players, with a confirmation. In lobby this frees a seat. In-game it reveals their influence, returns their coins, and excludes them from the rematch. A pending action involving them is cancelled, its paid cost returned, and play advances; unrelated response windows keep their original deadline. Removed players cannot submit moves.
