Devlog #2 — Part 1/2

Huge stretch behind the scenes. Rinne now has real player accounts, a live domain, and infrastructure most players won't see but will feel.

New home: playrinne
The game moved off the old GitHub Pages URL to its own domain, playrinne.com, running through Cloudflare with edge caching on, faster loads, especially on repeat visits.

Player Accounts
Sign in with Google or Discord (or keep playing as a guest):
Unique in-game name (changeable once every 7 days).
Avatar from the Gym Badges you've earned.
A permanent Player ID
Link both Google and Discord to one account

Profile Page
Lifetime stats: score, hours played, caught, shinies, favorite starter, more
Rank title that grows with you: Rookie → Trainer → Ace → Veteran → Elite → Champion Class.
Achievement and badge tracking across every run
Per-mode global rank ("You're #47 in Classic")
A shareable trainer card image
Public profile link anyone can view or click a friend's name anywhere for a quick popup.

Friends
Add friends by name or Player ID, accepted requests only.
Friends are highlighted on the leaderboard, plus:
Head-to-head PvP record (wins-losses) on their row

Leaderboard, cleaned up
Rows now show your name and rank title instead of badges/caught, cleaner at a glance. Click any run for the full breakdown.

Seasons (foundation)
The leaderboard is season-aware now
"Season 1" is live, setting up seasonal resets down the line.

Global Stats
A new community stats page: total players, runs, Pokémon caught, most-caught species, most-picked starter, more.

(continued in Part 2/2)
Devlog #2 — Part 2/2

Difficulty tuning
Classic Gym, route trainer, and Elite Four battles got their strength nudged down slightly, more forgiving without changing the feel. Pro/Nuzlocke untouched.
Nuzlocke's catch-chance bonus trimmed, closer to Classic/Pro now.

Cause of defeat
Losing a run now also records which enemy Pokémon was left standing, shown on the result screen and run history.

Smarter Gym Leaders
Higher-tier Gyms can now make a real tactical switch mid-battle, same logic the Hill's Top1 already used. 

PokeStop home button
Every PokeStop now has the Rinne logo in the corner, click it anytime to head back home.

Bugs squashed
Poison/Steel-types are now correctly immune to being poisoned
A same-turn double-KO now counts as a win, not a loss
Lucky Spin/Fishing can't be replayed for free via refresh anymore
Cleaned up a couple of mismatched/unused image files

Behind the scenes
Checkpoints (mid-run saves) now follow your account across devices
Rate limiting and tighter security across every account action

Guest play is untouched, accounts are 100% optional, and none of this changes how a run plays out beat for beat unless noted above.