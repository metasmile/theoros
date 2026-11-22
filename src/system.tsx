// What a system holds, as a list: the source's own inventory of the place the board has open.
//
// The space pane draws the units where they stand, which answers where a body is and not what it is. This reading answers
// the other half: every unit the place declares, its kind, and the type ESI names for it, which is the same set the pane
// marks. It reads the place and not the capture, so the list and the picture cannot disagree about what stands there.
import { Orbit } from 'lucide-react';
import { registerReading, type Board } from '@ssccsorg/skene-frame/lib/readings';
import { cn } from '@ssccsorg/skene-ui';
import { inkOf } from './ink';

/** The order a system is read in: the body at the middle, then what orbits, then what crosses, then what berths. */
const KINDS = ['system', 'planet', 'moon', 'belt', 'gate', 'station', 'hauler', 'person'];

/** The word a kind is read as. A kind this list does not name is read as its own name. */
const WORDS: Record<string, string> = {
  system: 'star',
  planet: 'planet',
  moon: 'moon',
  belt: 'belt',
  gate: 'gate',
  station: 'station',
  hauler: 'hull',
  person: 'pilot',
};

const rank = (kind: string) => {
  const at = KINDS.indexOf(kind);
  return at === -1 ? KINDS.length : at;
};

function SystemUnits({ place, pickedId, onPick }: Board) {
  const units = place?.units ?? {};
  const rows = Object.entries(units)
    .map(([id, unit]) => ({
      id,
      kind: unit.icon ?? 'unit',
      label: unit.label ?? id,
      type: unit.model ?? '',
    }))
    .sort((left, right) => rank(left.kind) - rank(right.kind) || left.label.localeCompare(right.label));

  const counted = KINDS.map((kind) => ({
    kind,
    count: rows.filter((row) => row.kind === kind).length,
  })).filter((each) => each.count > 0);

  if (!rows.length) {
    return <p className="p-4 text-sm text-muted-foreground">This place declares no units.</p>;
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-border/60 px-4 py-3">
        <h2 className="text-sm font-medium text-foreground">{place?.store?.label ?? 'system'}</h2>
        {counted.map((each) => (
          <span key={each.kind} className="text-[11px] text-muted-foreground">
            {each.count} {each.count === 1 ? WORDS[each.kind] ?? each.kind : `${WORDS[each.kind] ?? each.kind}s`}
          </span>
        ))}
      </header>
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full border-collapse text-[12px]">
          <thead className="sticky top-0 bg-background/95 text-left text-[11px] text-muted-foreground">
            <tr>
              <th className="w-20 px-4 py-2 font-normal">kind</th>
              <th className="px-2 py-2 font-normal">name</th>
              <th className="px-4 py-2 font-normal">type</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const ink = inkOf(row.kind);
              return (
                <tr
                  key={row.id}
                  onClick={() => onPick(row.id)}
                  className={cn(
                    'cursor-pointer border-t border-border/40 hover:bg-accent/40',
                    row.id === pickedId && 'bg-accent/60 text-foreground',
                  )}
                >
                  {/* The dot is the board's own ink for this kind, so a list of thirty rows stays calm: the hue is carried
                      by a six-pixel mark and the word beside it, not by a filled cell. */}
                  <td className="px-4 py-1.5">
                    <span
                      className="inline-flex items-center gap-2 text-muted-foreground"
                      style={ink ? { color: ink } : undefined}
                    >
                      <span className="size-1.5 shrink-0 rounded-full bg-current" />
                      {WORDS[row.kind] ?? row.kind}
                    </span>
                  </td>
                  <td className="px-2 py-1.5">{row.label}</td>
                  <td className="px-4 py-1.5 text-muted-foreground">{row.type}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * The system's inventory, as a reading of its own.
 *
 * It is the table to the space pane's picture, so it takes the room rather than standing beside it: a reader switching to
 * it is asking what stands in the place, and the answer is a list rather than a second view of the same ground.
 */
export const EVE_SYSTEM = registerReading({
  key: 'eve-system',
  path: '/system',
  View: SystemUnits,
  button: { order: 12, title: 'system', Icon: Orbit },
  can: (world) => Boolean(world?.standing.length),
  asked: true,
  pack: 'eve',
});
