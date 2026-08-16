import { expect, it } from "@effect/vitest";
import { DbError } from "@ryot-app/contract/errors";
import {
	AutomationRequestPayload,
	AutomationRun,
} from "@ryot-app/contract/modules/automations/lifecycle";
import { AutomationRunId } from "@ryot-app/contract/schema/brands";
import { Cause, Deferred, Duration, Effect, Fiber, Layer, Schema } from "effect";
import { TestClock } from "effect/testing";
import { WorkflowEngine } from "effect/unstable/workflow/WorkflowEngine";

import {
	AutomationPolicyExecutionError,
	LifecycleExecution,
} from "#lib/domain/lifecycle-execution";
import { assertExitFails } from "#lib/test-utils/assertions";
import { databaseLayer, makeWorkflowEngine } from "#lib/test-utils/effect";

import { automationAttemptIdentity } from "./attempt-repository";
import {
	AUTOMATION_IMMEDIATE_CONCURRENCY,
	AUTOMATION_IMMEDIATE_TIMEOUT_MS,
	AutomationExecutionOperations,
	AutomationExecutionOperationsLive,
	LifecycleExecutionLive,
} from "./execution";
import { triggerFixture } from "./lifecycle.test-support";
import { AutomationRunRepository } from "./run-repository";
import { AutomationRunWorkflowPayload, type AutomationRunWorkflowResult } from "./run-workflow";

const trigger = triggerFixture();
const run = (id: string, delivery: "required" | "async" = "required") =>
	Schema.decodeSync(AutomationRun)({
		id,
		delivery,
		hookSlug: id,
		hookName: id,
		stage: "after",
		pluginId: null,
		scriptSlug: id,
		attemptCount: 0,
		startedAt: null,
		status: "queued",
		finishedAt: null,
		skipReason: null,
		nextAttemptAt: null,
		triggerId: trigger.id,
		executionUserId: null,
		pluginRevisionId: null,
		scriptContentHash: "hash",
		sandboxScriptId: "script",
		queuedAt: trigger.createdAt,
		pluginConfigRevisionId: null,
		artifactsExpireAt: "2026-09-22T00:00:00.000Z",
		retryPolicy: {
			maxAttempts: 3,
			maxDelayMs: 10000,
			initialDelayMs: 1000,
			externalIdempotency: "none",
		},
	});
const result = (
	runId: AutomationRunId,
	status: "succeeded" | "failed" = "succeeded",
): AutomationRunWorkflowResult => ({
	policyOutput: null,
	attempt: {
		...automationAttemptIdentity(runId, 1),
		runId,
		status,
		timing: null,
		attemptNumber: 1,
		startedAt: trigger.createdAt,
		finishedAt: trigger.createdAt,
		retryable: status === "failed",
		failureKind: status === "failed" ? "sandbox-timeout" : null,
	},
});
const layer = (operations: AutomationExecutionOperations["Service"]) =>
	LifecycleExecutionLive.pipe(
		Layer.provide(Layer.succeed(AutomationExecutionOperations, operations)),
	);
const policyPayload = Schema.decodeSync(AutomationRequestPayload)({
	resource: "entity",
	category: "request",
	operation: "create",
	draft: {
		properties: {},
		name: "Changed",
		providerId: null,
		externalId: null,
		populatedAt: null,
		entitySchemaSlug: "record",
	},
});

it.effect(
	"runs required hooks concurrently with all-settled warnings and discards async failures",
	() =>
		Effect.gen(function* () {
			const started = yield* Deferred.make<void>();
			let active = 0;
			const submissions: string[] = [];
			const runs = [run("success"), run("retry"), run("submission-failed"), run("async", "async")];
			const operations = AutomationExecutionOperations.of({
				skipQueuedPolicies: () => Effect.void,
				submit: ({ runId }) =>
					Effect.gen(function* () {
						submissions.push(runId);
						return yield* new DbError({ message: "async failure" });
					}),
				execute: ({ runId }) =>
					Effect.gen(function* () {
						active += 1;
						if (active === 3) {
							yield* Deferred.succeed(started, undefined);
						}
						yield* Deferred.await(started);
						if (runId === "submission-failed") {
							return yield* new DbError({ message: "offline" });
						}
						return result(runId, runId === "retry" ? "failed" : "succeeded");
					}),
			});
			const warnings = yield* Effect.flatMap(LifecycleExecution, (service) =>
				service.after({ runs, triggerId: trigger.id }),
			).pipe(Effect.provide(layer(operations)));
			expect(warnings).toEqual([
				{ runId: "retry", hookSlug: "retry", code: "required-hook-failed" },
				{
					runId: "submission-failed",
					code: "required-hook-pending",
					hookSlug: "submission-failed",
				},
			]);
			expect(submissions).toEqual(["async"]);
		}),
);

it.effect("bounds the whole fan-out by one deadline and never exceeds submission concurrency", () =>
	Effect.gen(function* () {
		let active = 0;
		let peak = 0;
		const asyncStarted = yield* Deferred.make<void>();
		const operations = AutomationExecutionOperations.of({
			skipQueuedPolicies: () => Effect.void,
			submit: () => Deferred.succeed(asyncStarted, undefined).pipe(Effect.asVoid),
			execute: () =>
				Effect.gen(function* () {
					active += 1;
					peak = Math.max(peak, active);
					return yield* Effect.never.pipe(
						Effect.ensuring(
							Effect.sync(() => {
								active -= 1;
							}),
						),
					);
				}),
		});
		const runs = Array.from({ length: AUTOMATION_IMMEDIATE_CONCURRENCY + 2 }, (_, i) =>
			run(`hook-${i}`),
		);
		const fiber = yield* Effect.flatMap(LifecycleExecution, (service) =>
			service.after({ triggerId: trigger.id, runs: [...runs, run("async", "async")] }),
		).pipe(Effect.provide(layer(operations)), Effect.forkChild);
		yield* Deferred.await(asyncStarted);
		yield* TestClock.adjust(Duration.millis(AUTOMATION_IMMEDIATE_TIMEOUT_MS));
		const warnings = yield* Fiber.join(fiber);
		expect(peak).toBe(AUTOMATION_IMMEDIATE_CONCURRENCY);
		expect(active).toBe(0);
		expect(warnings).toEqual(
			runs.map((planned) => ({
				runId: planned.id,
				hookSlug: planned.hookSlug,
				code: "required-hook-pending",
			})),
		);
	}),
);

it.effect("preserves durable suspension while waiting for a required hook", () =>
	Effect.gen(function* () {
		const operations = AutomationExecutionOperations.of({
			submit: () => Effect.void,
			execute: () => Effect.interrupt,
			skipQueuedPolicies: () => Effect.void,
		});
		const exit = yield* Effect.flatMap(LifecycleExecution, (service) =>
			service.after({ triggerId: trigger.id, runs: [run("required")] }),
		).pipe(Effect.provide(layer(operations)), Effect.exit);
		expect(exit._tag).toBe("Failure");
		if (exit._tag === "Failure") {
			expect(Cause.hasInterruptsOnly(exit.cause)).toBe(true);
		}
	}),
);

it.effect("returns policy output and maps infrastructure failures to the stable run-ID error", () =>
	Effect.gen(function* () {
		const submitted: AutomationRunWorkflowPayload[] = [];
		const operations = AutomationExecutionOperations.of({
			submit: () => Effect.void,
			skipQueuedPolicies: () => Effect.void,
			execute: (payload) =>
				Effect.gen(function* () {
					submitted.push(payload);
					if (payload.runId === "db") {
						return yield* new DbError({ message: "private database connection details" });
					}
					if (payload.runId === "defect") {
						return yield* Effect.die("private infrastructure details");
					}
					const completed = result(
						payload.runId,
						payload.runId === "failed" ? "failed" : "succeeded",
					);
					if (completed.attempt === null) {
						return yield* Effect.die("Expected completed attempt fixture");
					}
					return {
						...completed,
						policyOutput: { payload: policyPayload, action: "transform" as const },
					};
				}),
		});
		yield* Effect.gen(function* () {
			const service = yield* LifecycleExecution;
			expect(
				yield* service.executePolicy({
					payload: policyPayload,
					runId: AutomationRunId.make("accepted"),
				}),
			).toEqual({ action: "transform", payload: policyPayload });
			assertExitFails(
				yield* Effect.exit(
					service.executePolicy({ payload: policyPayload, runId: AutomationRunId.make("failed") }),
				),
				new AutomationPolicyExecutionError({
					code: "policy-execution-failed",
					runId: AutomationRunId.make("failed"),
				}),
			);
			assertExitFails(
				yield* Effect.exit(
					service.executePolicy({ payload: policyPayload, runId: AutomationRunId.make("db") }),
				),
				new AutomationPolicyExecutionError({
					code: "policy-execution-failed",
					runId: AutomationRunId.make("db"),
				}),
			);
			assertExitFails(
				yield* Effect.exit(
					service.executePolicy({ payload: policyPayload, runId: AutomationRunId.make("defect") }),
				),
				new AutomationPolicyExecutionError({
					code: "policy-execution-failed",
					runId: AutomationRunId.make("defect"),
				}),
			);
		}).pipe(Effect.provide(layer(operations)));
		expect(submitted).toEqual(
			["accepted", "failed", "db", "defect"].map((runId) => ({
				runId,
				policyPayload,
				attemptNumber: 1,
			})),
		);
	}),
);

it.effect("bounds policy waiting with the stable run-ID error and no later attempt", () =>
	Effect.gen(function* () {
		const submitted: AutomationRunWorkflowPayload[] = [];
		const runId = AutomationRunId.make("policy");
		const operations = AutomationExecutionOperations.of({
			submit: () => Effect.void,
			skipQueuedPolicies: () => Effect.void,
			execute: (payload) =>
				Effect.gen(function* () {
					submitted.push(payload);
					return yield* Effect.never;
				}),
		});
		const fiber = yield* Effect.flatMap(LifecycleExecution, (service) =>
			service.executePolicy({ runId, payload: policyPayload }),
		).pipe(Effect.provide(layer(operations)), Effect.exit, Effect.forkChild);
		yield* TestClock.adjust(Duration.millis(AUTOMATION_IMMEDIATE_TIMEOUT_MS));
		assertExitFails(
			yield* Fiber.join(fiber),
			new AutomationPolicyExecutionError({ runId, code: "policy-execution-failed" }),
		);
		expect(submitted).toEqual([{ runId, policyPayload, attemptNumber: 1 }]);
	}),
);

it.effect("submits deterministic workflow IDs and sets discard only for async delivery", () =>
	Effect.gen(function* () {
		const captured: Array<{
			executionId: string;
			discard: boolean;
			payload: AutomationRunWorkflowPayload;
		}> = [];
		const engine = makeWorkflowEngine({
			execute: (_workflow, options) =>
				Effect.gen(function* () {
					const payload = yield* Schema.decodeUnknownEffect(AutomationRunWorkflowPayload)(
						options.payload,
					);
					captured.push({
						payload,
						executionId: options.executionId,
						discard: options.discard === true,
					});
					return options.discard ? undefined : result(payload.runId);
				}),
		});
		yield* Effect.gen(function* () {
			const operations = yield* AutomationExecutionOperations;
			yield* operations.execute({ attemptNumber: 1, runId: AutomationRunId.make("required") });
			yield* operations.submit({ attemptNumber: 1, runId: AutomationRunId.make("async") });
		}).pipe(
			Effect.provide(
				AutomationExecutionOperationsLive.pipe(
					Layer.provide(
						Layer.mergeAll(
							Layer.succeed(WorkflowEngine, engine),
							AutomationRunRepository.layer,
							databaseLayer,
						),
					),
				),
			),
		);
		expect(captured).toEqual(
			["required", "async"].map((id) => ({
				discard: id === "async",
				payload: { runId: id, attemptNumber: 1 },
				executionId: automationAttemptIdentity(AutomationRunId.make(id), 1).workflowExecutionId,
			})),
		);
	}),
);

it.effect(
	"closes the abandoned trigger through the execution port and preserves cleanup DbError",
	() =>
		Effect.gen(function* () {
			const closed: string[] = [];
			const failure = new DbError({ message: "cleanup unavailable" });
			const operations = AutomationExecutionOperations.of({
				submit: () => Effect.die("unused"),
				execute: () => Effect.die("unused"),
				skipQueuedPolicies: ({ triggerId }) =>
					Effect.gen(function* () {
						closed.push(triggerId);
						if (closed.length === 2) {
							return yield* failure;
						}
						return undefined;
					}),
			});
			yield* Effect.gen(function* () {
				const service = yield* LifecycleExecution;
				yield* service.skipQueuedPolicies({ triggerId: trigger.id });
				assertExitFails(
					yield* Effect.exit(service.skipQueuedPolicies({ triggerId: trigger.id })),
					failure,
				);
			}).pipe(Effect.provide(layer(operations)));
			expect(closed).toEqual([trigger.id, trigger.id]);
		}),
);
