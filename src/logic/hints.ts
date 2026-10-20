import type { Action, BattleState, Unit } from './battle';
import { canThrow, hasActions, unitById, unitVisibleTo } from './battle';
import { tileAt } from './map';

/*
 * First-mission hints (M6.2, owner 2026-10-20): in the campaign's first mission, a short
 * hint at a time teaches the next thing the player needs, at the moment it is needed.
 * Each hint goes away for the rest of the battle once the player has done what it
 * teaches. Nothing is stored: a hint may show again in a new battle of mission 1.
 */

export type HintId = 'reload' | 'endTurn' | 'grenade' | 'shoot' | 'cover' | 'move' | 'watch';

/** The order hints are picked in when more than one applies: the most urgent first. */
export const HINT_ORDER: readonly HintId[] = [
  'reload',
  'endTurn',
  'grenade',
  'shoot',
  'cover',
  'move',
  'watch',
];

/** The most characters on a line of the hint box (narrow, so it covers less of the map). */
export const HINT_WRAP = 34;

/** Each hint's text, with a mouse and keyboard, and on a touchscreen. */
export const HINT_TEXT: Readonly<Record<HintId, { mouse: string; touch: string }>> = {
  move: {
    mouse:
      'Click a marine, then a blue tile to move there (1 action). Yellow: a dash, both actions.',
    touch: 'Tap a marine, then a blue tile twice to move there (1 action). Yellow: a dash.',
  },
  cover: {
    mouse: 'Stop next to rocks or trees: a shield shows the cover. Aliens hit less in cover.',
    touch: 'Stop next to rocks or trees: a shield shows the cover. Aliens hit less in cover.',
  },
  shoot: {
    mouse: 'Aliens! Click one to see your chance to hit, then click it again to fire.',
    touch: 'Aliens! Tap one to see your chance to hit, then tap it again to fire.',
  },
  grenade: {
    mouse: 'Aliens close together: G throws a grenade that hits a 3 x 3 square.',
    touch: 'Aliens close together: GRENADE hits everything in a 3 x 3 square.',
  },
  reload: {
    mouse: 'Out of ammo: R reloads the clip (1 action).',
    touch: 'Out of ammo: RELOAD fills the clip (1 action).',
  },
  endTurn: {
    mouse: 'Every marine has acted: E ends the turn, and the aliens move.',
    touch: 'Every marine has acted: END TURN, and the aliens move.',
  },
  watch: {
    mouse: 'No aliens in sight? O: WATCH shoots the first alien that moves into view.',
    touch: 'No aliens in sight? WATCH shoots the first alien that moves into view.',
  },
};

/** The hint a player action completes (doing what it teaches), if any. */
const DONE_BY: Partial<Record<Action['type'], HintId>> = {
  move: 'move',
  shoot: 'shoot',
  reload: 'reload',
  throw: 'grenade',
  overwatch: 'watch',
  endTurn: 'endTurn',
};

/**
 * The hints done after `action` left the battle as `after`: the one the action teaches,
 * and 'cover' once any marine stands in cover.
 */
export function hintsDone(after: BattleState, action: Action): HintId[] {
  const done: HintId[] = [];
  const by = DONE_BY[action.type];
  if (by) done.push(by);
  if (marines(after).some((m) => inCover(after, m))) done.push('cover');
  return done;
}

/**
 * The hint to show now, or null. Only on the squad's turn; `done` holds the hints the
 * player has already acted on this battle.
 */
export function hintFor(state: BattleState, done: ReadonlySet<HintId>): HintId | null {
  if (state.turn !== 'marine') return null;
  const wanted = (id: HintId): boolean => !done.has(id) && applies(state, done, id);
  return HINT_ORDER.find(wanted) ?? null;
}

function applies(state: BattleState, done: ReadonlySet<HintId>, id: HintId): boolean {
  const squad = marines(state);
  const selected = state.selected ? unitById(state, state.selected) : undefined;
  const mine = selected?.side === 'marine' && selected.hp > 0 ? selected : undefined;
  const seen = state.units.filter(
    (u) => u.side === 'alien' && u.hp > 0 && unitVisibleTo(state, 'marine', u),
  );
  switch (id) {
    case 'reload':
      return mine !== undefined && mine.ammo === 0 && hasActions(mine);
    case 'endTurn':
      return squad.length > 0 && !squad.some(hasActions);
    case 'grenade':
      return mine !== undefined && canThrow(state, mine.id) && closePair(seen);
    case 'shoot':
      return seen.length > 0;
    case 'cover':
      return done.has('move') && !squad.some((m) => inCover(state, m));
    case 'move':
      return true;
    case 'watch':
      return done.has('move') && state.round >= 2 && seen.length === 0 && squad.some(hasActions);
  }
}

function marines(state: BattleState): Unit[] {
  return state.units.filter((u) => u.side === 'marine' && u.hp > 0);
}

/** A unit with cover on at least one side: a prop that gives cover next to it. */
function inCover(state: BattleState, u: Unit): boolean {
  return [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ].some(([dx, dy]) => {
    // Every prop gives cover (half or full), as the move preview's shields show.
    return tileAt(state.map, u.x + (dx ?? 0), u.y + (dy ?? 0))?.prop != null;
  });
}

/** Two of these aliens near enough for one grenade's 3 x 3 square to hit both. */
function closePair(aliens: readonly Unit[]): boolean {
  return aliens.some((a, i) =>
    aliens.slice(i + 1).some((b) => Math.abs(a.x - b.x) <= 2 && Math.abs(a.y - b.y) <= 2),
  );
}
