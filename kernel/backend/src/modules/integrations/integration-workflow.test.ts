import { expect } from "bun:test";

import { SandboxRunError } from "@ryot-app/contract/errors";
import type { IngestionIssue, IngestionRun } from "@ryot-app/contract/modules/imports/ingestion";
import type { ImportRunFailureReason } from "@ryot-app/contract/modules/imports/schemas";
import { ImportRunId, IntegrationId } from "@ryot-app/contract/schema/brands";
import { unavailableMessage } from "@ryot-app/i18n/message";
import { ExecutionFileStore } from "@ryot-app/sandbox/host/execution-files";
import { partialFake } from "@ryot-app/testing/fakes";
import { objectContaining } from "@ryot-app/testing/matchers";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { it } from "@voila.dev/effect-bun-test";
import { Deferred, Effect, Fiber, Layer } from "effect";
import { TestClock } from "effect/testing";
import { Workflow } from "effect/workflow";
import { WorkflowEngine, WorkflowInstance } from "effect/workflow/WorkflowEngine";

import { ChangeSets } from "#modules/changes/service";
import { DefinitionCatalog, type UserCatalog } from "#modules/definitions/catalog";
import { DefinitionRepository } from "#modules/definitions/repository";
import { IngestionCaptures } from "#modules/imports/capture-service";
import { IngestionExecution } from "#modules/imports/execution-service";
import {
	ingestionTestRun,
	ingestionTestScope,
	ingestionTestSource,
	unusedDataImportServices,
} from "#modules/imports/ingestion.test-support";
import { ImportsRepository } from "#modules/imports/repository";
import { mutationAdmissionTestLayer } from "#modules/mutations/admission.test-support";
import { ScriptExecutionService } from "#modules/scripts/executions/service";
import { ActivityBody } from "#platform/workflow/scope";
import { makeWorkflowEngine, workflowAccountsTestLayer } from "#testing/effect";

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
		disables?: true;
		runId?: ImportRunId;
		settle?: () => void;
		execute?: Effect.Effect<void>;
		issues?: readonly IngestionIssue[];
		start?: (runId: ImportRunId) => Effect.Effect<boolean>;
		beforeSettle?: () => Effect.Effect<void, IntegrationConfirmationError>;
	} = {},
) =>
	Effect.gen(function* () {
		const payload = {
			...ingestionTestScope,
			integrationId,
			accountUserId: ingestionTestScope.userId,
			runId: options.runId ?? ingestionTestScope.runId,
		};
		let run = ingestionTestRun({ status, integrationId, collectionSealed: true });
		const executions: unknown[] = [];
		const settlements: string[] = [];
		const reasons: Array<undefined | ImportRunFailureReason> = [];
		const issues: IngestionIssue[] = [];
		const finished: unknown[] = [];
		const storedInputs: Array<{ owner: string; outputs: ReadonlyArray<Uint8Array> }> = [];
		const commits: unknown[] = [];
		const instance = WorkflowInstance.initial(ProcessIntegrationRunWorkflow, payload.runId);
		instance.suspended = failure === "suspend";
		const dependencies = Layer.mergeAll(
			unusedDataImportServices,
			Layer.mock(DefinitionRepository)({}),
			Layer.mock(DefinitionCatalog)({
				forUser: () => Effect.succeed(partialFake<UserCatalog>({ integrationProviders: [] })),
			}),
			Layer.mock(IngestionCaptures)({}),
			mutationAdmissionTestLayer,
			workflowAccountsTestLayer,
			Layer.succeed(WorkflowInstance, instance),
			Layer.succeed(
				WorkflowEngine,
				makeWorkflowEngine({
					activityExecute: (activity) =>
						Effect.map(Effect.exit(activity.execute), (exit) => new Workflow.Complete({ exit })),
				}),
			),
			Layer.mock(ImportsRepository)({
				getIngestionRunControl: () => Effect.sync(() => run),
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
				getForUser: () =>
					Effect.succeed(makeIntegration({ id: integrationId, userId: payload.userId })),
				listRecentHealthStatuses: () =>
					Effect.succeed(
						options.disables ? Array.from({ length: 5 }, () => ({ status: "failed" })) : [],
					),
			}),
			Layer.mock(IntegrationsService)({
				disableIfEnabled: () => Effect.succeed(options.disables === true),
				recordRunFinished: (input) =>
					Effect.sync(() => {
						finished.push(input);
					}),
			}),
			Layer.mock(ChangeSets)({
				commit: (changes, command, commitOptions) =>
					Effect.gen(function* () {
						commits.push({ changes, command, commitOptions, inActivity: yield* ActivityBody });
						return partialFake<Effect.Success<ReturnType<ChangeSets["Service"]["commit"]>>>({});
					}),
			}),
			Layer.mock(ExecutionFileStore)({
				retain: () => Effect.void,
				release: () => Effect.void,
				materializeOutputs: (owner, outputs) =>
					Effect.sync(() => {
						storedInputs.push({ owner, outputs });
						return ["durable-input-handle"];
					}),
			}),
			Layer.mock(ScriptExecutionService)({
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
		return { issues, commits, reasons, finished, executions, settlements, storedInputs };
	});

it.effect(
	"runs retained executable state and settles a successful no-op at the integration root",
	() =>
		Effect.gen(function* () {
			const result = yield* rootCase("pending");
			expect(result.storedInputs).toEqual([
				{
					owner: `${rootPayload.runId}-import`,
					outputs: [
						new TextEncoder().encode('{"apiKey":"private-credential","integrationContext":{}}'),
					],
				},
			]);
			expect(result.executions).toEqual([
				objectContaining({
					lane: "background",
					executionId: `${rootPayload.runId}-import`,
					scriptId: ingestionTestSource.workflowScriptId,
					pluginRevision: ingestionTestSource.pluginRevision,
					input: objectContaining({
						sourcePayloadHandle: "durable-input-handle",
						plan: { selection: {}, operation: "fixture" },
					}),
				}),
			]);
			expect(result.settlements).toEqual(["completed"]);
			expect(result.finished).toHaveLength(1);
		}),
	testTimeout,
);

it.effect(
	"resumes a running root without replacing executable pins",
	() =>
		Effect.gen(function* () {
			const result = yield* rootCase("running");
			expect(result.executions).toEqual([
				objectContaining({
					scriptId: ingestionTestSource.workflowScriptId,
					pluginRevision: ingestionTestSource.pluginRevision,
				}),
			]);
			expect(result.settlements).toEqual(["completed"]);
		}),
	testTimeout,
);

it.effect(
	"settles cancellation before source execution",
	() =>
		Effect.gen(function* () {
			const result = yield* rootCase("cancelling");
			expect(result.executions).toEqual([]);
			expect(result.settlements).toEqual(["cancelled"]);
			expect(result.finished).toEqual([]);
		}),
	testTimeout,
);

it.effect(
	"does not execute blocked or expired deliveries or contribute to health",
	() =>
		Effect.gen(function* () {
			for (const status of ["blocked", "expired", "cancelled"] as const) {
				const result = yield* rootCase(status);
				expect(result.executions).toEqual([]);
				expect(result.settlements).toEqual([]);
				expect(result.finished).toEqual([]);
			}
		}),
	testTimeout,
);

it.effect(
	"recovers health finalization after settlement without replaying the source",
	() =>
		Effect.gen(function* () {
			const result = yield* rootCase("completed");
			expect(result.executions).toEqual([]);
			expect(result.settlements).toEqual([]);
			expect(result.finished).toHaveLength(1);
		}),
	testTimeout,
);

it.effect(
	"fails source errors but preserves suspended work",
	() =>
		Effect.gen(function* () {
			expect((yield* rootCase("running", "source")).settlements).toEqual(["failed"]);
			expect((yield* rootCase("running", "suspend")).settlements).toEqual([]);
		}),
	testTimeout,
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
	testTimeout,
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
	testTimeout,
);

it.effect(
	"holds competing sink execution through application and releases a failed delivery before the next starts",
	() =>
		Effect.gen(function* () {
			const entered = yield* Deferred.make<void>();
			const release = yield* Deferred.make<void>();
			const waiting = yield* Deferred.make<void>();
			let owner: null | ImportRunId = null;
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
	testTimeout,
);

it.effect(
	"commits the integration.disabled signal through ChangeSets in an activity when the run disables the integration",
	() =>
		Effect.gen(function* () {
			const result = yield* rootCase("running", "source", { disables: true });
			expect(result.settlements).toEqual(["failed"]);
			expect(result.commits).toEqual([
				{
					inActivity: true,
					commitOptions: {},
					command: objectContaining({
						writeContext: null,
						itemIdentity: stableStringify(["integration-run", rootPayload.runId]),
					}),
					changes: {
						userId: rootPayload.userId,
						signals: [
							{
								itemIdentity: "signal",
								principal: { kind: "user", userId: rootPayload.userId },
								properties: { integrationId, providerName: unavailableMessage },
								reference: { owner: { kind: "kernel" }, slug: "integration.disabled" },
							},
						],
					},
				},
			]);
			expect((yield* rootCase("running", "source")).commits).toEqual([]);
		}),
	testTimeout,
);
