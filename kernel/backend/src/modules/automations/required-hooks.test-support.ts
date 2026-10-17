import { DbError } from "@ryot-app/contract/errors";
import { AutomationRunId, type AutomationTriggerId } from "@ryot-app/contract/schema/brands";
import { Clock, Context, Effect, Layer, Ref, Schema } from "effect";
import { DurableDeferred } from "effect/workflow";
import { WorkflowEngine } from "effect/workflow/WorkflowEngine";

import { LifecycleDispatchRun } from "#modules/automations/lifecycle/planning";
import { implementWorkflow } from "#platform/workflow/scope";

import { automationAttemptIdentity } from "./attempt-repository";
import {
	type AutomationDispatch,
	AutomationExecutionOperations,
	dispatchStateOf,
} from "./execution";
import { AutomationRunWorkflow, type AutomationRunWorkflowResult } from "./run-workflow";

export const policyPatch = { resource: "entity", draft: { name: "Changed" } } as const;
export const policyOutput = { patch: policyPatch, action: "transform" } as const;
export interface RunBehavior {
	readonly closed?: true;
	readonly fail?: true;
	readonly hold?: true;
	readonly lateExit?: true;
	readonly policy?: true;
	readonly rejectSubmission?: true;
}

const runResult = (
	runId: AutomationRunId,
	status: "succeeded" | "failed",
	finishedAt: number,
	behavior: RunBehavior | undefined,
): AutomationRunWorkflowResult => ({
	policyOutput: behavior?.policy && status === "succeeded" ? policyOutput : null,
	attempt: {
		...automationAttemptIdentity(runId, 1),
		runId,
		status,
		timing: null,
		attemptNumber: 1,
		retryable: status === "failed",
		startedAt: new Date(0).toISOString(),
		finishedAt: new Date(finishedAt).toISOString(),
		failureKind: status === "failed" ? "sandbox-timeout" : null,
	},
});
export const requiredRun = (
	id: string,
	triggerId: AutomationTriggerId,
	delivery: "required" | "async" = "required",
) =>
	Schema.decodeSync(LifecycleDispatchRun)({
		id,
		delivery,
		triggerId,
		hookSlug: id,
		stage: "after",
		status: "queued",
	});
export const executionIdOf = (runId: string) =>
	automationAttemptIdentity(AutomationRunId.make(runId), 1).workflowExecutionId;

export class RunControl extends Context.Service<
	RunControl,
	{
		readonly behaviors: Ref.Ref<ReadonlyMap<string, RunBehavior>>;
		readonly started: Ref.Ref<ReadonlySet<string>>;
		readonly submitted: Ref.Ref<ReadonlyArray<string>>;
		readonly transactionActive: Ref.Ref<boolean>;
		readonly skipped: Ref.Ref<ReadonlyArray<string>>;
		readonly parentStarts: Ref.Ref<ReadonlyMap<string, number>>;
		readonly lateExitMs: number;
		readonly finished: Ref.Ref<
			ReadonlyMap<string, { status: "succeeded" | "failed"; finishedAt: number }>
		>;
	}
>()("test/RunControl") {}

export const behave = (behaviors: Readonly<Record<string, RunBehavior>>) =>
	Effect.flatMap(RunControl, (control) =>
		Ref.update(control.behaviors, (all) => new Map([...all, ...Object.entries(behaviors)])),
	);

const behaviorOf = (control: RunControl["Service"], runId: string) =>
	Effect.map(Ref.get(control.behaviors), (all) => all.get(runId));

const Release = DurableDeferred.make("release", { success: Schema.Void });
export const release = (runId: string) =>
	DurableDeferred.succeed(Release, {
		value: undefined,
		token: DurableDeferred.tokenFromExecutionId(Release, {
			workflow: AutomationRunWorkflow,
			executionId: executionIdOf(runId),
		}),
	});

export const runWorkflowLive = implementWorkflow(AutomationRunWorkflow, (payload) =>
	Effect.gen(function* () {
		const control = yield* RunControl;
		const behavior = yield* behaviorOf(control, payload.runId);
		yield* Ref.update(control.started, (all) => new Set(all).add(payload.runId));
		if (behavior?.hold) {
			yield* DurableDeferred.await(Release);
		}
		const status = behavior?.fail ? "failed" : "succeeded";
		const finishedAt = yield* Clock.currentTimeMillis;
		yield* Ref.update(control.finished, (all) =>
			new Map(all).set(payload.runId, { status, finishedAt }),
		);
		if (behavior?.lateExit) {
			yield* Effect.sleep(control.lateExitMs);
		}
		return runResult(payload.runId, status, finishedAt, behavior);
	}),
);

export const operationsLive = Layer.effect(
	AutomationExecutionOperations,
	Effect.gen(function* () {
		const control = yield* RunControl;
		const engine = yield* WorkflowEngine;
		return AutomationExecutionOperations.of({
			skipQueuedPolicies: ({ triggerId }) =>
				Ref.update(control.skipped, (all) => [...all, triggerId]),
			submit: (payload) =>
				Effect.gen(function* () {
					yield* Ref.update(control.submitted, (all) => [...all, payload.runId]);
					const behavior = yield* behaviorOf(control, payload.runId);
					yield* behavior?.rejectSubmission
						? Effect.fail(new DbError({ message: "offline" }))
						: engine.execute(AutomationRunWorkflow, {
								payload,
								discard: true,
								executionId: executionIdOf(payload.runId),
							});
				}),
			dispatchStates: (runIds) =>
				Effect.all([Ref.get(control.started), Ref.get(control.behaviors)]).pipe(
					Effect.map(
						([started, behaviors]) =>
							new Map(
								runIds.map((runId): [AutomationRunId, AutomationDispatch] => [
									runId,
									{
										state: dispatchStateOf({
											attemptCount: started.has(runId) ? 1 : 0,
											status: behaviors.get(runId)?.closed ? "skipped" : "queued",
										}),
									},
								]),
							),
					),
				),
			settle: (payload, deadline) =>
				Effect.all([Ref.get(control.finished), Ref.get(control.behaviors)]).pipe(
					Effect.map(([all, behaviors]) => {
						const finished = all.get(payload.runId);
						return finished && finished.finishedAt < deadline
							? ({
									_tag: "completed",
									result: runResult(
										payload.runId,
										finished.status,
										finished.finishedAt,
										behaviors.get(payload.runId),
									),
								} as const)
							: ({ _tag: "pending" } as const);
					}),
				),
		});
	}),
);

export const runControlLayer = (lateExitMs: number) =>
	Layer.effect(
		RunControl,
		Effect.all({
			transactionActive: Ref.make(false),
			lateExitMs: Effect.succeed(lateExitMs),
			skipped: Ref.make<ReadonlyArray<string>>([]),
			submitted: Ref.make<ReadonlyArray<string>>([]),
			started: Ref.make<ReadonlySet<string>>(new Set()),
			parentStarts: Ref.make<ReadonlyMap<string, number>>(new Map()),
			behaviors: Ref.make<ReadonlyMap<string, RunBehavior>>(new Map()),
			finished: Ref.make<
				ReadonlyMap<string, { status: "succeeded" | "failed"; finishedAt: number }>
			>(new Map()),
		}),
	);
