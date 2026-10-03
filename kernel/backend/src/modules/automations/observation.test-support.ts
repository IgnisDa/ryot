import { DbError } from "@ryot-app/contract/errors";
import { AutomationRunId } from "@ryot-app/contract/schema/brands";
import { Clock, Context, Effect, Layer, Ref, Schema } from "effect";
import { DurableDeferred } from "effect/workflow";
import { WorkflowEngine } from "effect/workflow/WorkflowEngine";

import { implementWorkflow } from "#lib/infrastructure/workflow-scope";

import { automationAttemptIdentity } from "./attempt-repository";
import { AutomationExecutionOperations } from "./execution";
import { AutomationRunWorkflow, type AutomationRunWorkflowResult } from "./run-workflow";

export const policyPatch = { resource: "entity", draft: { name: "Changed" } } as const;
export const policyOutput = { patch: policyPatch, action: "transform" } as const;
const runResult = (
	runId: AutomationRunId,
	status: "succeeded" | "failed",
	finishedAt: number,
): AutomationRunWorkflowResult => ({
	policyOutput: runId.startsWith("policy") && status === "succeeded" ? policyOutput : null,
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
export const executionIdOf = (runId: string) =>
	automationAttemptIdentity(AutomationRunId.make(runId), 1).workflowExecutionId;

// Runs named `held*` wait for `Release`; runs named `late*` finish their attempt immediately but
// exit only after the deadline; `*failed*` runs fail; `submission-failed*` runs are never submitted.
export class RunControl extends Context.Service<
	RunControl,
	{
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
		if (payload.runId.startsWith("held")) {
			yield* DurableDeferred.await(Release);
		}
		const status = payload.runId.includes("failed") ? "failed" : "succeeded";
		const finishedAt = yield* Clock.currentTimeMillis;
		yield* Ref.update(control.finished, (all) =>
			new Map(all).set(payload.runId, { status, finishedAt }),
		);
		if (payload.runId.startsWith("late")) {
			yield* Effect.sleep(control.lateExitMs);
		}
		return runResult(payload.runId, status, finishedAt);
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
			settle: (payload, deadline) =>
				Ref.get(control.finished).pipe(
					Effect.map((all) => {
						const finished = all.get(payload.runId);
						return finished && finished.finishedAt < deadline
							? ({
									_tag: "completed",
									result: runResult(payload.runId, finished.status, finished.finishedAt),
								} as const)
							: ({ _tag: "expired" } as const);
					}),
				),
			submit: (payload) =>
				Ref.update(control.submitted, (all) => [...all, payload.runId]).pipe(
					Effect.andThen(
						payload.runId.startsWith("submission-failed")
							? Effect.fail(new DbError({ message: "offline" }))
							: engine.execute(AutomationRunWorkflow, {
									payload,
									discard: true,
									executionId: executionIdOf(payload.runId),
								}),
					),
					Effect.asVoid,
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
			parentStarts: Ref.make<ReadonlyMap<string, number>>(new Map()),
			finished: Ref.make<
				ReadonlyMap<string, { status: "succeeded" | "failed"; finishedAt: number }>
			>(new Map()),
		}),
	);
