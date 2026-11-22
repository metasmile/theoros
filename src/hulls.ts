import * as THREE from 'three';

// The shapes a mark is drawn with, built from primitives and shared by every mark of a kind and variant.
//
// MESH.md states the contract these keep: no imported model, no loader, at most 3,000 triangles, largest dimension
// 0.08 units, nose at -Z, and identity from props rather than from a constant. The scene carries no lights, so the
// shading is baked into vertex colours and the material's colour multiplies it: a pick changes the colour and leaves
// the geometry alone.

/** The kinds of mark this builds a shape for. A system is drawn as a point of light elsewhere. */
export type MarkKind = 'hauler' | 'station' | 'gate' | 'planet' | 'moon' | 'belt';

/** One primitive of an assembly: its shape, where it sits, how it turns, and how bright its plates read. */
type Part = {
  shape: THREE.BufferGeometry;
  at?: [number, number, number];
  turn?: [number, number, number];
  tone?: number;
};

const ORIGIN: [number, number, number] = [0, 0, 0];
const STRAIGHT: [number, number, number] = [0, 0, 0];

/** The one light a hull's shading is baked from: high, ahead of the port side, and a little behind the nose. */
const LIGHT = new THREE.Vector3(-0.45, 0.78, 0.44).normalize();

/** How much of a face's brightness comes from the ambient term rather than from the light on it. */
const AMBIENT = 0.4;

/**
 * Fold an assembly into one geometry with the shading written into its vertex colours.
 *
 * Faces stay flat, so the parts are expanded rather than indexed: a box whose corners shared a normal would read
 * as a pillow, and every edge in these hulls is there to be seen.
 */
function bake(parts: Part[]): THREE.BufferGeometry {
  const positions: number[] = [];
  const colours: number[] = [];
  const corners = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const along = new THREE.Vector3();
  const across = new THREE.Vector3();
  const face = new THREE.Vector3();
  const place = new THREE.Matrix4();
  const turn = new THREE.Quaternion();
  const one = new THREE.Vector3(1, 1, 1);
  const sit = new THREE.Vector3();

  for (const part of parts) {
    const flat = part.shape.toNonIndexed();
    sit.set(...(part.at ?? ORIGIN));
    turn.setFromEuler(new THREE.Euler(...(part.turn ?? STRAIGHT)));
    flat.applyMatrix4(place.compose(sit, turn, one));
    const source = flat.getAttribute('position');
    for (let index = 0; index < source.count; index += 3) {
      for (let corner = 0; corner < 3; corner += 1) corners[corner].fromBufferAttribute(source, index + corner);
      along.subVectors(corners[1], corners[0]);
      across.subVectors(corners[2], corners[0]);
      face.crossVectors(along, across).normalize();
      const lit = AMBIENT + (1 - AMBIENT) * Math.max(0, face.dot(LIGHT));
      const value = Math.min(1, (part.tone ?? 1) * lit);
      for (const corner of corners) {
        positions.push(corner.x, corner.y, corner.z);
        colours.push(value, value, value);
      }
    }
    flat.dispose();
    part.shape.dispose();
  }

  const made = new THREE.BufferGeometry();
  made.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  made.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
  made.computeBoundingSphere();
  return made;
}

const box = (width: number, height: number, depth: number) => new THREE.BoxGeometry(width, height, depth);
const drum = (radius: number, length: number, sides: number) =>
  new THREE.CylinderGeometry(radius, radius, length, sides);

/** A plate laid on a face: thin, slightly proud, and darker than the hull so the seam reads as a seam. */
function plate(parts: Part[], width: number, height: number, depth: number, at: [number, number, number], tone: number) {
  parts.push({ shape: box(width, height, depth), at, tone });
}

/**
 * A freighter: a spine carrying containers, a bridge over the nose, and two drives on outriggers.
 *
 * The nose is at -Z and the hull is 0.073 long, which is what a mark on a shell of radius 1.25 is allowed to be. It
 * reads as a hauler rather than as a pointed ship because the cargo deck is the widest thing on it.
 */
function haulerBase(): Part[] {
  const parts: Part[] = [
    { shape: box(0.03, 0.01, 0.038), at: [0, 0, 0.004], tone: 0.92 },
    { shape: box(0.02, 0.012, 0.02), at: [0, 0, -0.025] },
    { shape: new THREE.ConeGeometry(0.01, 0.016, 6), at: [0, 0, -0.03], turn: [-Math.PI / 2, 0, 0], tone: 1.1 },
    // Cheek plates widen the nose into a wedge, so the plan view is not a tube with a point on it.
    { shape: box(0.005, 0.008, 0.018), at: [-0.012, 0, -0.022], tone: 0.84 },
    { shape: box(0.005, 0.008, 0.018), at: [0.012, 0, -0.022], tone: 0.84 },
    // The containers sit recessed on the deck, so the deck reads as a deck.
    { shape: box(0.024, 0.008, 0.013), at: [0, 0.008, -0.002], tone: 0.7 },
    { shape: box(0.024, 0.008, 0.013), at: [0, 0.008, 0.013], tone: 0.7 },
    { shape: box(0.009, 0.006, 0.009), at: [0, 0.01, -0.02], tone: 1.16 },
    { shape: box(0.006, 0.004, 0.018), at: [0, 0.011, 0.004], tone: 0.58 },
    { shape: box(0.003, 0.009, 0.012), at: [0, -0.009, 0.02], tone: 0.8 },
    { shape: box(0.032, 0.013, 0.009), at: [0, 0, 0.03], tone: 0.88 },
  ];
  // A belt of plates down each flank, a lit band behind the prow, and a recessed keel: the three values that make a
  // flat side read as structure at the size a mark is drawn.
  plate(parts, 0.031, 0.003, 0.005, [0, 0.006, -0.012], 1.04);
  plate(parts, 0.002, 0.006, 0.02, [-0.016, 0, -0.002], 0.7);
  plate(parts, 0.002, 0.006, 0.02, [0.016, 0, -0.002], 0.7);
  plate(parts, 0.014, 0.002, 0.006, [0, -0.006, -0.016], 0.62);
  for (const side of [-1, 1]) {
    parts.push({ shape: box(0.011, 0.003, 0.007), at: [side * 0.012, 0.001, 0.014], tone: 0.66 });
    parts.push({
      shape: drum(0.005, 0.026, 6),
      at: [side * 0.018, 0.002, 0.014],
      turn: [Math.PI / 2, 0, 0],
      tone: 0.96,
    });
  }
  return parts;
}

/**
 * The kit a hull is fitted out with, one set a ship.
 *
 * A fleet is one silhouette repeated, and three hulls that read as one box are three names without three ships. The
 * variant is chosen from the ship's own name (`haulerVariant`), so a hull keeps its shape wherever it is drawn.
 */
function haulerFit(variant: number): Part[] {
  const parts: Part[] = [];
  if (variant === 0) {
    // Freight: fins over the deck and radiators on the flanks, which is the widest plan of the four.
    for (const side of [-1, 1]) {
      parts.push({ shape: box(0.002, 0.012, 0.016), at: [side * 0.007, 0.014, 0.012], turn: [0, 0, -side * 0.22], tone: 0.78 });
      parts.push({ shape: box(0.0015, 0.018, 0.022), at: [side * 0.018, 0.003, -0.004], turn: [0, 0, -side * 0.1], tone: 0.5 });
    }
    plate(parts, 0.026, 0.002, 0.003, [0, 0.013, 0.006], 0.86);
  } else if (variant === 1) {
    // Armoured: a prow of angled plates, skirts down the flanks, and a turret ring on the deck.
    for (const side of [-1, 1]) {
      parts.push({ shape: box(0.005, 0.006, 0.012), at: [side * 0.0065, 0.006, -0.026], turn: [0, -side * 0.2, 0], tone: 1.0 });
      parts.push({ shape: box(0.002, 0.012, 0.03), at: [side * 0.017, -0.004, -0.004], tone: 0.6 });
    }
    parts.push({ shape: box(0.016, 0.003, 0.014), at: [0, -0.011, 0.006], tone: 0.72 });
    parts.push({ shape: drum(0.005, 0.004, 8), at: [0, 0.014, -0.012], tone: 0.9 });
  } else if (variant === 2) {
    // Recon: a boom ahead of the prow and a mast with a dish, which is the only silhouette with a line above it.
    parts.push({ shape: box(0.002, 0.002, 0.008), at: [-0.006, 0.002, -0.038], tone: 1.1 });
    parts.push({ shape: box(0.004, 0.004, 0.004), at: [-0.006, 0.005, -0.036], tone: 0.95 });
    parts.push({ shape: box(0.002, 0.016, 0.002), at: [0.005, 0.014, 0.012], turn: [0.3, 0, 0], tone: 0.85 });
    parts.push({ shape: drum(0.006, 0.002, 10), at: [0.006, 0.022, 0.014], turn: [0.5, 0, 0], tone: 1.12 });
    parts.push({ shape: box(0.01, 0.003, 0.008), at: [0, 0.014, 0.024], tone: 0.7 });
  } else {
    // Twin: two tail booms with fins, and a second row of containers between them.
    for (const side of [-1, 1]) {
      parts.push({ shape: drum(0.003, 0.016, 6), at: [side * 0.011, 0.004, 0.03], turn: [Math.PI / 2, 0, 0], tone: 0.9 });
      parts.push({ shape: box(0.002, 0.01, 0.006), at: [side * 0.011, 0.01, 0.036], tone: 0.8 });
    }
    parts.push({ shape: box(0.018, 0.006, 0.012), at: [0, 0.014, 0.02], tone: 0.66 });
  }
  return parts;
}

/** The two exhausts, kept apart because they are a colour the hull's material cannot carry. */
function exhaustParts(): Part[] {
  return [-1, 1].map((side) => ({
    shape: new THREE.CircleGeometry(0.0045, 10),
    at: [side * 0.018, 0.002, 0.0348] as [number, number, number],
  }));
}

/**
 * A station: a core, the ring it turns inside, four spokes, and the mast a ship berths along.
 *
 * A station is recognised by its silhouette, so the ring and the mast are the shape and the core is what holds
 * them. It is 0.06 across, which keeps it the size of the other marks on the shell.
 */
function stationParts(): Part[] {
  const parts: Part[] = [
    { shape: box(0.016, 0.014, 0.016) },
    { shape: new THREE.TorusGeometry(0.026, 0.0035, 5, 16), turn: [Math.PI / 2, 0, 0], tone: 0.74 },
    { shape: box(0.004, 0.004, 0.016), at: [0, 0, -0.02], tone: 0.9 },
    { shape: box(0.01, 0.01, 0.004), at: [0, 0, -0.03], tone: 1.14 },
    // The panels are angled opposite ways, so one catches the light more than the other.
    { shape: box(0.002, 0.013, 0.01), at: [-0.013, 0, 0.002], turn: [0, 0, 0.18], tone: 0.62 },
    { shape: box(0.002, 0.013, 0.01), at: [0.013, 0, 0.002], turn: [0, 0, -0.18], tone: 0.62 },
    // A docking collar and two habitat drums make the ring a place a ship goes rather than a hoop.
    { shape: drum(0.006, 0.004, 8), at: [0, 0, 0.012], turn: [Math.PI / 2, 0, 0], tone: 1.06 },
    { shape: drum(0.005, 0.01, 8), at: [0, 0.021, 0], turn: [0, 0, Math.PI / 2], tone: 0.86 },
    { shape: drum(0.005, 0.01, 8), at: [0, -0.021, 0], turn: [0, 0, Math.PI / 2], tone: 0.86 },
    { shape: box(0.026, 0.0015, 0.008), at: [0, 0.006, 0.014], turn: [0, 0, 0.2], tone: 0.5 },
  ];
  for (const quarter of [0, 1, 2, 3]) {
    const angle = (quarter * Math.PI) / 2;
    parts.push({
      shape: box(0.022, 0.003, 0.004),
      at: [Math.cos(angle) * 0.012, 0, Math.sin(angle) * 0.012],
      turn: [0, -angle, 0],
      tone: 0.8,
    });
  }
  return parts;
}

/**
 * A gate: the frame a hauler passes through, the aperture inside it, and the arm it stands on.
 *
 * The two rings are separate so the aperture reads as light rather than as more metal, which is what tells a gate
 * from a ring at this size.
 */
function gateParts(): Part[] {
  const parts: Part[] = [
    { shape: new THREE.TorusGeometry(0.02, 0.0032, 5, 18), turn: [Math.PI / 2, 0, 0], tone: 0.86 },
    { shape: new THREE.TorusGeometry(0.013, 0.0016, 4, 14), turn: [Math.PI / 2, 0, 0], tone: 1.2 },
    { shape: box(0.005, 0.01, 0.005), at: [0, -0.024, 0], tone: 0.72 },
    { shape: box(0.014, 0.005, 0.009), at: [0, -0.03, 0], tone: 0.64 },
    // Four anchors and a collar, so the ring is a mechanism rather than a circle.
    { shape: new THREE.TorusGeometry(0.0165, 0.002, 4, 12), turn: [Math.PI / 2, 0, 0], tone: 0.6 },
  ];
  for (const quarter of [0, 1, 2, 3]) {
    const angle = (quarter * Math.PI) / 2 + Math.PI / 4;
    parts.push({
      shape: box(0.006, 0.004, 0.004),
      at: [Math.cos(angle) * 0.019, 0, Math.sin(angle) * 0.019],
      turn: [0, -angle, 0],
      tone: 0.94,
    });
  }
  for (const side of [-1, 1]) {
    parts.push({ shape: box(0.006, 0.003, 0.004), at: [side * 0.011, 0.017, 0], turn: [0, 0, side * 0.6], tone: 0.78 });
    parts.push({ shape: box(0.004, 0.003, 0.006), at: [side * 0.011, 0.019, 0.004], tone: 0.7 });
  }
  return parts;
}

/** A planet: a shaded body with one lit band, which is what tells it from a moon at a mark's size. */
function planetParts(): Part[] {
  return [
    { shape: new THREE.SphereGeometry(0.02, 18, 12), tone: 1 },
    { shape: new THREE.TorusGeometry(0.021, 0.0012, 4, 24), turn: [Math.PI / 2, 0, 0], tone: 1.12 },
  ];
}

/** A moon: a body small enough that the orbit it stands in is what says what it is. */
function moonParts(): Part[] {
  return [{ shape: new THREE.SphereGeometry(0.016, 12, 8), tone: 0.95 }];
}

/** A belt: the ring its rocks are spread along. */
function beltParts(): Part[] {
  return [{ shape: new THREE.TorusGeometry(0.02, 0.0024, 4, 20), turn: [Math.PI / 2, 0, 0], tone: 1.2 }];
}

/** How many shapes a kind is drawn in. A structure is one, a hull is four. */
const VARIANTS: Record<MarkKind, number> = { hauler: 4, station: 1, gate: 1, planet: 1, moon: 1, belt: 1 };

/**
 * The variant a ship is drawn in, from its own name.
 *
 * A hull is named once and drawn many times, so the name is the whole seed: the same ship is the same ship on every
 * screen, and a fleet of three names is a fleet of three shapes.
 */
export function haulerVariant(name: string): number {
  // FNV-1a, because it spreads three names the capture holds across three variants.
  let hash = 2166136261;
  for (const letter of name) {
    hash ^= letter.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % VARIANTS.hauler;
}

const PARTS: Record<MarkKind, (variant: number) => Part[]> = {
  hauler: (variant) => [...haulerBase(), ...haulerFit(variant)],
  station: stationParts,
  gate: gateParts,
  planet: planetParts,
  moon: moonParts,
  belt: beltParts,
};

const shapes = new Map<string, THREE.BufferGeometry>();

/**
 * The geometry for one kind of mark and variant, built on first use and shared afterwards.
 *
 * A hull is the same object on every mark of its kind and variant, so eleven haulers are four geometries and eleven
 * draws, and a pick only changes the material's colour.
 */
export function markGeometry(kind: MarkKind | 'exhaust', variant = 0): THREE.BufferGeometry {
  const shape = kind === 'exhaust' ? 0 : variant % VARIANTS[kind];
  const key = `${kind}:${shape}`;
  const cached = shapes.get(key);
  if (cached) return cached;
  const made = bake(kind === 'exhaust' ? exhaustParts() : PARTS[kind](shape));
  shapes.set(key, made);
  return made;
}
