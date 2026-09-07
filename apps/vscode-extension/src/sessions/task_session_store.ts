import {
  AgentEvent,
  ChangeCreatedEvent,
  PlanCreatedEvent,
  PlanUpdatedEvent,
  PlanStepStartedEvent,
  PlanStepCompletedEvent,
  PlanStepFailedEvent,
  PlanStepBlockedEvent,
  VerificationCompletedEvent,
  DiagnosisCreatedEvent,
  RepairStartedEvent,
  RepairCompletedEvent,
  InteractionRequestedEvent
} from '@comu/protocol';
import { ChatSessionStateUI } from '../protocol/messages';

export class TaskSessionStore {
  private state: ChatSessionStateUI = {
    status: "idle",
    events: [],
    changes: [],
    repairAttempts: []
  };

  private seenEvents = new Set<string>();

  public getState(): ChatSessionStateUI {
    return this.state;
  }

  public setOffline(offline: boolean) {
    if (offline && this.state.status !== 'offline') {
      this.state.status = 'offline';
    } else if (!offline && this.state.status === 'offline') {
      this.state.status = 'idle';
    }
  }

  public startNewTask(taskId: string, prompt: string, modelId: string, mode?: "AUTO" | "CHAT" | "ASK" | "PLAN" | "AGENT") {
    const now = Date.now();
    this.state = {
      taskId,
      prompt,
      modelId,
      interactionMode: mode && mode !== "AUTO" ? mode : undefined,
      agentState: "STARTING",
      status: "running",
      events: [],
      changes: [],
      repairAttempts: [],
      workingSet: {
        openFiles: [],
        recentlyInspectedFiles: [],
        searchResults: [],
        diagnostics: [],
        modifiedFiles: []
      },
      startTime: now
    };
    this.seenEvents.clear();
  }

  public addEvent(event: AgentEvent) {
    const uniqueId = `${event.taskId}-${event.eventId}`;
    if (this.seenEvents.has(uniqueId)) {
      return false; // Deduplicated
    }

    this.seenEvents.add(uniqueId);
    this.state.events.push(event);

    if (!this.state.workingSet) {
      this.state.workingSet = {
        openFiles: [],
        recentlyInspectedFiles: [],
        searchResults: [],
        diagnostics: [],
        modifiedFiles: []
      };
    }

    // Update projected state based on event
    if (event.type === 'change.created') {
      const ce = event as ChangeCreatedEvent;
      const existing = this.state.changes.find(c => c.path === ce.path);
      if (!existing) {
        this.state.changes.push({ path: ce.path, operation: ce.operation });
      }
      if (this.state.workingSet && !this.state.workingSet.modifiedFiles?.some(m => m.path === ce.path)) {
        this.state.workingSet.modifiedFiles = this.state.workingSet.modifiedFiles || [];
        this.state.workingSet.modifiedFiles.push({ path: ce.path, source: 'COMU_CHANGE' });
      }
    } else if (event.type === 'agent.status') {
      const se = event as any;
      if (se.status) {
        this.state.agentState = se.status;
        const sUpper = se.status.toUpperCase();
        if (sUpper.includes("AGENT")) this.state.interactionMode = "AGENT";
        else if (sUpper.includes("PLAN")) this.state.interactionMode = "PLAN";
        else if (sUpper.includes("ASK")) this.state.interactionMode = "ASK";
        else if (sUpper.includes("CHAT")) this.state.interactionMode = "CHAT";
        else if (sUpper.includes("AMBIGUOUS") || sUpper.includes("CLARIF")) this.state.interactionMode = "AMBIGUOUS";
      }
    } else if (event.type === 'tool.started' || event.type === 'tool.completed') {
      const te = event as any;
      const toolName = (te.tool || '').toLowerCase();
      if (te.tool) {
        this.state.agentState = `TOOL_CALLING`;
      }
      // Inspect tool args or results for file paths
      const targetPath = te.path || te.filePath || (te.result && (te.result.path || te.result.filePath));
      if (targetPath && typeof targetPath === 'string' && this.state.workingSet) {
        this.state.workingSet.recentlyInspectedFiles = this.state.workingSet.recentlyInspectedFiles || [];
        if (!this.state.workingSet.recentlyInspectedFiles.includes(targetPath)) {
          this.state.workingSet.recentlyInspectedFiles.unshift(targetPath);
          if (this.state.workingSet.recentlyInspectedFiles.length > 20) {
            this.state.workingSet.recentlyInspectedFiles.length = 20;
          }
        }
      }
    } else if (event.type === 'task.completed') {
      this.state.status = 'completed';
      this.state.agentState = 'COMPLETED';
      const now = Date.now();
      this.state.completedTime = now;
      if (this.state.startTime) {
        this.state.durationMs = now - this.state.startTime;
      }
      const te = event as any;
      if (te.finalText) {
        this.state.finalResponse = te.finalText;
      }
    } else if (event.type === 'task.failed') {
      this.state.status = 'failed';
      this.state.agentState = 'FAILED';
      const now = Date.now();
      this.state.completedTime = now;
      if (this.state.startTime) {
        this.state.durationMs = now - this.state.startTime;
      }
    } else if (event.type === 'task.cancelled') {
      this.state.status = 'cancelled';
      this.state.agentState = 'CANCELLED';
      const now = Date.now();
      this.state.completedTime = now;
      if (this.state.startTime) {
        this.state.durationMs = now - this.state.startTime;
      }
    } else if (event.type === 'plan.created') {
      const pe = event as PlanCreatedEvent;
      this.state.plan = pe.plan;
      if (!this.state.interactionMode) this.state.interactionMode = 'PLAN';
    } else if (event.type === 'plan.updated') {
      const pe = event as PlanUpdatedEvent;
      this.state.plan = pe.plan;

    } else if (event.type === 'plan.step.started') {
      const se = event as PlanStepStartedEvent;
      if (this.state.plan) {
        const step = this.state.plan.steps.find(s => s.id === se.stepId);
        if (step) step.status = 'RUNNING';
      }
    } else if (event.type === 'plan.step.completed') {
      const se = event as PlanStepCompletedEvent;
      if (this.state.plan) {
        const step = this.state.plan.steps.find(s => s.id === se.stepId);
        if (step) {
          step.status = 'COMPLETED';
          step.resultSummary = se.resultSummary;
        }
      }
    } else if (event.type === 'plan.step.failed') {
      const se = event as PlanStepFailedEvent;
      if (this.state.plan) {
        const step = this.state.plan.steps.find(s => s.id === se.stepId);
        if (step) {
          step.status = 'FAILED';
          step.resultSummary = se.error;
        }
      }
    } else if (event.type === 'plan.step.blocked') {
      const se = event as PlanStepBlockedEvent;
      if (this.state.plan) {
        const step = this.state.plan.steps.find(s => s.id === se.stepId);
        if (step) {
          step.status = 'BLOCKED';
          step.resultSummary = se.reason;
        }
      }
    } else if (event.type === 'verification.completed') {
      const ve = event as VerificationCompletedEvent;
      this.state.verification = ve.result;
    } else if (event.type === 'diagnosis.created') {
      const de = event as DiagnosisCreatedEvent;
      this.state.diagnosis = de.diagnosis;
    } else if (event.type === 'repair.started') {
      const re = event as RepairStartedEvent;
      if (!this.state.repairAttempts) this.state.repairAttempts = [];
      this.state.repairAttempts.push({
        attemptId: re.repairAttemptId,
        taskId: re.taskId,
        attemptNumber: re.attemptNumber,
        failureFingerprint: "",
        repairStrategyFingerprint: "",
        repairAttemptFingerprint: "",
        targetFiles: re.targetFiles,
        changeSummary: `Repair attempt ${re.attemptNumber} started`,
        validationStatus: "FAILED",
        createdAt: re.timestamp
      });
    } else if (event.type === 'repair.completed') {
      const re = event as RepairCompletedEvent;
      if (this.state.repairAttempts) {
        const item = this.state.repairAttempts.find(a => a.attemptId === re.repairAttemptId);
        if (item) {
          item.outcome = re.outcome;
          item.validationStatus = "PASSED";
        }
      }
    } else if (event.type === 'interaction.requested') {
      const ie = event as InteractionRequestedEvent;
      this.state.pendingInteraction = ie.interaction;
      this.state.status = 'waiting_for_user';
    } else if (event.type === 'interaction.responded') {
      delete this.state.pendingInteraction;
      this.state.status = 'running';
    } else if (event.type === 'interaction.expired') {
      delete this.state.pendingInteraction;
    } else if (event.type === 'git.commit.proposed') {
      const ge = event as any;
      this.state.gitCommitProposal = { message: ge.message, files: ge.files };
    } else if (event.type === 'git.commit.completed') {
      const ge = event as any;
      this.state.gitCommitResult = {
        commitHash: ge.commitHash,
        message: ge.message,
        branch: ge.branch,
        fileCount: ge.fileCount
      };
      delete this.state.gitCommitProposal;
    } else if (event.type === 'git.push.requested') {
      const pe = event as any;
      this.state.gitPushProposal = {
        remote: pe.remote,
        branch: pe.branch,
        commitHash: pe.commitHash
      };
    } else if (event.type === 'git.push.completed') {
      const pe = event as any;
      this.state.gitPushResult = {
        remote: pe.remote,
        branch: pe.branch,
        commitHash: pe.commitHash
      };
      delete this.state.gitPushProposal;
    } else if (event.type === 'git.push.denied') {
      delete this.state.gitPushProposal;
    } else if (event.type === 'subagent.started') {
      const se = event as any;
      if (!this.state.subagents) this.state.subagents = [];
      this.state.subagents.push({
        subagentId: se.subagentId,
        subagentType: se.subagentType,
        goal: se.goal,
        status: 'RUNNING'
      });
    } else if (event.type === 'subagent.completed') {
      const se = event as any;
      if (this.state.subagents) {
        const item = this.state.subagents.find(s => s.subagentId === se.subagentId);
        if (item) {
          item.status = 'COMPLETED';
          item.summary = se.result?.summary;
          item.findings = se.result?.findings;
        }
      }
    } else if (event.type === 'subagent.failed') {
      const se = event as any;
      if (this.state.subagents) {
        const item = this.state.subagents.find(s => s.subagentId === se.subagentId);
        if (item) {
          item.status = 'FAILED';
          item.summary = se.error;
        }
      }
    } else if (event.type === 'memory.recorded') {
      const me = event as any;
      if (!this.state.memories) this.state.memories = [];
      this.state.memories.push(me.entry);
    }

    return true;
  }

  public setMemories(memories: any[]) {
    this.state.memories = memories;
  }

  public setFinalResponse(text: string) {
    this.state.finalResponse = text;
  }
}
