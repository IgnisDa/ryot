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

import { createPluginConfigEncryption } from "#lib/infrastructure/config/plugin-config-encryption";
import type { DatabaseSession } from "#lib/infrastructure/db/session";
import { RedisService, redisKeys } from "#lib/infrastructure/redis";
import { SandboxSidecarSupervisor } from "#lib/infrastructure/sandbox-runtime/sidecar-supervisor";
import { assertExitFails } from "#lib/test-utils/assertions";
import { fakeDatabaseSession, makeRedisService } from "#lib/test-utils/effect";
import { mutationAdmissionTestLayer } from "#lib/test-utils/mutation-admission";
import { IngestionExecution } from "#modules/imports/execution-service";
import { ImportsRepository } from "#modules/imports/repository";
import { ImportsService } from "#modules/imports/service";
import { PluginConfigEncryptionKey } from "#modules/plugins/config-encryption-key";
import { PluginRuntimeResolver } from "#modules/plugins/runtime-resolver";
import { fixtureManifest } from "#modules/plugins/test-support";
import { SandboxExecutionService } from "#modules/sandbox/service";

import { OperationalGateRepository } from "./operational-gate-repository";
import { OperationalGateService } from "./operational-gate-service";

const runId = ImportRunId.make("run-id");
const executingUserId = UserId.make("user-id");
const mockImports = Layer.mock(ImportsService);
const mockSandbox = Layer.mock(SandboxExecutionService);
const pluginConfigEncryptionKey = Layer.succeed(
	PluginConfigEncryptionKey,
	PluginConfigEncryptionKey.of({
		load: Effect.succeed(
			createPluginConfigEncryption({ id: "test-key", key: new Uint8Array(32).fill(7) }),
		),
	}),
);

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
	startedAt: null,
	inputSummary: {},
	finishedAt: null,
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

const workflowLoadLayer = (
	options: { database?: Layer.Layer<DatabaseSession>; redis?: RedisService["Service"] } = {},
) =>
	Layer.unwrap(
		Effect.gen(function* () {
			const enqueued = yield* Ref.make<ReadonlyArray<unknown>>([]);
			const updates = yield* Ref.make<ReadonlyArray<unknown>>([]);
			const polledExecutionIds = yield* Ref.make<ReadonlyArray<string>>([]);
			const terminal = yield* Ref.make(false);
			const scope = {
				runId,
				userId: executingUserId,
				accountGeneration: { userId: executingUserId, token: "test-account-generation" },
			};
			return OperationalGateService.layer.pipe(
				Layer.provide(
					Layer.effect(
						ImportsRepository,
						Effect.gen(function* () {
							const repository = yield* ImportsRepository.make;
							return {
								...repository,
								sealCollection: () => Effect.void,
								pinIngestion: () => Effect.succeed(true),
								startIngestion: () => Effect.succeed(true),
								putActivity: (_scope, activity) =>
									Ref.update(updates, (all) => [...all, activity]).pipe(Effect.as(undefined)),
							};
						}),
					),
				),
				Layer.provideMerge(
					Layer.mergeAll(
						Layer.succeed(SandboxSidecarSupervisor, {
							run: () => Effect.die("unused"),
							locate: () => Effect.die("unused"),
							reserve: () => Effect.die("unused"),
							completeRecovery: () => Effect.die("unused"),
							snapshot: () => ({ totalExecutions: 0, activeExecutions: 0, maxActiveExecutions: 0 }),
						}),
						options.database ?? mutationAdmissionTestLayer,
						pluginConfigEncryptionKey,
						mockImports({ createManualRun: () => Effect.succeed(importRun) }),
						Layer.succeed(OperationalGateRepository, { runningScope: () => Effect.succeed(scope) }),
						Layer.succeed(IngestionExecution, {
							retire: () => Effect.die("unused"),
							cleanup: () => Effect.die("unused"),
							deleteReport: () => Effect.die("unused"),
							abortAdmission: () => Effect.die("unused"),
							settle: (input) =>
								Ref.update(updates, (all) => [
									...all,
									{ scope: input.scope, status: input.status },
								]).pipe(Effect.as(true)),
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
						Layer.succeed(RedisService, options.redis ?? makeRedisService()),
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
					lane: "background",
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
										lane: "background",
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

const journalReads: string[] = [];
const projections = new Map<string, ReadonlyArray<string>>([
	[redisKeys.sandboxWorkflowJournal("valid"), ["m:0", "c:0:0", "m:1", "c:1:0", "c:1:1"]],
	[redisKeys.sandboxWorkflowJournal("longest"), ["m:0", "c:0:0", "m:1", "c:1:0", "m:2", "c:2:0"]],
	[redisKeys.sandboxWorkflowJournal("hole"), ["m:0", "c:0:0", "m:2", "c:2:0"]],
	[redisKeys.sandboxWorkflowJournal("missing-first"), ["m:1", "c:1:0"]],
	[redisKeys.sandboxWorkflowJournal("stray"), ["m:0", "c:0:0", "other"]],
	[`${redisKeys.sandboxWorkflowJournal("valid")}:unrelated`, ["m:0", "m:1", "m:2", "m:3"]],
]);

layer(
	workflowLoadLayer({
		redis: makeRedisService({
			client: Object.assign(Object.create(null), {
				hkeys: (key: string) => {
					journalReads.push(key);
					return Promise.resolve(projections.get(key) ?? []);
				},
			}),
		}),
		database: fakeDatabaseSession({
			execute: () =>
				Effect.succeed([
					{
						deadlocks: 0,
						advisory_locks: 0,
						total_connections: 1,
						active_connections: 1,
						waiting_advisory_locks: 0,
						lock_waiting_connections: 0,
					},
				]),
		}),
	}),
)((test) => {
	test.effect(
		"reads exact journal keys and counts contiguous entries and detects holes and stray fields",
		() =>
			Effect.gen(function* () {
				const service = yield* OperationalGateService;
				const pressure = yield* service.samplePressure([
					"valid",
					"longest",
					"hole",
					"missing-first",
					"stray",
					"absent",
				]);

				expect(pressure.redis).toEqual({
					projectionCount: 5,
					projectionErrors: 3,
					maxJournalEntries: 3,
				});
				expect(journalReads).toEqual([
					"ryot:sandbox:workflow:valid:journal",
					"ryot:sandbox:workflow:longest:journal",
					"ryot:sandbox:workflow:hole:journal",
					"ryot:sandbox:workflow:missing-first:journal",
					"ryot:sandbox:workflow:stray:journal",
					"ryot:sandbox:workflow:absent:journal",
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
					completed: 2,
					exactTotal: 2,
					state: "completed",
					unit: "workflow executions",
				}),
				expect.objectContaining({ status: "completed", scope: expect.objectContaining({ runId }) }),
			]);
		}),
	);
});
