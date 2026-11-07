import { DbError } from "@ryot-app/contract/errors";
import {
	AutomationHookSlug,
	AutomationRunId,
	type AutomationTriggerId,
} from "@ryot-app/contract/schema/brands";
import { Clock, Context, Effect, Layer, Ref } from "effect";

import { LifecycleDispatchRun } from "#modules/automations/lifecycle/planning";

import { automationAttemptIdentity } from "./attempt-repository";
import {
	type AutomationDispatch,
	AutomationExecutionOperations,
	dispatchStateOf,
} from "./execution";
import type { AutomationRunResult } from "./run-job";

export const policyPatch = { resource: "entity", draft: { name: "Changed" } } as const;
export const policyOutput = { patch: policyPatch, action: "transform" } as const;
export interface RunBehavior {
	readonly fail?: true;
	readonly hold?: true;
	readonly closed?: true;
	readonly policy?: true;
	readonly rejectSubmission?: true;
}

const runResult = (
	runId: AutomationRunId,
	status: "failed" | "succeeded",
	finishedAt: number,
	behavior: undefined | RunBehavior,
): AutomationRunResult => ({
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
	delivery: "async" | "required" = "required",
) =>
	LifecycleDispatchRun.make({
		delivery,
		triggerId,
		stage: "after",
		status: "queued",
		id: AutomationRunId.make(id),
		hookSlug: AutomationHookSlug.make(id),
	});
export const executionIdOf = (runId: string) =>
	automationAttemptIdentity(AutomationRunId.make(runId), 1).executionId;

export class RunControl extends Context.Service<
	RunControl,
	{
		readonly transactionActive: Ref.Ref<boolean>;
		readonly started: Ref.Ref<ReadonlySet<string>>;
		readonly skipped: Ref.Ref<ReadonlyArray<string>>;
		readonly submitted: Ref.Ref<ReadonlyArray<string>>;
		readonly parentStarts: Ref.Ref<ReadonlyMap<string, number>>;
		readonly behaviors: Ref.Ref<ReadonlyMap<string, RunBehavior>>;
		readonly finished: Ref.Ref<
			ReadonlyMap<string, { finishedAt: number; status: "failed" | "succeeded" }>
		>;
	}
>()("@ryot-app/kernel-backend/modules/automations/required-hooks.test-support/RunControl") {}

export const behave = (behaviors: Readonly<Record<string, RunBehavior>>) =>
	Effect.flatMap(RunControl, (control) =>
		Ref.update(control.behaviors, (all) => new Map([...all, ...Object.entries(behaviors)])),
	);

const behaviorOf = (control: RunControl["Service"], runId: string) =>
	Effect.map(Ref.get(control.behaviors), (all) => all.get(runId));

const finish = (control: RunControl["Service"], runId: string) =>
	Effect.gen(function* () {
		const behavior = yield* behaviorOf(control, runId);
		const finishedAt = yield* Clock.currentTimeMillis;
		const status = behavior?.fail ? ("failed" as const) : ("succeeded" as const);
		yield* Ref.update(control.finished, (all) => new Map(all).set(runId, { status, finishedAt }));
	});

export const release = (runId: string) =>
	Effect.flatMap(RunControl, (control) => finish(control, runId));

export const operationsLive = Layer.effect(
	AutomationExecutionOperations,
	Effect.gen(function* () {
		const control = yield* RunControl;
		return AutomationExecutionOperations.of({
			skipQueuedPolicies: ({ triggerId }) =>
				Ref.update(control.skipped, (all) => [...all, triggerId]),
			submit: (payload) =>
				Effect.gen(function* () {
					yield* Ref.update(control.submitted, (all) => [...all, payload.runId]);
					const behavior = yield* behaviorOf(control, payload.runId);
					if (behavior?.rejectSubmission) {
						return yield* new DbError({ message: "offline" });
					}
					yield* Ref.update(control.started, (all) => new Set(all).add(payload.runId));
					return yield* behavior?.hold ? Effect.void : finish(control, payload.runId);
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

export const runControlLayer = Layer.effect(
	RunControl,
	Effect.all({
		transactionActive: Ref.make(false),
		skipped: Ref.make<ReadonlyArray<string>>([]),
		submitted: Ref.make<ReadonlyArray<string>>([]),
		started: Ref.make<ReadonlySet<string>>(new Set()),
		parentStarts: Ref.make<ReadonlyMap<string, number>>(new Map()),
		behaviors: Ref.make<ReadonlyMap<string, RunBehavior>>(new Map()),
		finished: Ref.make<ReadonlyMap<string, { finishedAt: number; status: "failed" | "succeeded" }>>(
			new Map(),
		),
	}),
);
