import { describe, expect, it } from 'vitest';
import { FOREST, GRENADE, MAP_COLS, MAP_ROWS } from '../../src/config/tuning';
import { apply, createBattle, type BattleState, type Unit } from '../../src/logic/battle';
import { currentMission, newCampaign } from '../../src/logic/campaign';
import {
  blastProps,
  blocksSight,
  generateForest,
  generateMap,
  isWalkable,
  PROPS,
  tileAt,
  type BattleMap,
  type PropKind,
} from '../../src/logic/map';
import { decodeSave, encodeSave, restoreBattle } from '../../src/logic/save';

const COLS = 16;
const ROWS = 9;

/** An open map with these props (one-tile ones, or a wide prop's anchor and rest). */
function mapWith(props: [number, number, PropKind][]): BattleMap {
  const tiles = Array.from({ length: COLS * ROWS }, () => ({
    prop: null as PropKind | null,
    anchor: false,
  }));
  for (const [x, y, prop] of props) {
    const { width, height } = PROPS[prop];
    for (let j = 0; j < height; j++) {
      for (let i = 0; i < width; i++) tiles[(y - j) * COLS + x + i] = { prop, anchor: !i && !j };
    }
  }
  return { cols: COLS, rows: ROWS, seed: 0, tiles, decals: [] };
}

const propAt = (map: BattleMap, x: number, y: number): PropKind | null =>
  tileAt(map, x, y)?.prop ?? null;

describe('grenades wreck cover (M5.13, owner 2026-10-19)', () => {
  it('blow small cover away and trees down to a trunk', () => {
    const map = mapWith([
      [7, 4, 'bush'],
      [8, 4, 'rocks'],
      [7, 5, 'pine'],
      [9, 5, 'oak'],
      [8, 3, 'crate'],
      [6, 3, 'scrap'],
    ]);
    const { map: after, wrecks } = blastProps(map, { x: 8, y: 4 }, GRENADE.radius);
    expect(propAt(after, 7, 4)).toBeNull();
    expect(propAt(after, 8, 4)).toBeNull();
    expect(propAt(after, 8, 3)).toBeNull();
    expect(propAt(after, 7, 5)).toBe('trunk');
    expect(propAt(after, 9, 5)).toBe('trunk');
    // (6, 3) is beyond the 3 x 3 blast: untouched.
    expect(propAt(after, 6, 3)).toBe('scrap');
    expect(wrecks).toHaveLength(5);
    // The bush's tile is open ground now; the trunk is half cover and doesn't block sight.
    expect(isWalkable(after, 7, 4)).toBe(true);
    expect(PROPS.trunk.cover).toBe('half');
    expect(blocksSight(map, 7, 5)).toBe(true);
    expect(blocksSight(after, 7, 5)).toBe(false);
    // The original map is never changed.
    expect(propAt(map, 7, 4)).toBe('bush');
  });

  it('blows a trunk away with a second grenade, listing its tile once', () => {
    const map = mapWith([[8, 4, 'pine']]);
    const once = blastProps(map, { x: 8, y: 4 }, GRENADE.radius).map;
    const twice = blastProps(once, { x: 8, y: 4 }, GRENADE.radius);
    expect(propAt(once, 8, 4)).toBe('trunk');
    expect(propAt(twice.map, 8, 4)).toBeNull();
    expect(twice.wrecks).toEqual([{ x: 8, y: 4, to: null }]);
    expect(twice.map.wrecked).toEqual([4 * COLS + 8]);
  });

  it('leaves big props and the edge rows standing', () => {
    const map = mapWith([
      [1, 5, 'house'],
      [12, 7, 'boulder'],
      [12, 4, 'wreck'],
      [8, 1, 'pine'],
      [8, 7, 'pillar'],
    ]);
    for (const at of [
      { x: 8, y: 2 }, // the tree line's bottom row is row 1: out of reach
      { x: 3, y: 4 },
      { x: 12, y: 7 },
      { x: 13, y: 3 },
      { x: 8, y: 7 },
    ]) {
      const result = blastProps(map, at, GRENADE.radius);
      expect(result.wrecks, JSON.stringify(at)).toEqual([]);
      expect(result.map).toBe(map);
    }
    expect(FOREST.treeLineRows).toBeGreaterThan(1);
  });

  it('happens when a marine throws, and the throw reports it', () => {
    const base = createBattle(generateForest(1, MAP_COLS, MAP_ROWS), 1);
    const m = base.units.find((u) => u.side === 'marine') as Unit;
    const a = base.units.find((u) => u.side === 'alien') as Unit;
    const state: BattleState = {
      ...base,
      map: mapWith([
        [9, 4, 'bush'],
        [10, 5, 'pine'],
      ]),
      units: [
        { ...m, id: 'm1', x: 2, y: 4 },
        { ...a, id: 'a1', x: 14, y: 7, dormant: false },
      ],
      selected: 'm1',
    };
    const after = apply(state, { type: 'throw', unitId: 'm1', at: { x: 9, y: 4 } });
    expect(after.lastThrow?.wrecks).toEqual([
      { x: 9, y: 4, to: null },
      { x: 10, y: 5, to: 'trunk' },
    ]);
    expect(propAt(after.map, 9, 4)).toBeNull();
    expect(propAt(after.map, 10, 5)).toBe('trunk');
  });
});

describe('a blast that opens up a hiding place', () => {
  it('wakes the pod behind the trees it blew down', () => {
    const base = createBattle(generateForest(1, MAP_COLS, MAP_ROWS), 1);
    const m = base.units.find((u) => u.side === 'marine') as Unit;
    const a = base.units.find((u) => u.side === 'alien') as Unit;
    // A wall of pines in column 8 hides the alien at (11, 4) from the marine at (2, 4).
    const state: BattleState = {
      ...base,
      map: mapWith([
        [8, 3, 'pine'],
        [8, 4, 'pine'],
        [8, 5, 'pine'],
      ]),
      units: [
        { ...m, id: 'm1', x: 2, y: 4 },
        { ...a, id: 'a1', x: 11, y: 4, dormant: true, pod: 0 },
      ],
    };
    const after = apply(state, { type: 'throw', unitId: 'm1', at: { x: 8, y: 4 } });
    expect(after.map.tiles[4 * COLS + 8]?.prop).toBe('trunk');
    expect(after.units.find((u) => u.id === 'a1')?.dormant).toBe(false);
  });
});

describe('wrecked cover in the save (version 7)', () => {
  /** Mission 1 of campaign 11, with its first grenade thrown at a field tile with cover. */
  function blasted(): { campaign: ReturnType<typeof newCampaign>; battle: BattleState } {
    const campaign = newCampaign(11);
    const map = generateMap(
      campaign.mapSeed,
      MAP_COLS,
      MAP_ROWS,
      currentMission(campaign).landscape,
    );
    const battle = createBattle(map, map.seed, {
      names: campaign.squad,
      pods: currentMission(campaign).pods,
      kinds: currentMission(campaign).kinds,
    });
    // Blast every tree and bush in the middle of the map, as several grenades might.
    let wrecked = battle.map;
    for (let x = 7; x <= 15; x += 3) {
      for (let y = 3; y <= 12; y += 3) wrecked = blastProps(wrecked, { x, y }, GRENADE.radius).map;
    }
    // Blasted directly, not thrown, so nothing woke the pods it opened up: wake them all.
    const units = battle.units.map((u) => ({ ...u, dormant: false }));
    return { campaign, battle: { ...battle, map: wrecked, units } };
  }

  it('keeps what grenades wrecked, through a save and a reload', () => {
    const { campaign, battle } = blasted();
    expect(battle.map.wrecked?.length ?? 0).toBeGreaterThan(3);
    const loaded = decodeSave(encodeSave(campaign, battle));
    if (!loaded.ok || !loaded.save.battle) throw new Error('did not load');
    const back = restoreBattle(loaded.save.campaign, loaded.save.battle);
    expect(back?.map.tiles).toEqual(battle.map.tiles);
    expect(back?.map.wrecked).toEqual(battle.map.wrecked);
  });

  it('rejects wrecked cover that could not have happened', () => {
    const { campaign, battle } = blasted();
    const save = JSON.parse(encodeSave(campaign, battle)) as {
      battle: { wrecks: [number, string | null][] };
    };
    const map = battle.map;
    const fresh = generateMap(campaign.mapSeed, MAP_COLS, MAP_ROWS, 'forest');
    const index = (want: (p: PropKind | null) => boolean, minRow = 0): number =>
      fresh.tiles.findIndex((t, i) => want(t.prop) && Math.floor(i / map.cols) >= minRow);
    const field = FOREST.treeLineRows;
    const bad: unknown[] = [
      [[-1, null]],
      [[MAP_COLS * MAP_ROWS, null]],
      [[0.5, null]],
      [[index((p) => p === null, field), null]], // nothing there to wreck
      [[index((p) => p === 'pine', 0), 'trunk']], // the tree line at the top
      [[index((p) => p === 'bush' || p === 'rocks', field), 'trunk']], // only trees leave a trunk
      [[index((p) => p === 'boulder', field), null]], // too big to wreck
      [[index((p) => p === 'bush', field), 'oak']],
      [
        [index((p) => p === 'bush', field), null],
        [index((p) => p === 'bush', field), null],
      ],
      [[1, null, 2]],
      'all of it',
    ];
    for (const wrecks of bad) {
      const text = JSON.stringify({ ...save, battle: { ...save.battle, wrecks } });
      const loaded = decodeSave(text);
      const restored =
        loaded.ok && loaded.save.battle
          ? restoreBattle(loaded.save.campaign, loaded.save.battle)
          : null;
      expect(restored, JSON.stringify(wrecks)).toBeNull();
    }
  });

  it('a version 6 save has no wrecked cover, and no wrecks field', () => {
    const { campaign, battle } = blasted();
    const save = JSON.parse(encodeSave(campaign, battle)) as {
      v: number;
      battle: Record<string, unknown>;
    };
    const { wrecks, ...v6battle } = save.battle;
    expect(Array.isArray(wrecks)).toBe(true);
    const v6 = decodeSave(JSON.stringify({ ...save, v: 6, battle: v6battle }));
    expect(v6.ok && v6.save.battle?.wrecks).toEqual([]);
    expect(decodeSave(JSON.stringify({ ...save, v: 6 })).ok).toBe(false);
  });
});
