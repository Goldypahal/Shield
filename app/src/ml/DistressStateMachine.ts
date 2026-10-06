import { DistressState } from '../types';

export type StateChangeCallback = (state: DistressState, reason: string) => void;
export type CountdownTickCallback = (secondsRemaining: number) => void;

/**
 * SRS DET-3, ALERT-2, DUR-1 to DUR-4: Distress Incident State Machine.
 * 
 * Flows:
 * MONITORING -> (3/5 audio windows OR Threat >= threshold) -> PRE_ALERT (10s timer)
 * PRE_ALERT -> (Normal PIN) -> CANCELLED (ALERT-11 false alarm feedback)
 * PRE_ALERT -> (Duress PIN) -> ACTIVE (DUR-3 silent high-priority covert alert)
 * PRE_ALERT -> (10s timeout) -> ACTIVE (full SOS dispatch: WS, SMS, Evidence)
 * ACTIVE -> (Normal PIN) -> CANCELLED
 */
export class DistressStateMachine {
  private currentState: DistressState = 'MONITORING';
  private preAlertTimer: NodeJS.Timeout | null = null;
  private secondsRemaining: number = 10;
  private onStateChangeListeners: StateChangeCallback[] = [];
  private onTickListeners: CountdownTickCallback[] = [];

  constructor() {
    this.currentState = 'MONITORING';
  }

  getCurrentState(): DistressState {
    return this.currentState;
  }

  getSecondsRemaining(): number {
    return this.secondsRemaining;
  }

  onStateChange(cb: StateChangeCallback): () => void {
    this.onStateChangeListeners.push(cb);
    return () => {
      this.onStateChangeListeners = this.onStateChangeListeners.filter(l => l !== cb);
    };
  }

  onTick(cb: CountdownTickCallback): () => void {
    this.onTickListeners.push(cb);
    return () => {
      this.onTickListeners = this.onTickListeners.filter(l => l !== cb);
    };
  }

  private transition(newState: DistressState, reason: string): void {
    this.currentState = newState;
    for (const listener of this.onStateChangeListeners) {
      try {
        listener(newState, reason);
      } catch (e) {
        console.error('[DistressStateMachine] Listener error:', e);
      }
    }
  }

  /**
   * Called when threat engine or 3/5 audio detector indicates danger.
   */
  triggerPreAlert(reason: string = 'Threat score exceeded threshold'): void {
    if (this.currentState === 'ACTIVE' || this.currentState === 'PRE_ALERT') {
      return;
    }

    this.clearTimer();
    this.secondsRemaining = 10;
    this.transition('PRE_ALERT', reason);

    this.preAlertTimer = setInterval(() => {
      this.secondsRemaining -= 1;
      for (const listener of this.onTickListeners) {
        try {
          listener(this.secondsRemaining);
        } catch (e) {
          console.error('[DistressStateMachine] Tick error:', e);
        }
      }

      if (this.secondsRemaining <= 0) {
        this.clearTimer();
        this.transition('ACTIVE', '10-second pre-alert timer expired without cancellation');
      }
    }, 1000);
  }

  /**
   * Immediate trigger (e.g. manual red SOS button press).
   */
  triggerImmediateActive(reason: string = 'Manual SOS panic button pressed'): void {
    this.clearTimer();
    this.transition('ACTIVE', reason);
  }

  /**
   * User enters normal PIN to cancel false alarm (ALERT-11).
   */
  cancelWithNormalPin(): void {
    this.clearTimer();
    this.transition('CANCELLED', 'User authenticated normal PIN cancellation');
    // Return to MONITORING after cancellation
    setTimeout(() => {
      if (this.currentState === 'CANCELLED') {
        this.transition('MONITORING', 'Ready for monitoring');
      }
    }, 1500);
  }

  /**
   * User forced to enter duress PIN (DUR-1 to DUR-4).
   * Appears cancelled on screen, but immediately and silently transitions to ACTIVE.
   */
  triggerDuressPin(): void {
    this.clearTimer();
    this.transition('ACTIVE', 'Silent Duress PIN verified: Covert high-priority alert');
  }

  reset(): void {
    this.clearTimer();
    this.secondsRemaining = 10;
    this.transition('MONITORING', 'State machine reset');
  }

  private clearTimer(): void {
    if (this.preAlertTimer) {
      clearInterval(this.preAlertTimer);
      this.preAlertTimer = null;
    }
  }
}

export default new DistressStateMachine();
