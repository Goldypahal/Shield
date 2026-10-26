import * as Speech from 'expo-speech';
import { PlannedRoute, isCautionSegment } from './routeService';

/**
 * Turn-by-turn voice guidance built from the route itself: a turn wherever the heading
 * changes by more than 35 degrees, plus a spoken warning before each caution stretch
 * (dark, isolated or higher-risk), so the walker knows to stay alert or call someone.
 */
export interface Instruction {
  at: [number, number];
  text: string;
  kind: 'turn' | 'caution' | 'arrive';
}

const TURN_DEG = 35;
const ANNOUNCE_WITHIN_M = 35;

function bearing([lat1, lon1]: [number, number], [lat2, lon2]: [number, number]) {
  const toRad = Math.PI / 180;
  const y = Math.sin((lon2 - lon1) * toRad) * Math.cos(lat2 * toRad);
  const x = Math.cos(lat1 * toRad) * Math.sin(lat2 * toRad) -
    Math.sin(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.cos((lon2 - lon1) * toRad);
  return (Math.atan2(y, x) / toRad + 360) % 360;
}

export function distanceM([lat1, lon1]: [number, number], [lat2, lon2]: [number, number]) {
  const dy = (lat2 - lat1) * 110950;
  const dx = (lon2 - lon1) * 111320 * Math.cos(((lat1 + lat2) / 2) * Math.PI / 180);
  return Math.hypot(dx, dy);
}

export function buildInstructions(route: PlannedRoute): Instruction[] {
  const out: Instruction[] = [];
  const c = route.coords;
  for (let i = 1; i < c.length - 1; i++) {
    const turn = ((bearing(c[i], c[i + 1]) - bearing(c[i - 1], c[i]) + 540) % 360) - 180;
    if (Math.abs(turn) < TURN_DEG) continue;
    const dir = Math.abs(turn) > 135 ? 'make a U-turn' : turn > 0 ? 'turn right' : 'turn left';
    const street = route.segments[i]?.name;
    out.push({ at: c[i], kind: 'turn', text: `${dir[0].toUpperCase()}${dir.slice(1)}${street ? ` onto ${street.replace(/\s*\(approx\.\)/, '')}` : ''}.` });
  }
  // Caution stretches: announce at the start of each run
  let inRun = false;
  route.segments.forEach((s, i) => {
    const caution = isCautionSegment(s);
    if (caution && !inRun) {
      let len = 0;
      for (let j = i; j < route.segments.length && isCautionSegment(route.segments[j]); j++) len += route.segments[j].length_m;
      out.push({ at: c[i], kind: 'caution',
        text: `Caution: the next ${Math.round(len / 50) * 50 || 50} metres are ${s.isolated ? 'dark and quiet' : 'higher risk'}. Stay alert; your guardians can see you.` });
    }
    inRun = caution;
  });
  out.push({ at: c[c.length - 1], kind: 'arrive', text: 'You have arrived. End the trip in SHIELD when you are safe.' });
  return out;
}

/** Tracks which instructions were spoken and speaks the next one when the walker gets close. */
export class VoiceGuide {
  private spoken = new Set<number>();
  constructor(private instructions: Instruction[], private enabled = true) {}

  setEnabled(on: boolean) {
    this.enabled = on;
    if (!on) Speech.stop();
  }

  /** Returns the next instruction to show on screen and its distance. */
  update(position: [number, number]): { next: Instruction | null; distance: number } {
    let next: Instruction | null = null;
    let nextDist = Infinity;
    this.instructions.forEach((ins, idx) => {
      if (this.spoken.has(idx)) return;
      const d = distanceM(position, ins.at);
      if (d <= ANNOUNCE_WITHIN_M) {
        this.spoken.add(idx);
        if (this.enabled) Speech.speak(ins.text, { rate: 0.95 });
        return;
      }
      if (!next || d < nextDist) {
        next = ins;
        nextDist = d;
      }
    });
    return { next, distance: Math.round(nextDist) };
  }

  stop() {
    Speech.stop();
  }
}
