# Extrat — Product Requirements

> **Status:** APPROVED by owner 2026-10-17
> **Owner:** soncsec (approves scope, merges, and production releases)
> **Dev lead:** Claude Code

## 1. Summary

Extrat is a single-player, browser-based, turn-based tactics game in the style of XCOM. A squad of four marines explores Earth landscapes, hunting hostile aliens that hide in the fog and ambush them. Each mission is fought on a randomly generated map, and six missions make up the campaign.

It is built mainly from the Ansimuz "Legacy Collection" pixel-art pack (CC0) and is a game on the **games.soncrant.com** portal.

## 2. Goals

- The tactical decisions of XCOM in short sessions: use cover, flank, and watch out for ambushes.
- A complete campaign a stranger can open from a URL, play without help, and finish.
- Missions of 10–20 minutes, with the campaign resuming where the player left off.
- The same quality bar and delivery process as the other Soncrant Arcade games.

## 3. Users

- **Primary:** casual players on desktop browsers (Chrome, Firefox), using a mouse with a few keyboard shortcuts, and on phones and tablets with a touchscreen (owner, 2026-10-18).
- **Secondary:** the owner, as play-tester and reviewer.

## 4. Scope — Version 1.0

### In scope

| Area | Requirement |
|---|---|
| Game type | Tactical combat only: missions played one after another. No base building, research or world map |
| Camera | Top-down grid of 16 px tiles. Characters are side-view sprites about two tiles tall that face left or right (art option A, owner decision 2026-10-17) |
| Squad | 4 marines, each recolored so they can be told apart |
| Turns | Player turn, then alien turn. Each marine has **2 actions** per turn |
| Combat | Half and full cover depending on the shooter's direction; flanking; hit chance shown before shooting; overwatch; reload; grenades. Exact mechanics and numbers are Claude's to design (owner decision 2026-10-17) and live in `src/config/tuning.ts` |
| Aliens | Hidden by fog of war until spotted. Groups of aliens wake when they see the squad and **ambush** it. Several alien types (walker, flyer, lizard, snake) with their own abilities; a mech boss in the final mission |
| Maps | **Randomly generated** for each mission from a seed. Every map is checked automatically to be playable and fair |
| Landscapes | One per mission: forest, town, coast, rocky hills, alien crash site, alien ship (final mission) |
| Campaign | **6 missions**. Mission goal: wipe out the aliens (the final mission ends with the boss). If the whole squad dies, the player retries the mission on a new map |
| Ranks | Marines earn XP and rise in rank, with small stat increases |
| Fallen marines | **No permadeath.** A marine killed in a mission comes back for the next one at full health, but is **shamed**: an embarrassing nickname, a "Wall of Shame" death count, and mocking debrief lines. Shame is cosmetic only (owner decision 2026-10-17) |
| Save and resume | The campaign autosaves every turn in the browser (localStorage) and resumes after the browser is closed |
| Difficulty | One level, beatable by a casual player |
| Controls | Mouse: select, move, target. A few keyboard shortcuts (for example next marine, end turn, choose action, cancel). Touch: tap a tile once to preview the move (path, cost, cover), tap it again to move; everything the keys do has an on-screen button |
| Screens | Title, squad (with Wall of Shame), mission briefing, battle, debrief, campaign victory, game over |
| Navigation | A link back to the games portal from the title screen |
| Audio | CC0 sound effects. No music in v1 (planned later) |
| Art | Legacy pack: Warped space marine and aliens, TinyRPG top-down terrain, Warped sci-fi interior, explosions and hit effects, Warped portraits. Claude draws missing terrain pieces in matching style |
| Display | Native pixel art, fits the browser window. Every art pixel covers a whole number of the screen's own pixels (so phones can show the game at, say, 4/3 and stay crisp). Phones and tablets: landscape only, with a notice to turn the device when held upright |

### Out of scope (v1)

- Base building, research, world map, equipment economy
- Permadeath, multiple difficulty levels
- Music (planned after v1)
- Gamepad controls
- Portrait (upright) play on phones
- Multiplayer, online leaderboards, accounts, payments, analytics
- Destructible terrain, multi-level buildings
- Any backend or server-side code

## 5. Constraints (shared by every Soncrant Arcade game)

- Browser only, single player: desktop browsers (current Chrome, Firefox, Safari, Edge) and phone/tablet browsers (current Chrome, Safari) in landscape.
- No accounts, payments, analytics, cookies or third-party requests.
- **Browser storage holds only the campaign save and settings** (owner approved 2026-10-17, ADR-E6). No personal data.
- Art keeps its native pixel style; each art pixel is a whole number of screen pixels.
- Served at `games.soncrant.com/extrat/` over HTTP (ADR-010), behind the security headers in the portal's Apache config.

## 6. Definition of success

- A stranger opens `games.soncrant.com/extrat/`, plays through all six missions without help, and finishes the campaign.
- Closing the browser mid-mission and coming back resumes the same turn.
- All CI, static and dynamic security checks pass on the released commit.

## 7. Decisions confirmed by the owner

| Date | Decision |
|---|---|
| 2026-10-17 | Tactical combat only, no strategy layer |
| 2026-10-17 | Squad of 4 marines |
| 2026-10-17 | 6 missions on randomly generated maps |
| 2026-10-17 | Aliens hidden in fog of war, and they ambush |
| 2026-10-17 | Combat mechanics left to Claude |
| 2026-10-17 | One difficulty level for now |
| 2026-10-17 | Mouse plus limited keyboard shortcuts |
| 2026-10-17 | 10–20 minute missions, resumable |
| 2026-10-17 | Sound effects in v1; music later |
| 2026-10-17 | Art option A: the pack's side-view characters on top-down terrain. Mixing art sets is fine; Claude may draw missing pieces |
| 2026-10-17 | Marines gain ranks. No permadeath: fallen marines return at full health and are shamed (cosmetic only) |
| 2026-10-17 | Whole squad lost: retry the mission on a new map |
| 2026-10-17 | Campaign save in localStorage (security decision, ADR-E6) |
| 2026-10-18 | Playable on phones and tablets with touch, as well as desktop. Tap to preview, tap again to act. Whole map on phones (zoom and drag only if needed after play-testing). Landscape only. Built before the Wall of Shame |

## 8. Open questions

None at the moment.
