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

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, '..');
const PROJECTS = join(APP, 'projects');

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
  attributes?: { facts?: { label: string; value: string }[] };
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
/** How far a body may stand from the middle of the place, which leaves room for a name beside it. */
const REACH: [number, number] = [205, 64];

const slug = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

const [, , width, height] = VIEW;

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

const offsetOf = (home: [number, number], [dx, dy]: [number, number]) => inside([home[0] + dx, home[1] + dy]);

/**
 * How far from the middle a body is drawn.
 *
 * The source states a position in metres, and a system is a thousand times wider than its inner planets. Drawn at that
 * scale a moon and a gate would be one point, so the radius is compressed and the bearing kept: the order and the
 * directions are the source's, and the picture is one a mark can be read in.
 */
const R0 = 1e9;
function radial(r: number, most: number): number {
  if (most <= 0) return 0;
  if (most <= R0) return r / most;
  return Math.log1p(r / R0) / Math.log1p(most / R0);
}

/** Where one of the system's own bodies stands on the place, from its position in metres. */
function projector(most: number) {
  return ([x, z]: [number, number]): [number, number] => {
    const reach = radial(Math.hypot(x, z), most);
    const angle = Math.atan2(z, x);
    return inside([MIDDLE[0] + Math.cos(angle) * reach * REACH[0], MIDDLE[1] - Math.sin(angle) * reach * REACH[1]]);
  };
}

/** A moon or a belt stands round its planet, so its own distance is read at the scale of that planet's family. */
function around(home: [number, number], body: Held, parent: Held, most: number, least: number): [number, number] {
  const [dx, dz] = [body.x - parent.x, body.z - parent.z];
  const angle = Math.atan2(dz, dx);
  const size = least + (most > 0 ? (Math.hypot(dx, dz) / most) * 9 : 0);
  return inside([home[0] + Math.cos(angle) * size, home[1] - Math.sin(angle) * size]);
}

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

  const bodies = [...one.planets, ...one.gates, ...one.stations];
  const most = Math.max(...bodies.map((body) => Math.hypot(body.x, body.z)), 0);
  const at = projector(most);
  const systemName = (wanted: number) => systems.find((entry) => entry.id === wanted)?.name ?? String(wanted);
  const home: Record<string, [number, number]> = {};

  for (const planet of one.planets) {
    const here = at([planet.x, planet.z]);
    const key = keyOf(planet.name);
    home[key] = here;
    units[key] = {
      icon: 'planet',
      label: planet.name,
      model: planet.typeName,
      attributes: { facts: [{ label: 'type', value: planet.typeName }] },
      at: { record: here },
    };
    const mostMoon = Math.max(...planet.moons.map((moon) => Math.hypot(moon.x - planet.x, moon.z - planet.z)), 0);
    for (const moon of planet.moons) {
      units[keyOf(moon.name)] = { icon: 'moon', label: moon.name, at: { record: around(here, moon, planet, mostMoon, 5) } };
    }
    const mostBelt = Math.max(...planet.belts.map((belt) => Math.hypot(belt.x - planet.x, belt.z - planet.z)), 0);
    for (const belt of planet.belts) {
      units[keyOf(belt.name)] = { icon: 'belt', label: belt.name, at: { record: around(here, belt, planet, mostBelt, 8) } };
    }
  }

  for (const gate of one.gates) {
    const to = systemName(gate.to);
    // The market run reads a neighbour through the gate that leads to it, so that gate carries the neighbour's name.
    const dest = slug(to);
    const key = dest !== id && namedByMarket.has(dest) && !taken.has(dest) ? dest : keyOf(to);
    taken.add(key);
    units[key] = { icon: 'gate', label: `to ${to}`, at: { record: at([gate.x, gate.z]) } };
  }

  for (const station of one.stations) {
    const key = station.id === MARKET_STATION ? 'jita-4-4' : keyOf(station.name);
    taken.add(key);
    home[key] = at([station.x, station.z]);
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
    // The fleet stands in the system it fought in, round its star.
    roster.forEach((pilot, index) => {
      units[pilot.id] = {
        icon: 'person',
        label: pilot.name,
        role: pilot === commander ? 'admin' : 'member',
        at: { record: offsetOf(MIDDLE, [-34 + (index % 4) * 22, -26 + Math.floor(index / 4) * 20]) },
      };
    });
    hulls.forEach((hull, index) => {
      units[slug(hull)] = { icon: 'hauler', label: hull, at: { record: offsetOf(MIDDLE, [-92, -20 + index * 24]) } };
    });
  }

  if (id === 'jita') {
    // The pilot who takes the market work stands at the station the order is at.
    units.saltyfish11 = {
      icon: 'person',
      label: 'saltyfish11',
      role: 'admin',
      at: { record: offsetOf(home['jita-4-4'] ?? MIDDLE, [16, 12]) },
    };
  }

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
