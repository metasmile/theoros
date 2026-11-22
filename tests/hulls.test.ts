// The shapes a mark is drawn with.
//
// MESH.md states the contract a hull has to meet, and the space is drawn every frame, so the cost of a hull is part of
// its shape rather than a property of the machine it is shown on. These hold the numbers rather than a rendering.

import { expect, test } from 'vitest';
import * as THREE from 'three';

import { haulerVariant, markGeometry, type MarkKind } from '../src/hulls';

/** How many shapes each kind is drawn in, which is what the geometry cache is keyed by. */
const VARIANTS: Record<MarkKind, number> = { hauler: 4, station: 1, gate: 1, planet: 1, moon: 1, belt: 1 };

const shapes = () =>
  (Object.keys(VARIANTS) as MarkKind[]).flatMap((kind) =>
    Array.from({ length: VARIANTS[kind] }, (_, variant) => ({ kind, variant, geometry: markGeometry(kind, variant) })),
  );

const sizeOf = (geometry: THREE.BufferGeometry): THREE.Vector3 => {
  geometry.computeBoundingBox();
  return geometry.boundingBox!.getSize(new THREE.Vector3());
};

const centreOf = (geometry: THREE.BufferGeometry): THREE.Vector3 => {
  geometry.computeBoundingBox();
  return geometry.boundingBox!.getCenter(new THREE.Vector3());
};

test('each kind and variant is one geometry, shared by every mark drawn in it', () => {
  for (const { kind, variant, geometry } of shapes()) {
    expect(markGeometry(kind, variant), `${kind} ${variant}`).toBe(geometry);
    expect(markGeometry(kind, variant), `${kind} ${variant} is stable`).toBe(markGeometry(kind, variant));
  }
});

test('a hull is the size a mark on the shell is allowed to be', () => {
  // The floor is the place's own scale, not a taste: a place is about six degrees of the dome along its axes once it is
  // pressed into its cell, so a mark above about a degree and a half has no room to stand clear of its neighbours.
  for (const { kind, variant, geometry } of shapes()) {
    const size = sizeOf(geometry);
    const largest = Math.max(size.x, size.y, size.z);
    expect(largest, `${kind} ${variant} is at most 0.08`).toBeLessThanOrEqual(0.08);
    expect(largest, `${kind} ${variant} is a mark rather than a speck`).toBeGreaterThan(0.02);
    const middle = centreOf(geometry);
    expect(Math.abs(middle.x), `${kind} ${variant} x`).toBeLessThanOrEqual(0.01);
    expect(Math.abs(middle.y), `${kind} ${variant} y`).toBeLessThanOrEqual(0.01);
    expect(Math.abs(middle.z), `${kind} ${variant} z`).toBeLessThanOrEqual(0.01);
  }
});

test('a hull stays inside the triangle budget', () => {
  for (const { kind, variant, geometry } of shapes()) {
    const triangles = geometry.getAttribute('position').count / 3;
    expect(triangles, `${kind} ${variant} triangles`).toBeLessThanOrEqual(800);
  }
});

test('a hull carries its own shading, because the scene carries no lights', () => {
  for (const { kind, variant, geometry } of shapes()) {
    const colours = geometry.getAttribute('color');
    expect(colours, `${kind} ${variant} has vertex colours`).toBeDefined();
    let shadowed = 0;
    let lit = 0;
    for (let index = 0; index < colours.count; index += 1) {
      const value = colours.getX(index);
      expect(value, `${kind} ${variant} vertex brightness at ${index}`).toBeGreaterThan(0);
      expect(value, `${kind} ${variant} vertex brightness at ${index}`).toBeLessThanOrEqual(1);
      if (value < 0.6) shadowed += 1;
      if (value > 0.9) lit += 1;
    }
    // A form drawn at one brightness is a silhouette, so both ends of the range have to be present.
    expect(shadowed, `${kind} ${variant} has faces away from the light`).toBeGreaterThan(0);
    expect(lit, `${kind} ${variant} has faces toward the light`).toBeGreaterThan(0);
  }
});

test('the four hauler variants are four shapes rather than one shape drawn four times', () => {
  // A fleet of three names is three hulls only if the fitting out is what changes, so the geometries are compared by
  // what they draw and not by the name they were asked for.
  const signature = (variant: number) =>
    Array.from(markGeometry('hauler', variant).getAttribute('position').array).join(',');
  const marks = new Set(Array.from({ length: VARIANTS.hauler }, (_, variant) => signature(variant)));
  expect(marks.size, 'no two variants are the same geometry').toBe(VARIANTS.hauler);
});

test('a hull keeps the variant its own name gives it, and the fleet is more than one', () => {
  // The name is the seed, so a ship is the same ship on every screen and a reload does not re-roll it.
  for (const name of ['Retribution', 'Stiletto', 'Svipul']) {
    expect(haulerVariant(name), name).toBe(haulerVariant(name));
    expect(haulerVariant(name), name).toBeGreaterThanOrEqual(0);
    expect(haulerVariant(name), name).toBeLessThan(VARIANTS.hauler);
  }
  expect(new Set(['Retribution', 'Stiletto', 'Svipul'].map(haulerVariant)).size, 'three hulls, not one').toBeGreaterThan(1);
});

test('the hauler is longer than it is wide, and tapers to its nose', () => {
  for (let variant = 0; variant < VARIANTS.hauler; variant += 1) {
    const geometry = markGeometry('hauler', variant);
    const size = sizeOf(geometry);
    expect(size.z, `variant ${variant} length against width`).toBeGreaterThan(size.x);
    expect(size.z, `variant ${variant} length against height`).toBeGreaterThan(size.y);

    const position = geometry.getAttribute('position');
    // The front eighth of the hull, taken as a fraction of its own length so the band holds whatever scale a mark is drawn at.
    const front = geometry.boundingBox!.min.z + size.z * 0.078;
    let widest = 0;
    let nose = 0;
    for (let index = 0; index < position.count; index += 1) {
      widest = Math.max(widest, Math.abs(position.getX(index)));
      if (position.getZ(index) <= front) nose = Math.max(nose, Math.abs(position.getX(index)));
    }
    expect(nose, `variant ${variant} has a nose rather than a point`).toBeGreaterThan(0);
    expect(nose * 2, `variant ${variant} is narrower at the nose than the hull`).toBeLessThan(widest);
  }
});

test('the exhausts sit at the tail', () => {
  const exhaust = markGeometry('exhaust');
  exhaust.computeBoundingBox();
  expect(exhaust.boundingBox!.min.z).toBeGreaterThan(0.02);
  expect(exhaust.boundingBox!.max.z).toBeLessThan(0.04);
});
