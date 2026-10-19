# Extrat — Final mission boss design (M5.6)

> **Status:** PROPOSED, for the owner's approval before any code (PM review, 2026-10-18).
> One page. Numbers are starting points and live in `src/config/tuning.ts` once built.

## 1. What the fight is for

Mission 6 is the climax. The boss must change how the player plays for ten minutes, not just soak up shots. Three things make that happen: a **weak side** that rewards flanking, a **big attack with a tell** that rewards moving, and **escorts** that keep cover and overwatch relevant.

## 2. The Overseer

A mech on a 2 x 2 block of tiles, from the Legacy pack's **Warped mech-unit** sheet (side view, 10 frames of 96 x 80 px, about four tiles tall on screen: it towers over the marines in the same art style). The pack's other candidate, the top-down boss, is 192 x 144 px and in a different view, so it doesn't fit art option A. The Overseer never hides: it stands in the ship's core with its two escort pods dormant around it, and wakes when it sees the squad.

| Stat | Value | Why |
|---|---|---|
| Health | 12 | Four rookies do 2–3 a hit: about eight hits, or five from the weak side |
| Move | 3 tiles | Slow: the player can keep away from it |
| Aim | 75, range 7 | A real threat at mid range, not across the map |
| Damage | 2–3 | Same as a walker's claws: two hits kill a rookie |
| Armour | Front arc only | See the weak side |

## 3. The weak side (rewards flanking)

The Overseer faces the nearest marine at the start of its turn and keeps that facing until its next turn. Shots from its **front arc** (the 180 degrees it faces) hit for **1 damage at most**. Shots from **behind or beside** do full damage and get the flank crit bonus, like any flanked target. The hit-chance panel says `ARMOURED` or `WEAK SIDE` so the player can see it. Rules: a unit gains an `armourFacing` field; `oddsBetween` applies the cap. No other unit uses it.

## 4. The charged blast (rewards moving)

Below half health the Overseer changes its pattern. At the end of an alien turn it **charges**: the banner says `OVERSEER CHARGING`, and a 3 x 3 target area is marked on the map in red around the marine it chose. On its **next** turn it fires: everyone still in the area takes 3 damage and loses their cover for a turn (the grenade rules, reused). Then it rests one turn and the cycle repeats. The player always gets one whole turn to get out of the area, so the blast only punishes standing still.

Rules: an `ability: 'blast'` kind with a `charging: Point | null` field on the unit; the AI picks the marine the most squad mates stand near. The alien turn: charge (no shot that turn), fire, rest.

## 5. Escorts and the win

Two pods of 2 (any kinds) start dormant beside the Overseer and wake with it. **The mission ends when the Overseer dies**, whatever is left of the escorts. The campaign victory screen follows as now.

## 6. What the player is told

The mission 6 briefing says: `Intel: the Overseer. Its front is armoured. Flank it.` and `When it charges, leave the marked squares.` The first charge also shows a one-line hint in the HUD. Nothing else is new to learn.

## 7. Build plan (after the alien ship landscape, M4.3)

1. **Rules and AI** in `src/logic/` with unit tests: facing, armour cap, charge/fire/rest cycle, win on boss death. No Phaser.
2. **Scene**: boss sprite and animations, the facing shown by the sprite, the red target area, the charging banner, the blast effect (reusing the grenade effect).
3. **Mission 6** wiring: `MISSIONS[5]` gets `boss: true`; the briefing lines; a Playwright test that the campaign ends when the boss dies.

Each step is one PR. Total: three PRs after the ship landscape.

## 8. Decisions for the owner

1. Approve the three mechanics: weak side, charged blast with a one-turn tell, escorts of two pods?
2. Does the fight end on the boss's death, or must the escorts die too? (Proposed: boss only.)
3. Health 12 and a 3-damage blast: fine as starting numbers for a casual player, to be tuned in play?
