import { BunFileSystem } from "@effect/platform-bun";
import { expect, it } from "@effect/vitest";
import { SandboxRunError } from "@ryot-app/contract/errors";
import type { IngestionIssue, IngestionRun } from "@ryot-app/contract/modules/imports/ingestion";
import type { ImportRunFailureReason } from "@ryot-app/contract/modules/imports/schemas";
import { ImportRunId, IntegrationId } from "@ryot-app/contract/schema/brands";
import { Deferred, Effect, Fiber, Layer } from "effect";
import { TestClock } from "effect/testing";
import { Workflow } from "effect/unstable/workflow";
import { WorkflowEngine, WorkflowInstance } from "effect/unstable/workflow/WorkflowEngine";

import { SandboxArtifactStore } from "#lib/infrastructure/sandbox-runtime/artifacts";
import { makeAppConfigLayer, makeWorkflowEngine } from "#lib/test-utils/effect";
import { mutationAdmissionTestLayer } from "#lib/test-utils/mutation-admission";
import { SignalEmissionService } from "#modules/automations/signal-service";
import { IngestionExecution } from "#modules/imports/execution-service";
import {
	ingestionTestRun,
	ingestionTestScope,
	ingestionTestSource,
} from "#modules/imports/ingestion.test-support";
import { ImportsRepository } from "#modules/imports/repository";
import { SandboxExecutionService } from "#modules/sandbox/service";

import { IntegrationConfirmationError, IntegrationIngestion } from "./ingestion";
import { ProcessIntegrationRunWorkflow } from "./integration-workflow";
import { runIntegrationRunWorkflow } from "./integration-workflow-live";
import { IntegrationsRepository } from "./repository";
import { IntegrationsService } from "./service";
import { makeIntegration, makeRun } from "./test-support";

const integrationId = IntegrationId.make("integration-1");
const rootPayload = { ...ingestionTestScope, integrationId };

const rootCase = (
	status: IngestionRun["status"],
	failure: "none" | "source" | "suspend" = "none",
	options: {
		issues?: readonly IngestionIssue[];
		runId?: ImportRunId;
		start?: (runId: ImportRunId) => Effect.Effect<boolean>;
		execute?: Effect.Effect<void>;
		settle?: () => void;
		beforeSettle?: () => Effect.Effect<void, IntegrationConfirmationError>;
	} = {},
) =>
	Effect.gen(function* () {
		const payload = {
			...ingestionTestScope,
			integrationId,
			runId: options.runId ?? ingestionTestScope.runId,
		};
		let run = ingestionTestRun({ status, integrationId, collectionSealed: true });
		const executions: unknown[] = [];
		const settlements: string[] = [];
		const reasons: Array<ImportRunFailureReason | undefined> = [];
		const issues: IngestionIssue[] = [];
		const finished: unknown[] = [];
		const instance = WorkflowInstance.initial(ProcessIntegrationRunWorkflow, payload.runId);
		instance.suspended = failure === "suspend";
		const dependencies = Layer.mergeAll(
			mutationAdmissionTestLayer,
			BunFileSystem.layer,
			makeAppConfigLayer({
				fileStorage: { localTempDir: "/var/folders/x2/4ldmcvss5wlg5f5sfly3bqwm0000gn/T/opencode" },
			}),
			Layer.succeed(WorkflowInstance, instance),
			Layer.succeed(
				WorkflowEngine,
				makeWorkflowEngine({
					activityExecute: (activity) =>
						Effect.map(Effect.exit(activity.execute), (exit) => new Workflow.Complete({ exit })),
				}),
			),
			Layer.mock(ImportsRepository)({
				getIngestionRun: () => Effect.sync(() => run),
				recordIssue: (_scope, issue) =>
					Effect.sync(() => {
						issues.push(issue);
						return true;
					}),
				getRunById: () =>
					Effect.sync(() => ({
						...makeRun(run.status === "failed" ? "failed" : "completed"),
						status: run.status,
						finishedAt: "2026-06-17T12:00:00.000Z",
					})),
				startIntegrationIngestion: () =>
					(options.start ? options.start(payload.runId) : Effect.succeed(true)).pipe(
						Effect.tap((started) =>
							Effect.sync(() => {
								if (started) {
									run = { ...run, status: "running" };
								}
							}),
						),
					),
			}),
			Layer.mock(IngestionExecution)({ cleanup: () => Effect.void }),
			Layer.mock(IntegrationIngestion)({
				recoverInput: () =>
					Effect.succeed({
						...ingestionTestSource,
						sourcePayload: { ...ingestionTestSource.sourcePayload, integrationContext: {} },
					}),
				settle: (_scope, requested, reason) =>
					(options.beforeSettle ? options.beforeSettle() : Effect.void).pipe(
						Effect.andThen(
							Effect.sync(() => {
								settlements.push(requested);
								reasons.push(reason);
								run = { ...run, status: requested };
								options.settle?.();
								return true;
							}),
						),
					),
			}),
			Layer.mock(IntegrationsRepository)({
				listRecentHealthStatuses: () => Effect.succeed([]),
				getForUser: () =>
					Effect.succeed(makeIntegration({ id: integrationId, userId: payload.userId })),
			}),
			Layer.mock(IntegrationsService)({
				disableIfEnabled: () => Effect.succeed(false),
				recordRunFinished: (input) =>
					Effect.sync(() => {
						finished.push(input);
					}),
			}),
			Layer.mock(SignalEmissionService)({}),
			Layer.mock(SandboxArtifactStore)({
				retain: () => Effect.void,
				release: () => Effect.void,
				materializeOutputs: () => Effect.succeed(["durable-input-handle"]),
			}),
			Layer.mock(SandboxExecutionService)({
				executeWorkflow: (input) =>
					Effect.sync(() => {
						executions.push(input);
					}).pipe(
						Effect.andThen(options.execute ?? Effect.void),
						Effect.andThen(() => {
							if (failure === "suspend") {
								return Effect.interrupt;
							}
							if (failure === "source") {
								return Effect.fail(
									new SandboxRunError({ kind: "script-failure", message: "source failed" }),
								);
							}
							return Effect.succeed({ summary: [], issues: options.issues ?? [] });
						}),
					),
			}),
		);
		yield* runIntegrationRunWorkflow(payload, payload.runId).pipe(
			Effect.scoped,
			Effect.exit,
			Effect.provideContext(yield* Layer.build(dependencies)),
		);
		return { issues, reasons, finished, executions, settlements };
	});

it.effect(
	"runs retained executable state and settles a successful no-op at the integration root",
	() =>
		Effect.gen(function* () {
			const result = yield* rootCase("pending");
			expect(result.executions).toEqual([
				expect.objectContaining({
					executionId: `${rootPayload.runId}-import`,
					scriptId: ingestionTestSource.workflowScriptId,
					pluginRevision: ingestionTestSource.pluginRevision,
					input: expect.objectContaining({
						sourcePayloadHandle: "durable-input-handle",
						plan: { selection: {}, operation: "fixture" },
					}),
				}),
			]);
			expect(result.settlements).toEqual(["completed"]);
			expect(result.finished).toHaveLength(1);
		}),
);

it.effect("resumes a running root without replacing executable pins", () =>
	Effect.gen(function* () {
		const result = yield* rootCase("running");
		expect(result.executions).toEqual([
			expect.objectContaining({
				scriptId: ingestionTestSource.workflowScriptId,
				pluginRevision: ingestionTestSource.pluginRevision,
			}),
		]);
		expect(result.settlements).toEqual(["completed"]);
	}),
);

it.effect("settles cancellation before source execution", () =>
	Effect.gen(function* () {
		const result = yield* rootCase("cancelling");
		expect(result.executions).toEqual([]);
		expect(result.settlements).toEqual(["cancelled"]);
		expect(result.finished).toEqual([]);
	}),
);

it.effect("does not execute blocked or expired deliveries or contribute to health", () =>
	Effect.gen(function* () {
		for (const status of ["blocked", "expired", "cancelled"] as const) {
			const result = yield* rootCase(status);
			expect(result.executions).toEqual([]);
			expect(result.settlements).toEqual([]);
			expect(result.finished).toEqual([]);
		}
	}),
);

it.effect("recovers health finalization after settlement without replaying the source", () =>
	Effect.gen(function* () {
		const result = yield* rootCase("completed");
		expect(result.executions).toEqual([]);
		expect(result.settlements).toEqual([]);
		expect(result.finished).toHaveLength(1);
	}),
);

it.effect("fails source errors but preserves suspended work", () =>
	Effect.gen(function* () {
		expect((yield* rootCase("running", "source")).settlements).toEqual(["failed"]);
		expect((yield* rootCase("running", "suspend")).settlements).toEqual([]);
	}),
);

it.effect(
	"retains source-level failure reasons and keeps attributed record errors and warnings partial",
	() =>
		Effect.gen(function* () {
			const issue: IngestionIssue = {
				severity: "error",
				attribution: null,
				operationId: null,
				id: "source-failure",
				recordKind: "source",
				reason: { key: null, code: "input-transformation-failed" },
			};
			const failed = yield* rootCase("pending", "none", { issues: [issue] });
			expect(failed.settlements).toEqual(["failed"]);
			expect(failed.reasons).toEqual([{ code: "input-transformation-failed" }]);
			expect(failed.issues).toEqual([issue]);
			const partial = yield* rootCase("pending", "none", {
				issues: [
					{ ...issue, severity: "warning" },
					{
						...issue,
						attribution: { recordId: "record", sourceLabel: "row", sourceIdentifier: "id" },
					},
				],
			});
			expect(partial.settlements).toEqual(["completed"]);
			expect(partial.reasons).toEqual([undefined]);
		}),
);

it.effect(
	"retries the terminal owner after confirmation failure without recollecting or finishing health early",
	() =>
		Effect.gen(function* () {
			const failed = yield* Deferred.make<void>();
			let attempts = 0;
			const running = yield* rootCase("running", "none", {
				beforeSettle: () =>
					Effect.gen(function* () {
						attempts++;
						if (attempts === 1) {
							yield* Deferred.succeed(failed, undefined);
							return yield* new IntegrationConfirmationError({
								message: "Confirmation unavailable",
							});
						}
						return yield* Effect.void;
					}),
			}).pipe(Effect.forkChild);
			yield* Deferred.await(failed);
			yield* TestClock.adjust("1 second");
			const result = yield* Fiber.join(running);
			expect(attempts).toBe(2);
			expect(result.executions).toHaveLength(1);
			expect(result.settlements).toEqual(["completed"]);
			expect(result.finished).toHaveLength(1);
		}),
);

it.effect(
	"holds competing sink execution through application and releases a failed delivery before the next starts",
	() =>
		Effect.gen(function* () {
			const entered = yield* Deferred.make<void>();
			const release = yield* Deferred.make<void>();
			const waiting = yield* Deferred.make<void>();
			let owner: ImportRunId | null = null;
			let executions = 0;
			const start = Effect.fnUntraced(function* (runId: ImportRunId) {
				if (owner !== null && owner !== runId) {
					yield* Deferred.succeed(waiting, undefined);
					return false;
				}
				owner = runId;
				return true;
			});
			const first = yield* rootCase("pending", "source", {
				start,
				settle: () => {
					owner = null;
				},
				runId: ImportRunId.make("competing-first"),
				execute: Effect.sync(() => {
					executions++;
				}).pipe(
					Effect.andThen(Deferred.succeed(entered, undefined)),
					Effect.andThen(Deferred.await(release)),
				),
			}).pipe(Effect.forkChild);
			yield* Deferred.await(entered);
			const second = yield* rootCase("pending", "none", {
				start,
				settle: () => {
					owner = null;
				},
				runId: ImportRunId.make("competing-second"),
				execute: Effect.sync(() => {
					executions++;
				}),
			}).pipe(Effect.forkChild);
			yield* Deferred.await(waiting);
			expect(executions).toBe(1);
			yield* Deferred.succeed(release, undefined);
			const failed = yield* Fiber.join(first);
			expect(failed.settlements).toEqual(["failed"]);
			expect(failed.finished).toEqual([]);
			yield* TestClock.adjust("1 second");
			const completed = yield* Fiber.join(second);
			expect(completed.settlements).toEqual(["completed"]);
			expect(completed.finished).toHaveLength(1);
			expect(executions).toBe(2);
		}),
);
