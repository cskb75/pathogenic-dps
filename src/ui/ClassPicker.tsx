import type { Dispatch } from 'react';
import type { Build, GameData } from '../engine/types';
import type { Action } from '../state/build';
import { ClassPortrait } from './art';

interface Props {
  data: GameData;
  build: Build;
  dispatch: Dispatch<Action>;
  onSwitched: () => void;
}

/** One card per pathogen. Switching replaces the body; run state carries over. */
export function ClassPicker({ data, build, dispatch, onSwitched }: Props) {
  const equipped = Object.values(build.slots).some((s) => s.organelle);

  function pick(classId: string) {
    if (classId === build.classId) return;
    const name = data.classes.find((c) => c.id === classId)?.name ?? classId;
    if (equipped && !window.confirm(`Switch to the ${name}? Its body starts empty. Mutations and settings carry over; plasmids don't.`)) return;
    dispatch({ type: 'setClass', classId });
    onSwitched();
  }

  return (
    <nav className="class-picker" aria-label="Pathogen">
      {data.classes.map((c) => {
        const active = c.id === build.classId;
        return (
          <button key={c.id} className={`class-card ${active ? 'active' : ''}`} aria-pressed={active} onClick={() => pick(c.id)} title={c.description}>
            <ClassPortrait cls={c} data={data} size={44} />
            <span className="class-text">
              <span className="class-name">{c.name}</span>
              <span className="class-tagline">{c.tagline}</span>
            </span>
          </button>
        );
      })}
    </nav>
  );
}
