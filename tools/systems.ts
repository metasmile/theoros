// One project a star system: the region is the board, and a system is a place.
//
// `capture/systems.json` is every system The Forge holds, as ESI answered it, and this writes the folder each of them is:
// `projects/<slug>/project.json` and the run beside it. A run is built by the one mapping (`src/mapping`) and parsed
// before the folder is kept, so a count is the mapping's and a verb this build does not model fails here.
//
//   npm run generate
//
// `capture/units.json` is what each system holds: the star, its planets and their moons and belts, the gates and the
// stations. Every one of them is a unit, so a system shows what the source covers rather than a count, and the units are
// laid where the source puts them.
//
// Jita is the one system whose run is not its own security: `capture/new-eden.json` is the market question, and the
// station it reads is the station ESI numbers 60003760. The fleet stands in Akkio, the system the kills were read in.
//
// The last thing written is `projects/board.json`, so the rail is the systems the source holds rather than a list kept
// by hand.

import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseScenario } from '@ssccsorg/skene-kernel';
import { runOf, type Capture, type Scene, type Step } from '../src/mapping';
import { tile } from './cells';
import { INK } from '../src/ink';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, '..');
const PROJECTS = join(APP, 'projects');
const PROBE = join(APP, 'public', 'probe');

interface System {
  id: number;
  name: string;
  sec: number;
  x: number;
  y: number;
  z: number;
  gates: number;
  stations: number;
}

interface Fleet {
  system: { id: number; name: string };
  kills: {
    id: number;
    attackers: { character_id?: number; ship_type_id: number; damage_done: number }[];
  }[];
  names: Record<string, string>;
}

interface Unit {
  icon: string;
  label: string;
  model?: string;
  role?: string;
  abilities?: string[];
  ink?: string;
  attributes?: { facts?: { label: string; value: string }[] };
  views?: {
    id: string;
    src: string;
    medium: string;
    cells: [number, number];
    from?: number;
    to?: number;
  }[];
  at: { record: [number, number] };
}

interface Pilot {
  id: string;
  name: string;
  hull: string;
  damage: number;
}

interface Held {
  id: number;
  name: string;
  x: number;
  z: number;
}

interface HeldPlanet extends Held {
  type: number;
  typeName: string;
  moons: Held[];
  belts: Held[];
}

interface HeldGate extends Held {
  to: number;
}

interface HeldStation extends Held {
  type: number;
  typeName: string;
  owner: number;
  race: number;
  services: string[];
  dockable: number;
  officeRent: number;
  reprocessing: number;
  stationsTake: number;
}

interface HeldSystem {
  star: {
    id: number;
    name: string;
    radius: number;
    spectral: string;
    type: number;
    typeName: string;
    age: number;
    luminosity: number;
    temperature: number;
  };
  planets: HeldPlanet[];
  gates: HeldGate[];
  stations: HeldStation[];
}

interface Capture2 {
  pin: { source: string; endpoint: string; revision: string; adapter: string };
  systems: Record<string, HeldSystem>;
}

const systems = JSON.parse(readFileSync(join(APP, 'capture', 'systems.json'), 'utf8')) as System[];
const fleet = JSON.parse(readFileSync(join(APP, 'capture', 'fleet.json'), 'utf8')) as Fleet;
const market = JSON.parse(readFileSync(join(APP, 'capture', 'new-eden.json'), 'utf8')) as Capture;
const held = JSON.parse(readFileSync(join(APP, 'capture', 'units.json'), 'utf8')) as Capture2;

const WEB = 'https://esi.evetech.net/latest';
const SYSTEMS_PIN = { source: 'esi', endpoint: WEB, revision: 'server-3698585/2026-11-15', adapter: 'eve/1' };
const FLEET_PIN = { source: 'esi', endpoint: WEB, revision: 'server-3707965/2026-11-17', adapter: 'eve/1' };

/** The place every unit is laid in. */
const VIEW: [number, number, number, number] = [0, 0, 520, 176];
/** The middle of the box, which is where a system's own star stands. */
const MIDDLE: [number, number] = [260, 88];

const slug = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

const [, , width, height] = VIEW;

/**
 * The place is `width` by `height` and the shell bends it onto 30 degrees across and 26 up and down, so a pixel of
 * height is worth 2.56 of a width. Every ring and every mark is sized in those degrees.
 */
const ACROSS = 30 / width;
const UP = 26 / height;
/** A ring of so many degrees of the pane, as the place's own pixels. */
const ringAt = (degrees: number): [number, number] => [degrees / ACROSS, degrees / UP];
/** A point's bearing in the parameter the rings are drawn with, which is not its bearing in pixels. */
const bearingOf = (point: [number, number]): number =>
  Math.atan2(-(point[1] - MIDDLE[1]) * UP, (point[0] - MIDDLE[0]) * ACROSS);
/** A point of the place, on the ring of so many degrees at that bearing. */
const onRing = (bearing: number, degrees: number): [number, number] => {
  const [across, up] = ringAt(degrees);
  return inside([MIDDLE[0] + Math.cos(bearing) * across, MIDDLE[1] - Math.sin(bearing) * up]);
};

// The rings a system is read on, in degrees of the pane. A planet's mark is two degrees across and a station's two and
// a half, so a ring is sized by what it holds: thirteen worlds need three and a half degrees of arc between them, which
// is a ring of seven. The star's face is three and a third degrees, and the pane's half height is thirteen, so the ring
// of worlds clears the star and the ring of berths and gates clears the worlds' own moons.
const WORLD_RING = 6.8;
const OUTER_RING = 11.4;
/** How far outside its world a cloud of moons and belts stands, and how wide that cloud is drawn. */
const WORLD_CLOUD = 1.45;
const CLOUD_WIDE = 0.5;
/** The band between the star's face and the ring of worlds, where a unit that stands in the system rather than at a
 * body is drawn. */
const INNER_RING = 5.2;

// The region's ground: one cell a system, and the cell's middle is where the system stands. The cells are nominal and not
// the systems' real coordinates: EVE's positions are a flat map of a galaxy, and the shell this board draws is a sphere of
// directions. What the cell is for is that the ninety places tile the shell without a gap and without an overlap.
const tiling = tile(systems.map((system) => system.name));

const nameOf = (id: number) => fleet.names[String(id)] ?? String(id);

// The fleet, as ESI answered it: one pilot a character, with the hull they flew and the damage of every kill they answered
// in. The Serpentis patrols in the same kills carry no character and are not the fleet.
const pilots = new Map<number, Pilot>();
for (const kill of fleet.kills) {
  for (const attacker of kill.attackers) {
    if (!attacker.character_id) continue;
    const seen = pilots.get(attacker.character_id);
    if (seen) {
      seen.damage += attacker.damage_done;
      continue;
    }
    pilots.set(attacker.character_id, {
      id: slug(nameOf(attacker.character_id)),
      name: nameOf(attacker.character_id),
      hull: nameOf(attacker.ship_type_id),
      damage: attacker.damage_done,
    });
  }
}
const roster = [...pilots.values()].sort((left, right) => right.damage - left.damage);
const commander = roster[0];
const hulls = [...new Set(roster.map((pilot) => pilot.hull))].sort();

/** The systems the market capture reads. Its run names a gate by the system it leads to, not by the gate's own id. */
const namedByMarket = new Set<string>();
for (const scene of market.scenes) {
  for (const step of scene.steps) {
    for (const arg of step.args) {
      const origin = /^([a-z0-9-]+)\/[a-z0-9-]+$/.exec(arg);
      if (origin?.[1]) namedByMarket.add(origin[1]);
    }
  }
}

const KINDS = {
  station: ['reads', 'writes'],
  gate: ['reads', 'writes'],
  hauler: ['reads', 'writes', 'emits'],
  person: ['person'],
  system: ['reads', 'writes'],
  planet: [],
  moon: [],
  belt: [],
};

/** The abilities the kinds read and write through, and the record every unit keeps. */
const ABILITIES = [
  'console',
  'order-read',
  'order-fill',
  'gate-open',
  'traffic-read',
  'dock-at',
  'work-declare',
  'corridor-hold',
  'jump-run',
  'record',
];

/** The views a system stands: the sphere, the region drawn beside it, and the frame's own readings. */
const VIEWS = { seat: 'shell', on: ['eve-space', 'eve-system', 'shell', 'records', 'graph', 'intents', 'act'] };

/** Clamp a unit to the box, so a body near the edge is still drawn inside the patch. */
const inside = ([x, y]: [number, number]): [number, number] => [
  Math.min(Math.max(Math.round(x * 10) / 10, 10), width - 10),
  Math.min(Math.max(Math.round(y * 10) / 10, 10), height - 10),
];

/** The station the market capture reads, as ESI numbers it; the run's own name for it is `jita-4-4`. */
const MARKET_STATION = 60003760;

/** A number a reader scans rather than computes: thousands grouped, and the unit ESI answered it in. */
const grouped = (value: number) => value.toLocaleString('en-US');

/** The place a system is: its star, its planets and their moons and belts, its gates and its stations. */
function placeOf(system: System) {
  const id = slug(system.name);
  const stand = tiling.get(system.name);
  if (!stand) throw new Error(`${system.name} has no cell`);
  const one = held.systems[String(system.id)];
  if (!one) throw new Error(`${system.name} is not in capture/units.json`);
  const units: Record<string, Unit> = {
    [id]: {
      icon: 'system',
      label: system.name,
      // What the star is, in the source's own numbers: the run carries the temperature, and the panel carries the rest.
      attributes: {
        facts: [
          { label: 'spectral', value: one.star.spectral },
          { label: 'temperature', value: `${grouped(one.star.temperature)} K` },
          { label: 'radius', value: `${grouped(one.star.radius)} m` },
        ],
      },
      at: { record: MIDDLE },
      // The probe's three frames, each standing in one scene of the run: a still sequence the shell plays as footage.
      views: [
        { id: `${id}-probe-1`, src: `/probe/${id}-0.svg`, medium: 'image', cells: [0.65, 0.4], from: 0, to: 300 },
        { id: `${id}-probe-2`, src: `/probe/${id}-1.svg`, medium: 'image', cells: [0.65, 0.4], from: 300, to: 900 },
        { id: `${id}-probe-3`, src: `/probe/${id}-2.svg`, medium: 'image', cells: [0.65, 0.4], from: 900 },
      ],
    },
  };

  // A unit is named in the place by the word a reader already uses, so the id is the name's spelling and not an ESI
  // number: the panel and the board draw the id, and an id of eight digits is a row nobody can read.
  const taken = new Set<string>([id]);
  const keyOf = (name: string): string => {
    const base = slug(name) || 'unit';
    let key = base;
    for (let more = 2; taken.has(key); more += 1) key = `${base}-${more}`;
    taken.add(key);
    return key;
  };

  const systemName = (wanted: number) => systems.find((entry) => entry.id === wanted)?.name ?? String(wanted);
  const home: Record<string, [number, number]> = {};

  // A body is placed by its rank among its own kind, not by its raw distance. Drawn to scale the inner system is one
  // pile on the star, and a system's body count is what sets its ring: what the source says is the order, and the
  // bearing and the ring are this board's.
  const ringOf = (list: Held[], degrees: number, phase: number) => {
    const order = [...list].sort((left, right) => Math.hypot(left.x, left.z) - Math.hypot(right.x, right.z));
    return (body: Held): [number, number] => {
      const rank = order.indexOf(body);
      // A system's bodies share a plane, so the bearings the source states put them on one line. The order is what this
      // keeps, and the bearing a body is given is its rank.
      return onRing((rank / Math.max(order.length, 1)) * Math.PI * 2 + phase, degrees);
    };
  };
  const planetSpot = ringOf(one.planets, WORLD_RING, 0.7);

  // A berth and a gate are both two and a half degrees across, so the two kinds share the outer ring instead of standing
  // in a ring each. Their ranks are interleaved, which puts a berth and a gate about as far apart as two berths.
  const outer = [
    ...one.stations.map((body, at) => ({ body, at: (at + 0.5) / Math.max(one.stations.length, 1) })),
    ...one.gates.map((body, at) => ({ body, at: (at + 0.5) / Math.max(one.gates.length, 1) })),
  ].sort((left, right) => left.at - right.at);
  const outerSpot = new Map<Held, [number, number]>();
  outer.forEach(({ body }, index) => {
    outerSpot.set(body, onRing((index / Math.max(outer.length, 1)) * Math.PI * 2 + 0.35, OUTER_RING));
  });
  const outerAt = (body: Held): [number, number] => {
    const spot = outerSpot.get(body);
    if (!spot) throw new Error(`${body.name} has no place on the outer ring`);
    return spot;
  };

  for (const planet of one.planets) {
    const here = planetSpot(planet);
    const key = keyOf(planet.name);
    home[key] = here;
    units[key] = {
      icon: 'planet',
      label: planet.name,
      model: planet.typeName,
      attributes: { facts: [{ label: 'type', value: planet.typeName }] },
      at: { record: here },
    };
    // What a world holds is drawn as one puff outside it: a moon's real bearing is metres from a planet that is a dot
    // here, so its bodies stand round it at this board's scale. The puff is wider for a fuller world and capped, so it
    // stays inside the room its world has to its neighbours and to the berths.
    const cloud = Math.min(CLOUD_WIDE, 0.19 * Math.sqrt(planet.moons.length + planet.belts.length));
    const [wide, tall] = ringAt(WORLD_CLOUD);
    const [puff, puffUp] = ringAt(cloud);
    // Outward from the star, in the rings' own bearing, so the puff stands clear of the world it belongs to.
    const away = bearingOf(here);
    const middle: [number, number] = [here[0] + Math.cos(away) * wide, here[1] - Math.sin(away) * tall];
    const spots = (count: number): [number, number][] =>
      Array.from({ length: count }, (_, index) => {
        // The golden angle over a disc of even density: no two bodies share a radius at any count.
        const angle = index * 2.399963 + 0.6;
        const radius = Math.sqrt((index + 0.5) / Math.max(count, 1));
        const x = Math.cos(angle) * puff * radius;
        const y = Math.sin(angle) * puffUp * radius;
        return inside([middle[0] + x, middle[1] + y]);
      });
    const held = spots(planet.moons.length + planet.belts.length);
    planet.moons.forEach((moon, index) => {
      units[keyOf(moon.name)] = { icon: 'moon', label: moon.name, at: { record: held[index] } };
    });
    planet.belts.forEach((belt, index) => {
      units[keyOf(belt.name)] = { icon: 'belt', label: belt.name, at: { record: held[planet.moons.length + index] } };
    });
  }

  for (const gate of one.gates) {
    const to = systemName(gate.to);
    // The market run reads a neighbour through the gate that leads to it, so that gate carries the neighbour's name.
    const dest = slug(to);
    const key = dest !== id && namedByMarket.has(dest) && !taken.has(dest) ? dest : keyOf(to);
    taken.add(key);
    units[key] = { icon: 'gate', label: `to ${to}`, at: { record: outerAt(gate) } };
  }

  for (const station of one.stations) {
    const key = station.id === MARKET_STATION ? 'jita-4-4' : keyOf(station.name);
    taken.add(key);
    home[key] = outerAt(station);
    units[key] = {
      icon: 'station',
      label: station.name,
      model: station.typeName,
      // What can be done at the berth, which is the one thing ESI states about a station beyond its name.
      attributes: {
        facts: [
          { label: 'type', value: station.typeName },
          { label: 'services', value: station.services.join(', ') || 'none' },
          { label: 'dockable', value: `${grouped(station.dockable)} m3` },
          { label: 'reprocessing', value: `${Math.round(station.reprocessing * 100)}%` },
        ],
      },
      ...(key === 'jita-4-4' ? { abilities: ['order-read', 'order-fill'] } : {}),
      at: { record: home[key] },
    };
  }

  if (system.name === fleet.system.name) {
    // The fleet stands in the system it fought in, round its star: the pilots on one ring and the hulls they flew on the
    // The fleet stands in the system it fought in, round its star: the pilots on one ring and the hulls they flew on the
    // next, both inside the ring of worlds.
    const circle = (count: number, degrees: number, phase: number): [number, number][] => {
      const [across, up] = ringAt(degrees);
      return Array.from({ length: count }, (_, index) => {
        const angle = (index / Math.max(count, 1)) * Math.PI * 2 + phase;
        return inside([MIDDLE[0] + Math.cos(angle) * across, MIDDLE[1] - Math.sin(angle) * up]);
      });
    };
    circle(roster.length, 4.4, 0.7).forEach((at, index) => {
      const pilot = roster[index];
      units[pilot.id] = {
        icon: 'person',
        label: pilot.name,
        role: pilot === commander ? 'admin' : 'member',
        at: { record: at },
      };
    });
    circle(hulls.length, 5.8, 1.1).forEach((at, index) => {
      units[slug(hulls[index])] = { icon: 'hauler', label: hulls[index], at: { record: at } };
    });
  }

  if (id === 'jita') {
    // The pilot who takes the market work stands under the berth the order is at. The rim is where the berths and gates
    // are and the worlds stand outside the star's face, so the pilot stands in the free band between the two.
    units.saltyfish11 = {
      icon: 'person',
      label: 'saltyfish11',
      role: 'admin',
      at: { record: onRing(bearingOf(home['jita-4-4'] ?? MIDDLE), INNER_RING) },
    };
  }

  // What each unit is, in the one colour the board has for what a thing is rather than what it did.
  for (const unit of Object.values(units)) unit.ink = INK[unit.icon];

  return {
    view: VIEW,
    sector: stand.seed,
    cell: stand.cell,
    mark: id,
    store: { label: system.name },
    areas: [{ x: 0, y: 0, w: width, h: height, label: system.name }],
    units,
  };
}

/** A step that reports a number, kept only when the source answered one: a missing reading is not a zero. */
function reading(steps: Step[], name: string, value: number | undefined, unit: string, origin: string) {
  if (!Number.isFinite(value)) return;
  steps.push({ verb: 'measured', args: [name, String(value), unit, origin] });
}

/** The run a system is, as the scenario language writes it. */
function captureOf(system: System, place: ReturnType<typeof placeOf>): Capture {
  const id = slug(system.name);
  const one = held.systems[String(system.id)];
  if (!one) throw new Error(`${system.name} is not in capture/units.json`);
  const moons = one.planets.reduce((count, planet) => count + planet.moons.length, 0);
  const belts = one.planets.reduce((count, planet) => count + planet.belts.length, 0);
  const berths = one.stations.reduce((sum, station) => sum + station.dockable, 0);
  const services = new Set(one.stations.flatMap((station) => station.services));

  // What the source holds for the system, its star and its berths: a reading carries the unit ESI answered it in, so a
  // temperature is not a distance and a berth volume is not a rating.
  const steps: Step[] = [
    { verb: 'measured', args: ['security', String(system.sec), 'rating', `${id}/system`] },
    { verb: 'measured', args: ['gates', String(system.gates), 'gates', `${id}/system`] },
    { verb: 'measured', args: ['stations', String(system.stations), 'stations', `${id}/system`] },
    { verb: 'measured', args: ['planets', String(one.planets.length), 'planets', `${id}/system`] },
    { verb: 'measured', args: ['moons', String(moons), 'moons', `${id}/system`] },
    { verb: 'measured', args: ['belts', String(belts), 'belts', `${id}/system`] },
  ];
  reading(steps, 'star-temperature', one.star.temperature, 'K', `${id}/star`);
  reading(steps, 'star-radius', one.star.radius, 'm', `${id}/star`);
  reading(steps, 'star-age', one.star.age, 'years', `${id}/star`);
  reading(steps, 'star-luminosity', one.star.luminosity, 'solar', `${id}/star`);
  reading(steps, 'berth-volume', berths, 'm3', `${id}/station`);
  reading(steps, 'services', services.size, 'services', `${id}/station`);

  const scenes: Scene[] = [{ at: 0, note: `00:00 ${system.name} is read.`, steps }];
  if (system.name === fleet.system.name) {
    scenes.push({
      at: 600,
      note: `00:10 The fleet: ${roster.length} pilots, from killmails ${fleet.kills.map((kill) => kill.id).join(' and ')}, read on 2026-11-17 (server 3707965).`,
      steps: [
        { verb: 'measured', args: ['fleet-pilots', String(roster.length), 'pilots', `${id}/fleet`] },
        { verb: 'measured', args: ['fleet-kills', String(fleet.kills.length), 'hulls', `${id}/fleet`] },
      ],
    });
  }
  // The work a system declares beside its measurements, so the record model is visible in a place that is not the market.
  scenes.push(...chainsOf(system, one, place, id));
  return {
    pin: SYSTEMS_PIN,
    title: `${system.name}, The Forge.`,
    introduction: [
      'Read from ESI on 2026-11-15, while server 3698585 ran. Security, gates and stations are this system.',
      ...(system.name === fleet.system.name
        ? [`The fleet: source=${FLEET_PIN.source} endpoint=${FLEET_PIN.endpoint} revision=${FLEET_PIN.revision} adapter=${FLEET_PIN.adapter}`]
        : []),
    ],
    seed: 7,
    scenes,
  };
}

/** The station unit key for a station's name, since a claim is made by a unit the place already holds. */
function berthKeyOf(place: ReturnType<typeof placeOf>, name: string): string | null {
  for (const [key, unit] of Object.entries(place.units)) {
    if (unit.icon === 'station' && unit.label === name) return key;
  }
  return null;
}

/**
 * The work a system declares beside its measurements. Each chain starts at a reading this run already wrote, is taken
 * by a berth the place already holds, and concludes a fact of its own. Three chains ask three different questions of
 * one system, so a run shows the record model away from the market rather than one line repeated ninety times.
 */
function chainsOf(system: System, one: HeldSystem, place: ReturnType<typeof placeOf>, id: string): Scene[] {
  const scenes: Scene[] = [];
  const held = system.sec >= 0.5;

  // A desk rule names what the system's own security reading counts as, and a berth takes the watch.
  const watch = one.stations[0] ? berthKeyOf(place, one.stations[0].name) : null;
  if (watch) {
    scenes.push({
      at: 300,
      note: `00:05 ${system.name}'s security is watched: the desk's rule names what counts as held.`,
      steps: [
        { verb: 'hint', args: ['desk-rule', `${held ? 'hold' : 'watch'}-${id}`] },
        { verb: 'intent', args: [`watch-${id}`, 'security', held ? 'hold-the-corridor' : 'watch-the-corridor'] },
        { verb: 'claim', args: [`watch-${id}`, watch] },
        { verb: 'conclude', args: [`watch-${id}`, held ? 'held' : 'watched'] },
      ],
    });
  }

  // The largest berth answers the capacity question the volume reading raised.
  const widest = [...one.stations].sort((left, right) => right.dockable - left.dockable)[0];
  const berth = widest ? berthKeyOf(place, widest.name) : null;
  if (berth) {
    scenes.push({
      at: 900,
      note: `00:15 ${system.name}'s berths are counted: the largest takes the capacity question.`,
      steps: [
        { verb: 'hint', args: ['berth-rule', `berth-${id}`] },
        { verb: 'intent', args: [`clear-${id}`, 'berth-volume', 'take-the-berth'] },
        { verb: 'claim', args: [`clear-${id}`, berth] },
        { verb: 'conclude', args: [`clear-${id}`, 'capacity-known'] },
      ],
    });
  }

  // A yard that refines answers the yield question the belt count raised.
  const refiner = one.stations.find((station) => station.services.includes('reprocessing-plant'));
  const yard = refiner ? berthKeyOf(place, refiner.name) : null;
  if (yard) {
    scenes.push({
      at: 1200,
      note: `00:20 ${system.name} refines: the belt count is the yield question, and the yard answers it.`,
      steps: [
        { verb: 'hint', args: ['yield-rule', `yield-${id}`] },
        { verb: 'intent', args: [`refine-${id}`, 'belts', 'read-the-belt'] },
        { verb: 'claim', args: [`refine-${id}`, yard] },
        { verb: 'conclude', args: [`refine-${id}`, 'yield-known'] },
      ],
    });
  }

  return scenes;
}

/** The colour a star's spectral class is drawn in, which is the one reading the picture shares with the run. */
function starInk(spectral: string): string {
  const ink: Record<string, string> = {
    O: '#9bb0ff',
    B: '#aabfff',
    A: '#cad7ff',
    F: '#f8f7ff',
    G: '#fff4e8',
    K: '#ffd2a1',
    M: '#ffb56b',
  };
  return ink[spectral.trim().charAt(0).toUpperCase()] ?? '#e8e2d4';
}

const escapeXml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * One frame of the probe's view, drawn from the capture the run measures: the star at the middle of the system's own
 * coordinates, and the planets it holds placed by the bearing and distance ESI answered for them. The three frames
 * reveal the system in the order the run reads it, so a scene's picture and that scene's numbers come from one source.
 */
function probeFrame(system: System, one: HeldSystem, step: number): string {
  const [width, height] = [640, 360];
  const [mx, my] = [width / 2, height / 2];
  const reach = 132;
  const star = Math.max(14, Math.min(46, 10 + Math.log10(Math.max(one.star.radius, 1)) * 4));
  // A world is placed by its rank among the system's own, as the board places it: the source states the order, and the
  // bearing and the ring are this frame's. Read raw, the distance puts the inner worlds on the star's disc and the
  // bearing is a plane, so a system's planets came out as a line of discs across the sun.
  const order = [...one.planets].sort((left, right) => Math.hypot(left.x, left.z) - Math.hypot(right.x, right.z));
  const least = star + 12;
  const bodies = order.map((planet, rank) => {
    const span = order.length > 1 ? rank / (order.length - 1) : 0.5;
    const apart = least + span * (reach - least);
    const angle = (rank / Math.max(order.length, 1)) * Math.PI * 2 + 0.7;
    return {
      x: mx + Math.cos(angle) * apart,
      y: my - Math.sin(angle) * apart,
      r: 2.4 + (planet.moons.length > 0 ? 1.6 : 0) + (planet.belts.length > 0 ? 1.2 : 0),
    };
  });
  const shown = step === 0 ? [] : step === 1 ? bodies.slice(0, Math.ceil(bodies.length / 2)) : bodies;
  const moons = one.planets.reduce((count, planet) => count + planet.moons.length, 0);
  const note =
    step === 0
      ? `${grouped(one.star.temperature)} K, ${one.star.spectral}`
      : step === 1
        ? `${one.planets.length} planets, ${moons} moons`
        : `${one.stations.length} berths, ${grouped(one.stations.reduce((sum, s) => sum + s.dockable, 0))} m3`;
  const rings = [0, 1, 2, 3].map(
    (ring) => `<circle cx="${mx}" cy="${my}" r="${(least + (ring * (reach - least)) / 3).toFixed(1)}" fill="none"/>`,
  );
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<rect width="${width}" height="${height}" fill="#05070c"/>`,
    `<g stroke="#1b2436" stroke-width="0.6">${rings.join('')}</g>`,
    `<circle cx="${mx}" cy="${my}" r="${star.toFixed(1)}" fill="${starInk(one.star.spectral)}"/>`,
    ...shown.map(
      (body) => `<circle cx="${body.x.toFixed(1)}" cy="${body.y.toFixed(1)}" r="${body.r.toFixed(1)}" fill="#8fa6c8"/>`,
    ),
    `<text x="18" y="28" fill="#e8e2d4" font-family="monospace" font-size="15">${escapeXml(system.name)}</text>`,
    `<text x="18" y="48" fill="#7d8aa6" font-family="monospace" font-size="12">probe ${step + 1} / 3 · ${escapeXml(note)}</text>`,
    `<text x="18" y="${height - 18}" fill="#4d586c" font-family="monospace" font-size="11">${escapeXml(one.star.typeName)}</text>`,
    '</svg>',
    '',
  ].join('\n');
}

/** The probe's three frames for a system, written where the deployment serves them. */
function writeProbe(system: System, one: HeldSystem | undefined) {
  if (!one) return;
  const id = slug(system.name);
  mkdirSync(PROBE, { recursive: true });
  for (const step of [0, 1, 2]) writeFileSync(join(PROBE, `${id}-${step}.svg`), probeFrame(system, one, step));
}

/** A run is read before it is kept: a verb this build does not model, or a count that does not derive, is a failure. */
function checked(text: string, who: string): string {
  const parsed = parseScenario(text);
  if (parsed.unknown.length) throw new Error(`${who} uses verbs the reader does not model: ${parsed.unknown.join(', ')}`);
  for (const check of parsed.checks) {
    if (check.derived !== check.expected) {
      throw new Error(`${who} counts ${check.expected} at ${check.at}s, and the reader derives ${check.derived}`);
    }
  }
  return text;
}

const document = (id: string, system: System, place: ReturnType<typeof placeOf>) => ({
  id,
  resources: [
    { kind: 'abilities', at: ABILITIES },
    { kind: 'channel', at: 'sim' },
    { kind: 'kinds', at: KINDS },
    { kind: 'record', at: `projects/${id}/run.txt` },
    { kind: 'views', at: VIEWS },
    { kind: 'clock', at: { record: `00:00, ${system.name} is read` } },
    { kind: 'status', at: system.name === fleet.system.name ? 'running' : 'idle' },
    { kind: 'place', at: place },
  ],
});

const seen = new Set<string>();
const written: string[] = [];
for (const system of systems) {
  const id = slug(system.name);
  if (seen.has(id)) throw new Error(`two systems answer to ${id}, and a project is one folder`);
  seen.add(id);
  const folder = join(PROJECTS, id);
  mkdirSync(folder, { recursive: true });
  const place = placeOf(system);
  writeProbe(system, held.systems[String(system.id)]);
  writeFileSync(join(folder, 'project.json'), `${JSON.stringify(document(id, system, place), null, 2)}\n`);
  // Jita's run is the market capture and nothing else: the test that holds the run to its capture is the promise that
  // the board shows what the source said, so the corridor chain is the other systems' and not this one's.
  const capture = id === 'jita' ? market : captureOf(system, place);
  const run = checked(runOf(capture), `projects/${id}/run.txt`);
  writeFileSync(join(folder, 'run.txt'), run);
  written.push(id);
}

// A folder this generator no longer writes is a system the source no longer holds.
for (const entry of readdirSync(PROJECTS, { withFileTypes: true })) {
  if (!entry.isDirectory() || written.includes(entry.name)) continue;
  rmSync(join(PROJECTS, entry.name), { recursive: true });
}

const order = systems.map((system) => slug(system.name));
writeFileSync(
  join(PROJECTS, 'board.json'),
  `${JSON.stringify(
    {
      note: 'One project a star system: the region is the board, and the frame\'s minimap is the travel between systems.',
      opens: 'jita',
      order,
    },
    null,
    2,
  )}\n`,
);
console.log(`wrote ${written.length} system projects and a board of ${order.length}, every run parsed`);
