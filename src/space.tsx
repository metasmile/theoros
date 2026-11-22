import { Canvas, useFrame, useLoader } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import * as THREE from 'three';
import { ChevronLeft, ChevronRight, Minus, Plus, RotateCcw, Sun } from 'lucide-react';
import sky from '../assets/sky.jpg?url';
import { inkOf } from './ink';
import {
  LEVEL,
  fitView,
  forwardOf,
  onShell,
  project,
  sectorOf,
} from '@ssccsorg/skene-board';
import { registerReading, type Board } from '@ssccsorg/skene-frame/lib/readings';
import { SphereMinimap, type SphereMark } from '@ssccsorg/skene-frame/components/SphereMinimap';
import { useScenario } from '@ssccsorg/skene-frame/stores/scenario';
import { cn } from '@ssccsorg/skene-ui';
import { haulerVariant, markGeometry } from './hulls';
import { useView } from './view';

// New Eden, read from the pilot's seat: the stars behind, the systems the run stands in, and the route each
// unit has taken. It is the project's own sphere rather than the frame's, so the place's ground is not drawn.

/** How far a pointer travels before a press is a drag rather than a pick, on the canvas and on the map. */
const DRAG = 4;

/** How wide the fit is given the system's own star, in shell radii: the pane holds a body rather than a point. */
const BODY = 0.42;
/** How far behind the place the star stands, in shell radii: the place's own marks are read in front of it. */
const SUN = 2.2;

/** How far behind the place the region's other systems stand, in shell radii. */
const REGION = 240;

/** A star's face: bright at the middle and warmer at the limb, which is the one thing a lit sphere of one colour is not. */
const STAR_VERTEX = `
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    vNormal = normalize(normalMatrix * normal);
    vec4 seen = modelViewMatrix * vec4(position, 1.0);
    vView = normalize(-seen.xyz);
    gl_Position = projectionMatrix * seen;
  }
`;

const STAR_FRAGMENT = `
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    float rim = 1.0 - max(dot(vNormal, vView), 0.0);
    vec3 face = mix(vec3(1.0, 0.97, 0.90), vec3(1.0, 0.68, 0.28), pow(rim, 1.7));
    gl_FragColor = vec4(face, 1.0);
  }
`;

/**
 * The sky the seat is under.
 *
 * An equirectangular panorama wrapped inside a sphere the camera stands in, so turning the view turns within one photograph
 * rather than within a scatter of generated points. ESO/S. Brunier, CC BY 4.0, credited in the demonstration card.
 */
function Sky() {
  const texture = useLoader(THREE.TextureLoader, sky);
  useEffect(() => {
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
  }, [texture]);
  // BackSide draws the inside of the sphere; the x flip undoes the mirror that comes with it.
  return (
    <mesh scale={[-1, 1, 1]} renderOrder={-1}>
      <sphereGeometry args={[900, 60, 40]} />
      <meshBasicMaterial map={texture} side={THREE.BackSide} depthWrite={false} toneMapped={false} />
    </mesh>
  );
}

/**
 * The star points in front of the sky.
 *
 * A graphic layer rather than a catalogue: the photograph carries the band and the nebula, and what it cannot carry at
 * this size is a field of points with a spread of brightness. Most are faint and a few are bright, because that spread
 * is what reads as stars rather than as noise.
 */
function Stars() {
  const geometry = useMemo(() => {
    const count = 2400;
    const positions = new Float32Array(count * 3);
    const colours = new Float32Array(count * 3);
    // Seeded, so a re-render is the same sky and a screenshot is reproducible.
    let seed = 1291;
    const next = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let index = 0; index < count; index += 1) {
      const azimuth = next() * Math.PI * 2;
      const elevation = Math.acos(2 * next() - 1);
      const radius = 820 + next() * 40;
      const flat = Math.sin(elevation) * radius;
      positions[index * 3] = flat * Math.cos(azimuth);
      positions[index * 3 + 1] = Math.cos(elevation) * radius;
      positions[index * 3 + 2] = flat * Math.sin(azimuth);
      const light = 0.22 + next() ** 6 * 0.78;
      colours[index * 3] = light;
      colours[index * 3 + 1] = light;
      colours[index * 3 + 2] = Math.min(1, light * 1.06);
    }
    const made = new THREE.BufferGeometry();
    made.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    made.setAttribute('color', new THREE.BufferAttribute(colours, 3));
    return made;
  }, []);
  useEffect(() => () => geometry.dispose(), [geometry]);
  // Screen-sized rather than world-sized: a star does not grow as the view is turned toward it.
  return (
    <points geometry={geometry}>
      <pointsMaterial
        size={1.8}
        sizeAttenuation={false}
        vertexColors
        transparent
        opacity={0.9}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}

/** The pilot's own camera, kept in step with this reading's view: the field and the names share it. */
function Pilot({ camera }: { camera: RefObject<THREE.PerspectiveCamera | null> }) {
  useFrame(() => {
    const view = useView.getState();
    const made = camera.current;
    if (!made) return;
    made.fov = view.fov;
    made.updateProjectionMatrix();
    made.lookAt(...forwardOf(view));
  });
  return null;
}

/**
 * A hauler: the freighter hull from `hulls.ts`, with the two exhausts drawn as light rather than as metal.
 *
 * The nose points at -Z, because that is the camera's forward, and the heading turns the hull onto its path. The fit-out
 * comes from the ship's name, so a fleet of three names is three hulls rather than one silhouette three times.
 */
function Hauler({ colour, heading, variant }: { colour: string; heading: number; variant: number }) {
  return (
    <group rotation={[0, heading, 0]}>
      <mesh geometry={markGeometry('hauler', variant)}>
        <meshBasicMaterial color={colour} vertexColors />
      </mesh>
      <mesh geometry={markGeometry('exhaust')}>
        <meshBasicMaterial
          color="#7fd8e8"
          transparent
          opacity={0.85}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}

/** A station, a gate, a planet, a moon and a belt: one geometry each, shared by every mark of that kind. */
function Structure({ kind, colour }: { kind: 'station' | 'gate' | 'planet' | 'moon' | 'belt'; colour: string }) {
  return (
    <mesh geometry={markGeometry(kind)}>
      <meshBasicMaterial color={colour} vertexColors />
    </mesh>
  );
}

/** One unit as this board draws it: where it stands, what it is, and where it is pointed. */
interface Marked {
  id: string;
  label: string | null;
  icon: string | null;
  /** What the place says the unit is drawn as: a planet's type, a station's type, or nothing. */
  model: string | null;
  heading: number;
  at: [number, number, number];
}

/**
 * One entity's mark. What the unit is decides the silhouette, and the pick stays with the caller.
 *
 * A sphere for every kind is what made the space read as a scatter of dots: a system is a faceted body, a station is a
 * structure, a gate is the ring it opens, and a hauler is a hull.
 */
function Mark({ system, picked, onPick }: { system: Marked; picked: boolean; onPick: (id: string) => void }) {
  // The palette the board and the inventory share, so a body keeps its colour wherever it is drawn; a picked unit is
  // white, because the pick is the reading and not the kind.
  const colour = picked ? '#ffffff' : (inkOf(system.icon) ?? '#8fb2e8');
  return (
    <group
      position={system.at}
      // A press that travels is the camera's, so the pick waits for a release that did not: a drag beginning on a mark
      // would otherwise pick it, and the frame turns the shell to whatever is picked.
      onClick={(event) => {
        if (event.delta > DRAG) return;
        event.stopPropagation();
        onPick(system.id);
      }}
    >
      {system.icon === 'hauler' ? (
        <Hauler colour={colour} heading={system.heading} variant={haulerVariant(system.label ?? system.id)} />
      ) : system.icon === 'station' ? (
        <Structure kind="station" colour={colour} />
      ) : system.icon === 'gate' ? (
        <Structure kind="gate" colour={colour} />
      ) : system.icon === 'planet' ? (
        <Structure kind="planet" colour={colour} />
      ) : system.icon === 'moon' ? (
        <Structure kind="moon" colour={colour} />
      ) : system.icon === 'belt' ? (
        <Structure kind="belt" colour={colour} />
      ) : (
        <mesh>
          {/* A system is a point of light. It is drawn as a small body and not as a glowing one: an additive point is a
              soft disc at close range, and a row of them washed the names under it into one pale smear. */}
          <sphereGeometry args={[0.006, 10, 8]} />
          <meshBasicMaterial color={colour} />
        </mesh>
      )}
    </group>
  );
}

/**
 * The system the pilot is in, drawn as what it is.
 *
 * A point of light at a place's own middle says nothing about the place, and one system's project is that system. The star
 * is a sphere, the halo is a sprite rather than another sphere, and the planets are derived from the system's own id so
 * one system is always the same system. Nothing orbits: the pane is a reading, not a clock.
 */
function SystemBody({ at, seed, glow }: { at: [number, number, number]; seed: string; glow: THREE.Texture }) {
  const worlds = useMemo(() => {
    let state = 0;
    for (const letter of seed) state = (state * 31 + letter.charCodeAt(0)) % 100003;
    const next = () => ((state = (state * 16807) % 2147483647) / 2147483647);
    return Array.from({ length: 3 }, (_, index) => ({
      orbit: (0.045 + next() * 0.02 + index * 0.022) * SUN,
      tilt: (next() - 0.5) * 1.2,
      turn: next() * Math.PI * 2,
      angle: next() * Math.PI * 2,
      size: 0.03 + next() * 0.02 + index * 0.004,
    }));
  }, [seed]);

  return (
    <group position={[at[0] * SUN, at[1] * SUN, at[2] * SUN]}>
      {/* The star is drawn at a size the innermost band of worlds clears, glow included: at this distance the face spans
          three and a third degrees of the pane and the halo a little more, where a bigger star put the first ring of
          worlds on its own surface. */}
      <sprite scale={[0.36, 0.36, 1]}>
        <spriteMaterial
          map={glow}
          color="#ffb877"
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          opacity={0.85}
        />
      </sprite>
      <mesh>
        <sphereGeometry args={[0.16, 48, 32]} />
        <shaderMaterial vertexShader={STAR_VERTEX} fragmentShader={STAR_FRAGMENT} toneMapped={false} />
      </mesh>
      {worlds.map((world, index) => (
        <group key={index} rotation={[world.tilt, world.turn, 0]}>
          <mesh>
            <ringGeometry args={[world.orbit - 0.002, world.orbit + 0.002, 128]} />
            <meshBasicMaterial
              color="#7f93ab"
              transparent
              opacity={0.18}
              side={THREE.DoubleSide}
              depthWrite={false}
            />
          </mesh>
          <mesh
            position={[Math.cos(world.angle) * world.orbit, Math.sin(world.angle) * world.orbit, 0]}
          >
            <sphereGeometry args={[world.size, 20, 14]} />
            <meshBasicMaterial color={['#c3d2e2', '#a9bacd', '#d0bda4'][index]} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function Route({ points }: { points: [number, number, number][] }) {
  const line = useMemo(() => {
    const geometry = new THREE.BufferGeometry().setFromPoints(
      points.map(([x, y, z]) => new THREE.Vector3(x, y, z)),
    );
    return new THREE.Line(
      geometry,
      new THREE.LineBasicMaterial({ color: '#3d5f8f', transparent: true, opacity: 0.55 }),
    );
  }, [points]);
  useEffect(
    () => () => {
      line.geometry.dispose();
      (line.material as THREE.Material).dispose();
    },
    [line],
  );
  return <primitive object={line} />;
}

/** A name is placed with the projection the camera is given, so it cannot stand beside another mark. */
/**
 * The marks as the reader touches them.
 *
 * A point is two pixels, which is not a target. Every unit gets a circle of its own in the layer above the canvas: a
 * ring on hover or when picked, the name where there is room for one, and a card beside it saying what the unit is.
 * The drawing stays in the canvas; only the touching is here.
 */
function Overlay({
  systems,
  pickedId,
  onPick,
}: {
  systems: Marked[];
  pickedId: string | null;
  onPick: (id: string) => void;
}) {
  const yaw = useView((state) => state.yaw);
  const pitch = useView((state) => state.pitch);
  const fov = useView((state) => state.fov);
  const frame = useView((state) => state.frame);
  const [hovered, setHovered] = useState<string | null>(null);
  // Where the press began, so a name dragged off is a turn of the camera rather than a pick.
  const pressed = useRef<[number, number] | null>(null);
  if (!frame[0] || !frame[1]) return null;

  const middle: [number, number] = [frame[0] / 2, frame[1] / 2];
  const points = systems
    .map((system) => {
      const [x, y, depth] = project(system.at, frame[0], frame[1], { yaw, pitch, fov });
      return { system, x, y, depth, away: Math.hypot(x - middle[0], y - middle[1]) };
    })
    .filter((point) => point.depth > 0);

  // A name is drawn only where it does not land on one already drawn.
  const named: typeof points = [];
  for (const point of [...points].sort((left, right) => left.away - right.away)) {
    if (named.length >= 12) break;
    if (point.away < Math.min(frame[0], frame[1]) * 0.55 && named.every((other) => Math.hypot(other.x - point.x, other.y - point.y) > 64)) {
      named.push(point);
    }
  }
  const labelled = new Set(named.map((point) => point.system.id));
  const card = points.find((point) => point.system.id === hovered);

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {points.map(({ system, x, y }) => (
        <button
          key={system.id}
          type="button"
          onPointerEnter={() => setHovered(system.id)}
          onPointerLeave={() => setHovered((now) => (now === system.id ? null : now))}
          onPointerDown={(event) => {
            pressed.current = [event.clientX, event.clientY];
          }}
          onClick={(event) => {
            const from = pressed.current;
            if (from && Math.hypot(event.clientX - from[0], event.clientY - from[1]) > DRAG) return;
            onPick(system.id);
          }}
          className="pointer-events-auto absolute flex items-center justify-center"
          style={{ left: x, top: y, width: 24, height: 24, transform: 'translate(-50%, -50%)' }}
        >
          {hovered === system.id || pickedId === system.id ? (
            <span
              className={cn(
                'block rounded-full border',
                pickedId === system.id ? 'size-6 border-foreground/70' : 'size-5 border-foreground/40',
              )}
            />
          ) : null}
          {labelled.has(system.id) ? (
            <span
              className={cn(
                'pointer-events-none absolute top-full left-1/2 -translate-x-1/2 whitespace-nowrap text-[10px] tracking-wide',
                system.id === pickedId || hovered === system.id ? 'text-foreground' : 'text-muted-foreground',
              )}
            >
              {system.label ?? system.id}
            </span>
          ) : null}
        </button>
      ))}
      {card ? (
        <div
          className="pointer-events-none absolute rounded border border-border/70 bg-card/95 px-2 py-1 text-[11px] shadow-lg"
          style={{ left: card.x + 16, top: card.y + 12 }}
        >
          <span className="block text-foreground">{card.system.label ?? card.system.id}</span>
          <span className="block text-muted-foreground">{card.system.icon ?? 'unit'}</span>
        </div>
      ) : null}
    </div>
  );
}

function EveSpace({ world, pickedId, onPick }: Board) {
  const box = useRef<HTMLDivElement>(null);
  const camera = useRef<THREE.PerspectiveCamera | null>(null);
  const drag = useRef<{ id: number; x: number; y: number } | null>(null);
  const turn = useView((state) => state.turn);
  const zoom = useView((state) => state.zoom);
  const fit = useView((state) => state.fit);
  const release = useView((state) => state.release);
  const held = useView((state) => state.held);
  const frame = useView((state) => state.frame);
  const setFrame = useView((state) => state.setFrame);
  const yaw = useView((state) => state.yaw);
  const pitch = useView((state) => state.pitch);
  const fov = useView((state) => state.fov);
  const face = useView((state) => state.face);
  const projectId = useScenario((state) => state.projectId);
  const projects = useScenario((state) => state.projects);

  const aspect = world?.aspect ?? 2;
  const sector = world?.sector ?? ([0, 0] as [number, number]);
  // A pick is a seat. The chosen unit becomes the origin and everything else is drawn relative to it, which is what
  // makes the shell the world that unit looks at rather than the one the pilot happens to be standing in.
  const [seatId, setSeatId] = useState<string | null>(null);
  // A pick from anywhere opens the seat, and the toolbar can move it to a neighbour or back to the third person without
  // asking the panel to clear a selection the frame has no verb for.
  useEffect(() => {
    setSeatId(pickedId ?? null);
  }, [pickedId]);
  const seat = useMemo(() => {
    // A system is the place itself, so seating on it would put the camera inside the star. The pane stays where it is.
    if (!seatId || !world || seatId === projectId) return null;
    const found = world.present.find((unit) => unit.id === seatId);
    return found ? onShell(found.path[found.path.length - 1] ?? found.at, world) : null;
  }, [seatId, world, aspect, sector, projectId]);
  const shift = (point: [number, number, number]): [number, number, number] =>
    seat ? [point[0] - seat[0], point[1] - seat[1], point[2] - seat[2]] : point;
  const ground = useMemo(() => {
    if (!world) return [];
    const units = world.standing.filter((unit) => unit.icon !== 'person').map((unit) => onShell(unit.path[unit.path.length - 1] ?? unit.at, world));
    // A system is drawn as a body, so the fit is given the star's own width: a lone system fills the pane rather than
    // standing at a point, and a place that holds a fleet still fits the fleet.
    const own = world.standing.find((unit) => unit.id === projectId);
    if (!own) return units.map(shift);
    const [x, y, z] = onShell(own.at, world);
    const extent: [number, number, number][] = [
      [x + BODY, y, z],
      [x - BODY, y, z],
      [x, y + BODY, z],
      [x, y - BODY, z],
    ];
    return [...units, ...extent].map(shift);
  }, [world, aspect, sector, seat, projectId]);
  const systems = useMemo<Marked[]>(
    () =>
      world
        ? world.present
            .filter((unit) => unit.icon !== 'person')
            .map((unit) => {
              // The last leg of the path is where the hull is pointed. A unit that has not moved faces the way the camera does.
              const path = unit.path;
              const [from, to] = [path[path.length - 2], path[path.length - 1]];
              const heading =
                from && to ? Math.atan2(-(to[0] - from[0]), -(to[2] - from[2])) : 0;
              return {
                id: unit.id,
                label: unit.label,
                icon: unit.icon,
                model: unit.model ?? null,
                heading,
                at: shift(onShell(unit.path[unit.path.length - 1] ?? unit.at, world)),
              };
            })
        : [],
    [world, aspect, sector, seat],
  );
  const stars = useMemo<Marked[]>(
    () => systems.filter((system) => system.icon === 'system' && system.id !== projectId),
    [systems, projectId],
  );
  // The system the pilot is in stands as a body rather than a point: it is the place, and a point of light at a place's
  // own middle says nothing about what the place is.
  const own = useMemo(() => systems.find((system) => system.id === projectId) ?? null, [systems, projectId]);
  const bodies = useMemo<Marked[]>(() => systems.filter((system) => system.icon !== 'system'), [systems]);
  // One Points object for every star: ninety meshes became ninety draw calls whose size followed the distance, so the
  // near ones were discs and the far ones specks. A star map draws points at one size and that is what this is.
  // A point with no map is a square, which reads as a pixel rather than a star. The glow is drawn into a canvas at
  // load, so the field needs no image and no loader.
  const starSprite = useMemo(() => {
    const size = 32;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext('2d');
    if (context) {
      const glow = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
      glow.addColorStop(0, 'rgba(255,255,255,1)');
      glow.addColorStop(0.35, 'rgba(255,255,255,0.8)');
      glow.addColorStop(1, 'rgba(255,255,255,0)');
      context.fillStyle = glow;
      context.fillRect(0, 0, size, size);
    }
    const made = new THREE.CanvasTexture(canvas);
    made.colorSpace = THREE.SRGBColorSpace;
    return made;
  }, []);
  useEffect(() => () => starSprite.dispose(), [starSprite]);
  const starGeometry = useMemo(() => {
    if (!stars.length) return null;
    const made = new THREE.BufferGeometry();
    made.setAttribute('position', new THREE.BufferAttribute(new Float32Array(stars.flatMap((star) => star.at)), 3));
    return made;
  }, [stars]);
  useEffect(() => () => starGeometry?.dispose(), [starGeometry]);
  // The region behind the place: every other project stands at the bearing the board holds for it, so turning the pane is
  // looking across the region rather than across an empty sky.
  const regionGeometry = useMemo(() => {
    const points = projects
      .filter((entry) => entry.id !== projectId)
      .flatMap((entry) => {
        const [yaw, pitch] = sectorOf(entry.place);
        return forwardOf({ yaw, pitch }).map((axis) => axis * REGION);
      });
    if (!points.length) return null;
    const made = new THREE.BufferGeometry();
    made.setAttribute('position', new THREE.BufferAttribute(new Float32Array(points), 3));
    return made;
  }, [projects, projectId]);
  useEffect(() => () => regionGeometry?.dispose(), [regionGeometry]);
  // The disc's own marks: the units this pane draws, where the place puts them.
  const marks = useMemo<SphereMark[]>(() => {
    return systems.map((system) => ({
      id: system.id,
      label: system.label ?? system.id,
      at: system.at,
    }));
  }, [systems]);
  const routes = useMemo(
    () =>
      world
        ? world.present
            .filter((unit) => unit.path.length > 1)
            .map((unit) => unit.path.map((point) => shift(onShell(point, world))))
        : [],
    [world, aspect, sector, seat],
  );

  useEffect(() => {
    const element = box.current;
    if (!element) return undefined;
    const measure = () => setFrame([element.clientWidth, element.clientHeight]);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [setFrame]);

  // Another project is another space, so the pilot's own view of this one is not a view of that one.
  useEffect(() => {
    release();
  }, [release, projectId, seatId]);


  useEffect(() => {
    if (held || !ground.length || !frame[0] || !frame[1]) return;
    fit(fitView(ground, frame[0], frame[1], 1.45, sector));
  }, [held, ground, frame, sector, fit]);

  useEffect(() => {
    const element = box.current;
    if (!element) return undefined;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      zoom(event.deltaY);
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [zoom]);

  if (!world) return null;

  /** The unit next to the seat in the order the board lists them, which is the order the names are read in. */
  const step = (by: number) => {
    if (!systems.length) return;
    const at = systems.findIndex((system) => system.id === seatId);
    const next = systems[((at < 0 ? 0 : at) + by + systems.length) % systems.length];
    if (!next) return;
    setSeatId(next.id);
    onPick(next.id);
  };

  return (
    <div
      ref={box}
      data-region="eve-space"
      className="absolute inset-0 cursor-grab overflow-hidden active:cursor-grabbing"
      onPointerDown={(event) => {
        drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
      }}
      onPointerMove={(event) => {
        const from = drag.current;
        if (!from || from.id !== event.pointerId) return;
        const dx = event.clientX - from.x;
        const dy = event.clientY - from.y;
        if (Math.hypot(dx, dy) < DRAG) return;
        drag.current = { ...from, x: event.clientX, y: event.clientY };
        turn(dx, dy);
      }}
      onPointerUp={() => {
        drag.current = null;
      }}
      onPointerCancel={() => {
        drag.current = null;
      }}
    >
      <Canvas
        dpr={[1, 2]}
        flat
        gl={{ powerPreference: 'high-performance' }}
        camera={{ fov: LEVEL.fov, position: [0, 0, 0], far: 4000 }}
        onCreated={({ camera: made }) => {
          camera.current = made as THREE.PerspectiveCamera;
        }}
      >
        <Pilot camera={camera} />
        <Sky />
        <Stars />
        {regionGeometry ? (
          <points geometry={regionGeometry}>
            <pointsMaterial
              map={starSprite}
              size={4}
              sizeAttenuation={false}
              color="#a8bcd6"
              transparent
              opacity={0.7}
              depthWrite={false}
            />
          </points>
        ) : null}
        {starGeometry ? (
          <points
            geometry={starGeometry}
            onClick={(event) => {
              if (event.delta > DRAG) return;
              const hit = event.index === undefined ? undefined : stars[event.index];
              if (!hit) return;
              event.stopPropagation();
              onPick(hit.id);
            }}
          >
            <pointsMaterial map={starSprite} size={9} sizeAttenuation={false} color="#cfe0ff" transparent depthWrite={false} />
          </points>
        ) : null}
        {own ? <SystemBody at={own.at} seed={own.id} glow={starSprite} /> : null}
        {bodies.map((system) => (
          <Mark key={system.id} system={system} picked={system.id === pickedId} onPick={onPick} />
        ))}
        {routes.map((points, index) => (
          <Route key={index} points={points} />
        ))}
      </Canvas>
      <Overlay systems={systems} pickedId={pickedId} onPick={onPick} />
      <div className="absolute right-3 bottom-3 flex flex-col gap-1">
        {[
          { title: 'previous unit', Icon: ChevronLeft, run: () => step(-1) },
          { title: 'next unit', Icon: ChevronRight, run: () => step(1) },
          {
            title: 'third person',
            Icon: RotateCcw,
            run: () => {
              setSeatId(null);
              release();
            },
          },
          { title: 'closer', Icon: Plus, run: () => zoom(-120) },
          { title: 'further', Icon: Minus, run: () => zoom(120) },
        ].map(({ title, Icon, run }) => (
          <button
            key={title}
            type="button"
            title={title}
            onClick={run}
            className="pointer-events-auto flex size-7 items-center justify-center rounded border border-border/70 bg-card/90 text-muted-foreground hover:text-foreground"
          >
            <Icon className="size-4" />
          </button>
        ))}
      </div>
      <SphereMinimap
        view={{ yaw, pitch, fov, frame }}
        marks={marks}
        current={projectId}
        onTurn={turn}
        onFace={face}
      />
    </div>
  );
}

/**
 * New Eden as the project's own pane.
 *
 * The shell is still the seat and still the default sphere: this is a second picture of the same space, drawn by this
 * project for this space. It stands where the frame's map stands in Kwai Tsing, so the frame arranges it the same way
 * (side by side, stacked, or taking the frame) and the pilot can close it back to the sphere.
 */
export const EVE_SPACE = registerReading({
  key: 'eve-space',
  path: '/eden',
  View: EveSpace,
  button: { order: 11, title: 'new eden', Icon: Sun },
  // A pane of the board rather than a place the cockpit goes to, which is what puts it beside the shell.
  pane: true,
  // It draws the units the run has placed, so it is offered wherever a space has any.
  can: (world) => Boolean(world?.standing.length),
  asked: true,
  pack: 'eve',
});
