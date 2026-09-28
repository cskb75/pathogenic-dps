import { useEffect, useMemo, useReducer, useState } from 'react';
import { gameData } from '../data';
import { calculate } from '../engine/calc';
import { emptyBuild, exampleBuild, loadInitialBuild, makeReducer, saveBuild, shareUrl } from '../state/build';
import { BodyEditor } from './BodyEditor';
import { BuildSettings } from './BuildSettings';
import { ClassPicker } from './ClassPicker';
import { Results } from './Results';
import { RunPanel } from './RunPanel';
import { SlotInspector } from './SlotInspector';
import { art, uiArt } from './art';

const reducer = makeReducer(gameData);

export function App() {
  const [build, dispatch] = useReducer(reducer, gameData, loadInitialBuild);
  const [selected, setSelected] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const result = useMemo(() => calculate(build, gameData), [build]);

  useEffect(() => saveBuild(build), [build]);

  // A shared build has now been loaded (and saved), so drop it from the URL:
  // otherwise reloading would bring back the shared version over later edits.
  useEffect(() => {
    if (window.location.hash.includes('b=')) window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }, []);

  // Forget the selection if its slot disappears (e.g. a module was removed).
  const selectedSlot = selected && result.body.slotById.has(selected) ? selected : null;

  // On narrow screens the inspector sits below the editor: bring it into view.
  function selectFromEditor(slotId: string | null) {
    setSelected(slotId);
    if (!slotId || !window.matchMedia('(max-width: 900px)').matches) return;
    const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    requestAnimationFrame(() => document.getElementById('inspector')?.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'nearest' }));
  }

  async function copyLink() {
    const url = shareUrl(build);
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt('Copy this link to share the build:', url);
    }
  }

  function startOver(example: boolean) {
    if (!window.confirm(example ? 'Replace this build with the example build?' : 'Start a new empty build?')) return;
    dispatch({ type: 'load', build: example ? exampleBuild(gameData) : emptyBuild(gameData, build.classId) });
    setSelected(null);
    window.history.replaceState(null, '', window.location.pathname);
  }

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <img className="brand-mark" src={art('art/organelles/vesicle.webp')} alt="" width={44} height={44} />
          <div className="brand-text">
            <h1>
              Pathogenic<span className="brand-dps">DPS</span>
            </h1>
            <span className="brand-tagline">Fan-made build planner · not affiliated with the game's developers</span>
          </div>
        </div>
        <input
          className="build-name"
          aria-label="Build name"
          value={build.name}
          maxLength={80}
          onChange={(e) => dispatch({ type: 'rename', name: e.target.value })}
        />
        <div className="header-actions">
          <button onClick={copyLink}>{copied ? 'Link copied' : 'Copy share link'}</button>
          <button onClick={() => startOver(true)}>Example</button>
          <button onClick={() => startOver(false)}>New</button>
        </div>
      </header>

      <ClassPicker data={gameData} build={build} dispatch={dispatch} onSwitched={() => setSelected(null)} />

      <p className="banner" role="note">
        <img className="banner-icon" src={uiArt('type-dna')} alt="" width={22} height={32} />
        <span>
          Numbers, body plans and plasmid trees come from the full game's files (September 2026 build). Things that depend on how you play (aim,
          positioning, how often mitochondria trigger) are fight assumptions you can change below; each organelle says what it assumes.
        </span>
      </p>

      <main className="layout">
        <div className="col-main">
          <BodyEditor data={gameData} build={build} result={result} selected={selectedSlot} onSelect={selectFromEditor} dispatch={dispatch} />
          <RunPanel data={gameData} build={build} result={result} dispatch={dispatch} />
          <BuildSettings data={gameData} build={build} dispatch={dispatch} />
        </div>
        <div className="col-side">
          <Results data={gameData} build={build} result={result} selected={selectedSlot} onSelect={setSelected} />
          <SlotInspector data={gameData} build={build} result={result} slotId={selectedSlot} onSelect={setSelected} dispatch={dispatch} />
        </div>
      </main>

      <footer className="app-footer muted small">
        Fan-made tool, not affiliated with Aberrant Labs or Slug Disco. Game art © its creators, from the game files and pathogenic.wiki. Data:{' '}
        {gameData.dataSource}.
      </footer>
    </div>
  );
}
