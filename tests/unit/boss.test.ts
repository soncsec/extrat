import { describe, expect, it } from 'vitest';
import { BOSS, GRENADE, MAP_COLS, MAP_ROWS, UNITS } from '../../src/config/tuning';
import { planAlienAction } from '../../src/logic/ai';
import {
  apply,
  battleOutcome,
  blastArea,
  canCharge,
  createBattle,
  footprint,
  moveRange,
  shotOdds,
  unitAt,
  unitById,
  type BattleState,
  type Unit,
} from '../../src/logic/battle';
import { generateMap, isWalkable, type BattleMap } from '../../src/logic/map';

/** An open map with no props. */
function openMap(cols = 16, rows = 9): BattleMap {
  return {
    cols,
    rows,
    seed: 0,
    tiles: Array.from({ length: cols * rows }, () => ({ prop: null, anchor: false })),
    decals: [],
  } as BattleMap;
}

/** A ship battle with the boss, and a marine and the boss taken from it. */
const template = (() => {
  const map = generateMap(5, MAP_COLS, MAP_ROWS, 'ship');
  const b = createBattle(map, map.seed, { boss: true, pods: { count: 2, size: 2 } });
  const marine = b.units.find((u) => u.side === 'marine') as Unit;
  const boss = b.units.find((u) => u.kind === 'overseer') as Unit;
  return { b, marine, boss };
})();

/**
 * The boss (awake, front `front`) with its bottom-left tile at `bossAt`, and marines at
 * the given tiles, on an open map; whose turn it is is `turn`.
 */
function arena(
  bossAt: { x: number; y: number },
  marines: { x: number; y: number }[],
  opts: { front?: -1 | 1; hp?: number; turn?: 'marine' | 'alien' } = {},
): BattleState {
  const front = opts.front ?? -1;
  return {
    ...template.b,
    map: openMap(),
    turn: opts.turn ?? 'marine',
    units: [
      ...marines.map((p, i) => ({ ...template.marine, id: `m${i + 1}`, ...p })),
      {
        ...template.boss,
        id: 'a1',
        ...bossAt,
        dormant: false,
        front,
        facing: front,
        hp: opts.hp ?? template.boss.hp,
      },
    ],
  };
}

/** The first random state for which `m1` shooting the boss gives `want`. */
function shootUntil(s: BattleState, want: (next: BattleState) => boolean): BattleState {
  for (let rng = 1; rng < 2000; rng++) {
    const next = apply({ ...s, rng }, { type: 'shoot', unitId: 'm1', targetId: 'a1' });
    if (want(next)) return next;
  }
  throw new Error('no random state gives that result');
}

describe('the boss (M5.6)', () => {
  it('deploys on a free 2 x 2 square that nobody else stands on, on 200 ship maps', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const map = generateMap(seed, MAP_COLS, MAP_ROWS, 'ship');
      const b = createBattle(map, map.seed, { boss: true, pods: { count: 2, size: 2 } });
      const bosses = b.units.filter((u) => u.kind === 'overseer');
      expect(bosses, `seed ${seed}`).toHaveLength(1);
      const boss = bosses[0] as Unit;
      expect(boss).toMatchObject({ hp: UNITS.overseer.hp, dormant: true, front: -1, pod: 2 });
      const tiles = footprint(boss);
      expect(tiles).toHaveLength(BOSS.size * BOSS.size);
      for (const t of tiles) {
        expect(isWalkable(map, t.x, t.y), `seed ${seed}`).toBe(true);
        expect(unitAt(b, t.x, t.y)?.id, `seed ${seed}`).toBe(boss.id);
      }
      const others = b.units.filter((u) => u.id !== boss.id);
      for (const u of others) {
        expect(
          tiles.some((t) => t.x === u.x && t.y === u.y),
          `seed ${seed} ${u.id}`,
        ).toBe(false);
      }
      expect(b.units.filter((u) => u.side === 'alien')).toHaveLength(5);
    }
  });

  it('changes nothing in a battle without it', () => {
    const map = generateMap(9, MAP_COLS, MAP_ROWS, 'ship');
    const plain = createBattle(map, map.seed);
    expect(createBattle(map, map.seed, { boss: false })).toEqual(plain);
    expect(plain.units.every((u) => u.front === 0 && u.charging === null && u.cooldown === 0)).toBe(
      true,
    );
  });

  it('blocks all four of its tiles, and moves only where its whole square fits', () => {
    const s = arena({ x: 6, y: 4 }, [{ x: 2, y: 4 }], { turn: 'alien' });
    for (const t of footprint({ kind: 'overseer', x: 6, y: 4 })) {
      expect(unitAt(s, t.x, t.y)?.id).toBe('a1');
    }
    const cols = s.map.cols;
    // The boss's moves keep its whole square on the map and off the marine.
    for (const key of moveRange(s, 'a1').keys()) {
      const p = { x: key % cols, y: Math.floor(key / cols) };
      for (const t of footprint({ kind: 'overseer', ...p })) {
        expect(t.x >= 0 && t.y >= 0 && t.x < cols && t.y < s.map.rows).toBe(true);
        expect(t.x === 2 && t.y === 4).toBe(false);
      }
    }
    // A marine can't walk onto any of the boss's tiles.
    const marineTurn = { ...s, turn: 'marine' as const };
    for (const key of moveRange(marineTurn, 'm1').keys()) {
      expect(unitAt(s, key % cols, Math.floor(key / cols))?.id).not.toBe('a1');
    }
  });

  it('takes at most 1 damage from in front, and full damage with flank crits from behind or beside', () => {
    // Front to the west (-1): a marine to the west is in front of it.
    const front = arena({ x: 6, y: 4 }, [{ x: 2, y: 4 }]);
    const fOdds = shotOdds(front, 'm1', 'a1');
    expect(fOdds).toMatchObject({ armoured: true, flanked: false, cover: null });
    const hit = shootUntil(front, (n) => n.lastShot?.hit === true && n.lastShot.crit);
    expect(hit.lastShot?.damage).toBe(BOSS.armourCap);

    const behind = arena({ x: 6, y: 4 }, [{ x: 11, y: 4 }]);
    const bOdds = shotOdds(behind, 'm1', 'a1');
    expect(bOdds).toMatchObject({ armoured: false, flanked: true });
    expect(bOdds?.crit).toBeGreaterThan(fOdds?.crit ?? 100);
    const full = shootUntil(behind, (n) => n.lastShot?.hit === true && !n.lastShot.crit);
    expect(full.lastShot?.damage).toBeGreaterThanOrEqual(UNITS.marine.damage.min);

    // Beside it (in its own columns) is its weak side too.
    const beside = arena({ x: 6, y: 4 }, [{ x: 7, y: 8 }]);
    expect(shotOdds(beside, 'm1', 'a1')).toMatchObject({ armoured: false, flanked: true });
  });

  it('turns its front toward the nearest marine as the alien turn begins', () => {
    const s = arena({ x: 6, y: 4 }, [{ x: 12, y: 4 }], { front: -1 });
    const next = apply(s, { type: 'endTurn' });
    expect(unitById(next, 'a1')).toMatchObject({ front: 1, facing: 1 });
    // On the marines' turn the front stays where it was.
    const back = apply(
      { ...next, units: next.units.map((u) => (u.id === 'm1' ? { ...u, x: 1 } : u)) },
      { type: 'endTurn' },
    );
    expect(unitById(back, 'a1')?.front).toBe(1);
  });

  it('is hit by a grenade that reaches any of its tiles', () => {
    const s = arena({ x: 6, y: 4 }, [{ x: 2, y: 4 }]);
    const next = apply(s, { type: 'throw', unitId: 'm1', at: { x: 8, y: 3 } });
    expect(next.lastThrow?.hits.map((h) => h.unitId)).toEqual(['a1']);
    expect(unitById(next, 'a1')?.hp).toBe(UNITS.overseer.hp - GRENADE.damage);
  });

  it('charges only when hurt to half health, then blasts, rests a turn, and charges again', () => {
    const half = Math.floor(UNITS.overseer.hp * BOSS.chargeBelow);
    // Two marines side by side in the open, one alone: it aims at the pair.
    const marines = [
      { x: 2, y: 2 },
      { x: 2, y: 3 },
      { x: 3, y: 8 },
    ];
    const healthy = arena({ x: 9, y: 5 }, marines, { turn: 'alien' });
    expect(canCharge(healthy, 'a1')).toBe(false);
    expect(planAlienAction(healthy, 'a1')?.type).not.toBe('charge');

    const hurt = arena({ x: 9, y: 5 }, marines, { turn: 'alien', hp: half });
    expect(canCharge(hurt, 'a1')).toBe(true);
    const plan = planAlienAction(hurt, 'a1');
    expect(plan).toEqual({ type: 'charge', unitId: 'a1', at: { x: 2, y: 2 } });
    let s = apply(hurt, plan as NonNullable<typeof plan>);
    expect(unitById(s, 'a1')).toMatchObject({ charging: { x: 2, y: 2 }, ap: 0 });
    expect(canCharge(s, 'a1')).toBe(false);

    // The squad's turn passes without anyone moving; then the blast goes off.
    s = apply(apply(s, { type: 'endTurn' }), { type: 'endTurn' });
    expect(planAlienAction(s, 'a1')).toEqual({ type: 'blast', unitId: 'a1' });
    const before = s;
    s = apply(s, { type: 'blast', unitId: 'a1' });
    expect(s.lastBlast?.at).toEqual({ x: 2, y: 2 });
    expect(s.lastBlast?.hits.map((h) => h.unitId)).toEqual(['m1', 'm2']);
    for (const id of ['m1', 'm2']) {
      const was = unitById(before, id) as Unit;
      expect(unitById(s, id)).toMatchObject({
        hp: Math.max(0, was.hp - BOSS.blast.damage),
        exposed: was.hp > BOSS.blast.damage,
      });
    }
    expect(unitById(s, 'm3')?.hp).toBe(unitById(before, 'm3')?.hp);
    expect(unitById(s, 'a1')).toMatchObject({
      charging: null,
      cooldown: BOSS.blast.cooldown,
      ap: 0,
    });

    // Heal the squad so nobody is down, then step through the rest turn.
    const heal = (st: BattleState): BattleState => ({
      ...st,
      units: st.units.map((u) => (u.side === 'marine' ? { ...u, hp: u.maxHp, exposed: false } : u)),
    });
    s = apply(apply(heal(s), { type: 'endTurn' }), { type: 'endTurn' });
    expect(unitById(s, 'a1')?.cooldown).toBe(1);
    expect(canCharge(s, 'a1')).toBe(false);
    s = apply(apply(s, { type: 'endTurn' }), { type: 'endTurn' });
    expect(unitById(s, 'a1')?.cooldown).toBe(0);
    expect(canCharge(s, 'a1')).toBe(true);
  });

  it('hits its own escorts with the blast, but never itself', () => {
    const s0 = arena({ x: 9, y: 5 }, [{ x: 2, y: 2 }], { turn: 'alien', hp: 4 });
    const escort = {
      ...template.b.units.find((u) => u.kind !== 'overseer' && u.side === 'alien'),
      id: 'a2',
      x: 3,
      y: 2,
      dormant: false,
    } as Unit;
    const s = { ...s0, units: [...s0.units, escort] };
    const charged = apply(s, { type: 'charge', unitId: 'a1', at: { x: 2, y: 2 } });
    const ready = {
      ...charged,
      units: charged.units.map((u) => (u.id === 'a1' ? { ...u, ap: 2 } : u)),
    };
    const blown = apply(ready, { type: 'blast', unitId: 'a1' });
    expect(blown.lastBlast?.hits.map((h) => h.unitId).sort()).toEqual(['a2', 'm1']);
    expect(blastArea(ready, { x: 9, y: 5 }).some((u) => u.id === 'a1')).toBe(true);
    expect(unitById(blown, 'a1')?.hp).toBe(4);
  });

  it('refuses a charge or blast out of turn, from anyone else, or off the map', () => {
    const s = arena({ x: 9, y: 5 }, [{ x: 2, y: 2 }], { turn: 'alien', hp: 4 });
    expect(apply(s, { type: 'charge', unitId: 'a1', at: { x: 99, y: 2 } })).toBe(s);
    expect(apply(s, { type: 'charge', unitId: 'm1', at: { x: 2, y: 2 } })).toBe(s);
    expect(apply(s, { type: 'blast', unitId: 'a1' })).toBe(s);
    const marineTurn = { ...s, turn: 'marine' as const };
    expect(apply(marineTurn, { type: 'charge', unitId: 'a1', at: { x: 2, y: 2 } })).toBe(
      marineTurn,
    );
  });

  it('wins the battle when it dies, whatever is left of its escorts', () => {
    const map = generateMap(5, MAP_COLS, MAP_ROWS, 'ship');
    const b = createBattle(map, map.seed, { boss: true, pods: { count: 2, size: 2 } });
    expect(battleOutcome(b)).toBeNull();
    const bossDown = {
      ...b,
      units: b.units.map((u) => (u.kind === 'overseer' ? { ...u, hp: 0 } : u)),
    };
    expect(battleOutcome(bossDown)).toBe('won');
    const squadDown = {
      ...b,
      units: b.units.map((u) => (u.side === 'marine' ? { ...u, hp: 0 } : u)),
    };
    expect(battleOutcome(squadDown)).toBe('lost');
    // Without a boss, every alien must go down.
    const plain = createBattle(map, map.seed);
    const oneLeft = {
      ...plain,
      units: plain.units.map((u, i) => (u.side === 'alien' && i > 4 ? { ...u, hp: 0 } : u)),
    };
    expect(battleOutcome(oneLeft)).toBeNull();
    const allDown = {
      ...plain,
      units: plain.units.map((u) => (u.side === 'alien' ? { ...u, hp: 0 } : u)),
    };
    expect(battleOutcome(allDown)).toBe('won');
  });

  it('wakes its escorts when the squad spots it', () => {
    // Open map: the boss at the far east, out of sight (radius 12) of a marine at x 0.
    const walker = template.b.units.find(
      (u) => u.kind !== 'overseer' && u.side === 'alien',
    ) as Unit;
    const s0 = arena({ x: 14, y: 4 }, [{ x: 0, y: 4 }]);
    const s: BattleState = {
      ...s0,
      units: [
        ...s0.units.map((u) => (u.id === 'a1' ? { ...u, dormant: true, pod: 2 } : u)),
        { ...walker, id: 'a2', x: 15, y: 8, pod: 0, dormant: true },
        { ...walker, id: 'a3', x: 15, y: 0, pod: 1, dormant: true },
      ],
    };
    const next = apply(s, { type: 'move', unitId: 'm1', to: { x: 3, y: 4 } });
    expect(next.lastMove?.spotted).toContain('a1');
    expect(next.units.filter((u) => u.side === 'alien').every((u) => !u.dormant)).toBe(true);
    // The boss doesn't run for cover: it stays put, front toward the squad.
    expect(unitById(next, 'a1')).toMatchObject({ x: 14, y: 4, front: -1 });
  });
});
