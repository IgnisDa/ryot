/* keep workflow import context */
import {
	Activity as WorkflowActivity,
	type DurableClock,
	DurableQueue,
	Workflow,
} from "@effect/workflow";
import type { Result as WorkflowResult } from "@effect/workflow/Workflow";
import type { WorkflowEngine, WorkflowInstance } from "@effect/workflow/WorkflowEngine";
import { WorkflowEngine as Engine } from "@effect/workflow/WorkflowEngine";
import { ClusterWorkflowEngine, SingleRunner } from "@effect/cluster";
import * as PersistedQueue from "@effect/experimental/PersistedQueue";
import * as PersistedQueueRedis from "@effect/experimental/PersistedQueue/Redis";

export type Run<A, E> = WorkflowResult<A, E>;
export type Services = WorkflowEngine | WorkflowInstance;
export const engine = Engine;
export const queue = PersistedQueue.layer;
export const redis = PersistedQueueRedis.make;
export const workflow = [
	WorkflowActivity,
	DurableQueue,
	Workflow,
	ClusterWorkflowEngine,
	SingleRunner,
];
export const shadowed = (PersistedQueueRedis: string) => PersistedQueueRedis;
