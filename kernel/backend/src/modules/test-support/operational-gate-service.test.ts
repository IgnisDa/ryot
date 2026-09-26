import { expect, layer } from "@effect/vitest";
import { NotFound } from "@ryot-app/contract/errors";
import {
	EntitySchemaSlug,
	ImportRunId,
	PluginSlug,
	SandboxProviderId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { Context, Effect, Layer, Ref } from "effect";

import { RedisService } from "#lib/infrastructure/redis";
import { assertExitFails } from "#lib/test-utils/assertions";
import { makeRedisService } from "#lib/test-utils/effect";
import { mutationAdmissionTestLayer } from "#lib/test-utils/mutation-admission";
import { ImportsService } from "#modules/imports/service";
import { PluginRuntimeResolver } from "#modules/plugins/runtime-resolver";
import { fixtureManifest } from "#modules/plugins/test-support";
import { SandboxExecutionService } from "#modules/sandbox/service";

import { OperationalGateService } from "./operational-gate-service";

const runId = ImportRunId.make("run-id");
const executingUserId = UserId.make("user-id");
const mockImports = Layer.mock(ImportsService);
const mockSandbox = Layer.mock(SandboxExecutionService);

const gateInput = {
	itemCount: 1,
	executingUserId,
	source: "fixture-source",
	workflowSlug: "fixture-workflow",
	identifierPrefix: "fixture-item",
	pluginSlug: PluginSlug.make("fixture-plugin"),
	providerId: SandboxProviderId.make("fixture-provider"),
	entitySchemaSlug: EntitySchemaSlug.make("fixture-entity"),
};

const importRun = {
	id: runId,
	progress: 0,
	failedItems: 0,
	startedAt: null,
	totalItems: null,
	inputSummary: {},
	finishedAt: null,
	importedItems: 0,
	processedItems: 0,
	failureReason: null,
	source: gateInput.source,
	status: "pending" as const,
	createdAt: "2026-07-30T00:00:00.000Z",
	updatedAt: "2026-07-30T00:00:00.000Z",
};

const availablePlugin = {
	config: {},
	isHidden: false,
	ownerUserId: null,
	compiledHashes: {},
	scope: "system" as const,
	health: "ready" as const,
	sourceHash: "source-hash",
	slug: gateInput.pluginSlug,
	manifest: fixtureManifest(),
	id: "fixture-plugin-plugin-id",
	pluginRevisionId: "fixture-plugin-revision",
	installationId: "fixture-plugin-installation",
	pluginConfigRevisionId: "fixture-plugin-config-revision",
};

class FakeWorkflowLoad extends Context.Service<
	FakeWorkflowLoad,
	{
		readonly enqueued: Effect.Effect<ReadonlyArray<unknown>>;
		readonly updates: Effect.Effect<ReadonlyArray<unknown>>;
		readonly polledExecutionIds: Effect.Effect<ReadonlyArray<string>>;
		readonly completeExecutions: Effect.Effect<void>;
	}
>()("test/FakeWorkflowLoad") {}

const workflowLoadLayer = () =>
	Layer.unwrap(
		Effect.gen(function* () {
			const enqueued = yield* Ref.make<ReadonlyArray<unknown>>([]);
			const updates = yield* Ref.make<ReadonlyArray<unknown>>([]);
			const polledExecutionIds = yield* Ref.make<ReadonlyArray<string>>([]);
			const terminal = yield* Ref.make(false);
			return OperationalGateService.layer.pipe(
				Layer.provideMerge(
					Layer.mergeAll(
						mutationAdmissionTestLayer,
						mockImports({
							createManualRun: () => Effect.succeed(importRun),
							updateProgress: (input) =>
								Ref.update(updates, (all) => [...all, input]).pipe(Effect.as(true)),
							markStarted: (input) =>
								Ref.update(updates, (all) => [...all, { ...input, status: "running" }]).pipe(
									Effect.as("started" as const),
								),
							finishFailed: (input) =>
								Ref.update(updates, (all) => [...all, { ...input, status: "failed" }]).pipe(
									Effect.as("settled" as const),
								),
							finishCompleted: (input) =>
								Ref.update(updates, (all) => [...all, { ...input, status: "completed" }]).pipe(
									Effect.as("settled" as const),
								),
						}),
						mockSandbox({
							enqueuePluginWorkflow: (input) =>
								Ref.update(enqueued, (all) => [...all, input]).pipe(
									Effect.andThen(
										Effect.fail(new NotFound({ message: "Sandbox script not found" })),
									),
								),
							getPluginWorkflowResult: (executionId) =>
								Ref.update(polledExecutionIds, (all) => [...all, executionId]).pipe(
									Effect.andThen(Ref.get(terminal)),
									Effect.map((isTerminal) =>
										isTerminal
											? { output: { executionId }, status: "completed" as const }
											: { status: "pending" as const },
									),
								),
						}),
						Layer.mock(PluginRuntimeResolver)({
							listPluginsAvailableToUser: () => Effect.succeed([availablePlugin]),
						}),
						Layer.succeed(RedisService, makeRedisService()),
						Layer.succeed(FakeWorkflowLoad, {
							updates: Ref.get(updates),
							enqueued: Ref.get(enqueued),
							completeExecutions: Ref.set(terminal, true),
							polledExecutionIds: Ref.get(polledExecutionIds),
						}),
					),
				),
			);
		}),
	);

layer(workflowLoadLayer())((test) => {
	test.effect("returns a typed error for an invalid plugin workflow target", () =>
		Effect.gen(function* () {
			const service = yield* OperationalGateService;
			const exit = yield* Effect.exit(service.startWorkflowLoad(gateInput));

			assertExitFails(exit, new NotFound({ message: "Sandbox script not found" }));
			expect(yield* (yield* FakeWorkflowLoad).enqueued).toEqual([
				{
					executingUserId,
					pluginId: availablePlugin.id,
					workflowSlug: gateInput.workflowSlug,
					executionId: `${runId}-workflow-load-0`,
					pluginInstallationId: availablePlugin.installationId,
					accountGeneration: { userId: executingUserId, token: "test-account-generation" },
					input: {
						items: [
							{
								index: 0,
								providerId: gateInput.providerId,
								entitySchemaSlug: gateInput.entitySchemaSlug,
								externalId: `${gateInput.identifierPrefix}-0`,
								command: {
									occurredAt: expect.any(String),
									itemIdentity: '["workflow-load",0]',
									accountGeneration: { userId: executingUserId, token: "test-account-generation" },
									causation: {
										depth: 0,
										source: "import",
										parentRunId: null,
										importRunId: runId,
										parentTriggerId: null,
										executionId: `${runId}-workflow-load`,
										rootExecutionId: `${runId}-workflow-load`,
										initiator: { kind: "user", id: executingUserId },
									},
								},
							},
						],
					},
				},
			]);
		}),
	);
});

layer(workflowLoadLayer())((test) => {
	test.effect("polls every execution and updates bookkeeping only after all finish", () =>
		Effect.gen(function* () {
			const service = yield* OperationalGateService;
			const fake = yield* FakeWorkflowLoad;
			const input = { runId, itemCount: 2, executionIds: ["execution-0", "execution-1"] };

			expect(yield* service.getWorkflowLoadResult(input)).toEqual({
				runId,
				executions: [
					{ status: "pending", executionId: "execution-0" },
					{ status: "pending", executionId: "execution-1" },
				],
			});
			expect(yield* fake.polledExecutionIds).toEqual(["execution-0", "execution-1"]);
			expect(yield* fake.updates).toEqual([]);

			yield* fake.completeExecutions;
			yield* service.getWorkflowLoadResult(input);
			expect(yield* fake.polledExecutionIds).toEqual([
				"execution-0",
				"execution-1",
				"execution-0",
				"execution-1",
			]);
			expect(yield* fake.updates).toEqual([
				expect.objectContaining({
					runId,
					progress: 100,
					failedItems: 0,
					importedItems: 2,
					processedItems: 2,
					status: "completed",
				}),
			]);
		}),
	);
});
