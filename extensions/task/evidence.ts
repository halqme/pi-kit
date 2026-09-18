import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { taskReviewResources, taskWorkspaceState, type TaskReviewResources, type TaskWorkspaceState } from "./resources.ts";
import { customEntries, latestCustom, TASK_ENTRY, VERIFY_ENTRY } from "./shared.ts";

export interface TaskEvidenceCheckpoint {
  at: string;
  summary: string;
  plan?: string[];
  observations?: string[];
  completed?: string[];
}

interface StoredTaskState {
  id: string;
  goal: string;
  acceptance: string[];
  status: "active" | "blocked" | "done" | "stopped";
  checkpoints: TaskEvidenceCheckpoint[];
  blocker?: string;
}

export interface TaskVerificationEvidence {
  id: string;
  taskId?: string;
  provenance: string;
  origin: "executed" | "reported";
  passed: boolean;
  summary: string;
  detail?: string;
  reviewRequestId?: string;
  at: string;
}

export interface TaskEvidencePacket {
  task: {
    id: string;
    goal: string;
    acceptance: string[];
    status: StoredTaskState["status"];
    latestCheckpoint?: TaskEvidenceCheckpoint;
    blocker?: string;
  };
  resources: TaskReviewResources;
  verification: TaskVerificationEvidence[];
  workspace?: TaskWorkspaceState;
}

export async function taskEvidencePacket(
  ctx: ExtensionContext,
): Promise<TaskEvidencePacket | undefined> {
  const current = latestCustom<StoredTaskState>(ctx, TASK_ENTRY);
  if (!current) return undefined;

  const [resources, workspace] = await Promise.all([
    taskReviewResources(ctx, current.id),
    taskWorkspaceState(ctx, current.id).catch(() => undefined),
  ]);
  const verification = customEntries<TaskVerificationEvidence>(ctx, VERIFY_ENTRY).filter(
    (item) => item.taskId === current.id,
  );
  const latestCheckpoint = current.checkpoints.at(-1);

  return {
    task: {
      id: current.id,
      goal: current.goal,
      acceptance: current.acceptance,
      status: current.status,
      ...(latestCheckpoint ? { latestCheckpoint } : {}),
      ...(current.blocker ? { blocker: current.blocker } : {}),
    },
    resources,
    verification,
    ...(workspace ? { workspace } : {}),
  };
}
