import { createRoot } from 'react-dom/client';
// The kinds this board draws. The shell is the sphere a system is read through and the graph is how its participants are
// read; the region beside it and the records, the intents and the act are this app's and the frame's.
import '@ssccsorg/skene-view-shell';
import '@ssccsorg/skene-view-graph';
// Footage: the kind a probe's still sequence is drawn by. Nothing else here declares a media view, so the package is
// installed for the probe and its absence is a board with no picture rather than a board that fails.
import '@ssccsorg/skene-view-media';
import './space';
import './system';
import { Frame, offTheShelf } from '@ssccsorg/skene-frame';
import { brand } from './brand';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('the page has no root to render into');

// The board names the project a bare address opens on, so no entry names a project and an exported board opens on its own.
const opening = import.meta.env.VITE_OPENS as string | undefined;
const search = new URLSearchParams(window.location.search);
if (opening && !search.has('project')) {
  search.set('project', opening);
  window.history.replaceState(null, '', `${window.location.pathname}?${search.toString()}${window.location.hash}`);
}

// No StrictMode: its double mount opens the record stream twice, and the first socket has already delivered records by
// the time it is closed, which the second one's arrival list has no way to subtract.
createRoot(root).render(<Frame brand={brand} host={offTheShelf} />);
