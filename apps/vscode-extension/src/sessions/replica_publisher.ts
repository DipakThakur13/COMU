import * as vscode from 'vscode';
import { AgentEvent, TaskAutonomy } from '@comu/protocol';
import {
    DeltaCoalescer,
    EventSequencer,
    HostToWebviewMessage,
    SessionState,
    TurnView,
    createInitialSessionState,
    reduceEvent,
    restoreThread,
    startTask
} from '@comu/ui-state';

/**
 * The authoritative session state for the React interface, and the only thing that talks to the
 * replica.
 *
 * The host reduces every event itself and forwards each one stamped with a monotonic per-task
 * sequence. The webview holds a replica; when it detects a gap it asks for a snapshot, which is
 * served from the state held here. This is why the host is authoritative: the replica can always
 * be rebuilt from it, and the two run the identical reducer so they cannot disagree.
 *
 * Token deltas are coalesced on a frame boundary before forwarding. A streaming provider emits a
 * delta per chunk, often many per frame, and posting each one across the message boundary would
 * cost more than rendering them.
 */
export class ReplicaPublisher {
    private state: SessionState = createInitialSessionState();
    private sequencer = new EventSequencer();
    private currentTaskId = 'idle';
    private view?: vscode.Webview;
    private coalescer: DeltaCoalescer;

    constructor() {
        this.coalescer = new DeltaCoalescer(
            events => this.forward(events),
            // VS Code webviews have no requestAnimationFrame on the host side; a frame-length timer
            // is the equivalent and keeps a burst of chunks to one message.
            callback => setTimeout(callback, 16)
        );
    }

    public attach(view: vscode.Webview | undefined) {
        this.view = view;
    }

    public getState(): SessionState {
        return this.state;
    }

    public currentSeq(): number {
        return this.sequencer.current(this.currentTaskId);
    }

    /** Begins a new task. The replica is told by the snapshot that follows. */
    public beginTask(input: { taskId: string; prompt: string; modelId?: string; autonomy: TaskAutonomy; mode?: string }) {
        this.coalescer.flushNow();
        this.sequencer.forget(this.currentTaskId);
        this.currentTaskId = input.taskId;
        this.state = startTask(this.state, input);
        this.sendSnapshot();
    }

    /** Puts turns rebuilt from the session file into a panel that has none yet. */
    public restoreThread(turns: TurnView[]) {
        const next = restoreThread(this.state, turns);
        if (next === this.state) return;
        this.state = next;
        this.sendSnapshot();
    }

    public setConnection(connection: SessionState['connection']) {
        if (this.state.connection === connection) return;
        this.state = { ...this.state, connection };
        this.sendSnapshot();
    }

    /**
     * Folds an event into the authoritative state and forwards it. Deltas are buffered; everything
     * else flushes the buffer first so ordering is preserved.
     */
    public publish(event: AgentEvent) {
        this.state = reduceEvent(this.state, event);
        if (!this.coalescer.push(event)) {
            this.forward([event]);
        }
    }

    /** Serves a fresh snapshot, which is how a replica recovers from a detected gap. */
    public sendSnapshot() {
        this.coalescer.flushNow();
        this.post({ type: 'session_snapshot', seq: this.currentSeq(), state: this.state });
    }

    public dispose() {
        this.coalescer.dispose();
    }

    private forward(events: AgentEvent[]) {
        const sequenced = events.map(event => this.sequencer.next(this.currentTaskId, event));
        this.post({ type: 'session_events', events: sequenced });
    }

    private post(message: HostToWebviewMessage) {
        void this.view?.postMessage(message);
    }
}
