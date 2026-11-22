// What a body is drawn in.
//
// One palette for the board and for the inventory, so a colour means the same kind in both readings: a pilot who learns
// that blue orbits and coral berths is not taught it twice.
//
// The hues are spread around the wheel and held near one lightness, because eight saturated colours in a list is a fruit
// salad rather than a reading. They also fall into four families, which is what keeps a table of thirty rows calm: a blue
// family for what orbits (planet, then the paler moon), a warm family for what stands (the star, the belts, the berths),
// a green family for what moves between systems, and one rose for people.

export const INK: Record<string, string> = {
  system: '#ffd7a0',
  planet: '#6fa8dc',
  moon: '#a9c6e8',
  belt: '#dcb556',
  gate: '#5fc9a8',
  station: '#e08b6b',
  hauler: '#9fd18f',
  person: '#d98fb0',
};

/** The ink a kind is drawn in, or nothing when the kind is one this board does not name. */
export const inkOf = (kind: string | null | undefined): string | undefined => (kind ? INK[kind] : undefined);
