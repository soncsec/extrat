import { describe, expect, it } from 'vitest';
import { GRENADE, MAP_COLS, MAP_ROWS, SUPPLIES, UNITS } from '../../src/config/tuning';
import {
  createBattle,
  shotOdds,
  SUPPLY_IDS,
  type BattleState,
  type SupplyId,
  type Unit,
} from '../../src/logic/battle';
import {
  afterBattle,
  newCampaign,
  pickSupply,
  supplyDue,
  type Campaign,
} from '../../src/logic/campaign';
import { generateForest, type BattleMap } from '../../src/logic/map';

/** Campaign 7 after winning `n` missions. */
function after(n: number): Campaign {
  let c = newCampaign(7);
  for (let i = 0; i < n; i++) c = afterBattle(c, true, 'next');
  return c;
}

/** An open map with no props. */
function openMap(cols = 16, rows = 7): BattleMap {
  return {
    cols,
    rows,
    seed: 0,
    tiles: Array.from({ length: cols * rows }, () => ({ prop: null, anchor: false })),
    decals: [],
  } as BattleMap;
}

/** A marine and an awake alien in the open, four tiles apart, with this supply. */
function duel(supply: SupplyId | null): BattleState {
  const base = createBattle(generateForest(1, MAP_COLS, MAP_ROWS), 1, { supply });
  const m = base.units.find((u) => u.side === 'marine') as Unit;
  const a = base.units.find((u) => u.side === 'alien') as Unit;
  return {
    ...base,
    map: openMap(),
    units: [
      { ...m, id: 'm', x: 2, y: 3 },
      { ...a, id: 'a', x: 6, y: 3, dormant: false },
    ],
  };
}

describe('supply drop (M5.10)', () => {
  it('is due after each won mission, not before the first', () => {
    expect(supplyDue(newCampaign(7))).toBe(false);
    for (let n = 1; n < 6; n++) expect(supplyDue(after(n))).toBe(true);
    // Finished: nothing left to supply.
    expect(supplyDue(after(6))).toBe(false);
  });

  it('is picked once per mission, and only from the three supplies', () => {
    const c = after(2);
    const picked = pickSupply(c, 'scopes');
    expect(picked.supply).toBe('scopes');
    expect(supplyDue(picked)).toBe(false);
    // A second pick changes nothing; nor does a pick before the first mission.
    expect(pickSupply(picked, 'armour').supply).toBe('scopes');
    expect(pickSupply(newCampaign(7), 'armour').supply).toBeNull();
    expect(pickSupply(c, 'rockets' as SupplyId)).toBe(c);
  });

  it('lasts through retries and replays, and is used up by the next win', () => {
    const picked = pickSupply(after(1), 'grenades');
    expect(afterBattle(picked, false, 'retry').supply).toBe('grenades');
    expect(afterBattle(picked, false, 'replay').supply).toBe('grenades');
    const next = afterBattle(picked, true, 'next');
    expect(next.supply).toBeNull();
    expect(supplyDue(next)).toBe(true);
  });

  it('gives every marine one more grenade, or one more health', () => {
    const map = generateForest(3, MAP_COLS, MAP_ROWS);
    const marines = (supply: SupplyId | null): Unit[] =>
      createBattle(map, map.seed, { supply }).units.filter((u) => u.side === 'marine');
    for (const m of marines('grenades')) {
      expect(m.grenades).toBe(GRENADE.perMarine + 1);
      expect(m.maxHp).toBe(UNITS.marine.hp);
    }
    for (const m of marines('armour')) {
      expect(m.maxHp).toBe(UNITS.marine.hp + 1);
      expect(m.hp).toBe(m.maxHp);
      expect(m.grenades).toBe(GRENADE.perMarine);
    }
    // Aliens get nothing, and the battle is laid out exactly as without a supply.
    const plain = createBattle(map, map.seed);
    const armoured = createBattle(map, map.seed, { supply: 'armour' });
    expect(armoured.units.map((u) => [u.id, u.x, u.y])).toEqual(
      plain.units.map((u) => [u.id, u.x, u.y]),
    );
    const aliens = (s: BattleState): Unit[] => s.units.filter((u) => u.side === 'alien');
    expect(aliens(armoured)).toEqual(aliens(plain));
  });

  it('adds scopes` aim to marines` shots only', () => {
    const plain = shotOdds(duel(null), 'm', 'a');
    const scoped = shotOdds(duel('scopes'), 'm', 'a');
    expect(scoped?.aim).toBe((plain?.aim ?? 0) + SUPPLIES.scopes.aim);
    expect(scoped?.hit).toBe((plain?.hit ?? 0) + SUPPLIES.scopes.aim);
    // The alien shooting back is no better for it.
    const back = (s: BattleState): number | undefined =>
      shotOdds({ ...s, turn: 'alien' }, 'a', 'm')?.aim;
    expect(back(duel('scopes'))).toBe(back(duel(null)));
  });

  it('lists exactly the owner`s three choices', () => {
    expect(SUPPLY_IDS).toEqual(['grenades', 'armour', 'scopes']);
    expect(SUPPLIES.grenades.grenades).toBe(1);
    expect(SUPPLIES.armour.hp).toBe(1);
    expect(SUPPLIES.scopes.aim).toBe(10);
  });
});
