/* keep workflow import context */
import { Activity as WorkflowActivity, DurableQueue, Workflow } from "effect/unstable/workflow";
import type { DurableClock } from "effect/unstable/workflow";
import type { WorkflowEngine } from "effect/unstable/workflow";
import { WorkflowEngine as Engine } from "effect/unstable/workflow";
import { ClusterWorkflowEngine, SingleRunner } from "effect/unstable/cluster";
import { PersistedQueue } from "effect/unstable/persistence";
import { Redis } from "effect/unstable/persistence";

export type Run<A, E> = Workflow.Result<A, E>;
export type Services = WorkflowEngine | WorkflowEngine.WorkflowInstance;
export const engine = Engine;
export const queue = PersistedQueue.layer;
export const redis = Redis.make;
export const workflow = [
	WorkflowActivity,
	DurableQueue,
	Workflow,
	ClusterWorkflowEngine,
	SingleRunner,
];
export const shadowed = (PersistedQueueRedis: string) => PersistedQueueRedis;
