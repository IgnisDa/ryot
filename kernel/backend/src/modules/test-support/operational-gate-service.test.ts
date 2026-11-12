import { expect } from "bun:test";

import { NotFound } from "@ryot-app/contract/errors";
import {
	EntitySchemaSlug,
	ImportRunId,
	PluginId,
	SandboxProviderId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { fixtureManifest } from "@ryot-app/contract/testing";
import { SandboxSidecarSupervisor } from "@ryot-app/sandbox/host/supervisor";
import { assertExitFails } from "@ryot-app/testing/effect-assertions";
import { anyOf } from "@ryot-app/testing/matchers";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { layer } from "@voila.dev/effect-bun-test";
import { Context, Effect, Layer, Ref } from "effect";

import { IngestionExecution } from "#modules/imports/execution-service";
import { ImportsRepository } from "#modules/imports/repository";
import { ImportsService } from "#modules/imports/service";
import { mutationAdmissionTestLayer } from "#modules/mutations/admission.test-support";
import { PluginRuntimeResolver } from "#modules/plugins/catalog/runtime-resolver";
import { PluginConfigEncryptionKey } from "#modules/plugins/configuration/encryption-key";
import { ScriptExecutionService } from "#modules/scripts/executions/service";
import { createPluginConfigEncryption } from "#platform/config/plugin-config-encryption";
import type { DatabaseSession } from "#platform/db/session";
import { fakeDatabaseSession } from "#testing/effect";

import { OperationalGateRepository } from "./operational-gate-repository";
import { OperationalGateService } from "./operational-gate-service";

const runId = ImportRunId.make("run-id");
const executingUserId = UserId.make("user-id");
const mockImports = Layer.mock(ImportsService);
const mockSandbox = Layer.mock(ScriptExecutionService);
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
	pluginId: PluginId.make("fixture-plugin-plugin-id"),
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

const pluginManifest = fixtureManifest();
const availablePlugin = {
	config: {},
	isHidden: false,
	ownerUserId: null,
	clientImports: [],
	compiledHashes: {},
	healthReason: null,
	isInitialized: true,
	slug: "fixture-plugin",
	scope: "system" as const,
	health: "ready" as const,
	manifest: pluginManifest,
	contentHash: "source-hash",
	incompatibilityReason: null,
	id: "fixture-plugin-plugin-id",
	pluginRevisionId: "fixture-plugin-revision",
	packageId: pluginManifest.metadata.packageId,
	installationId: "fixture-plugin-installation",
	pluginConfigRevisionId: "fixture-plugin-config-revision",
};

class FakeWorkflowLoad extends Context.Service<
	FakeWorkflowLoad,
	{
		readonly completeExecutions: Effect.Effect<void>;
		readonly updates: Effect.Effect<ReadonlyArray<unknown>>;
		readonly enqueued: Effect.Effect<ReadonlyArray<unknown>>;
		readonly polledExecutionIds: Effect.Effect<ReadonlyArray<string>>;
	}
>()(
	"@ryot-app/kernel-backend/modules/test-support/operational-gate-service.test/FakeWorkflowLoad",
) {}

const workflowLoadLayer = (options: { database?: Layer.Layer<DatabaseSession> } = {}) =>
	Layer.unwrap(
		Effect.gen(function* () {
			const enqueued = yield* Ref.make<ReadonlyArray<unknown>>([]);
			const updates = yield* Ref.make<ReadonlyArray<unknown>>([]);
			const polledExecutionIds = yield* Ref.make<ReadonlyArray<string>>([]);
			const terminal = yield* Ref.make(false);
			const scope = { runId, userId: executingUserId, accountUserId: executingUserId };
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
							findPluginAvailableToUser: (_userId, pluginId) =>
								Effect.succeed(pluginId === availablePlugin.id ? availablePlugin : null),
						}),
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
	test.effect(
		"returns a typed error for an invalid plugin workflow target",
		() =>
			Effect.gen(function* () {
				const service = yield* OperationalGateService;
				const exit = yield* Effect.exit(service.startWorkflowLoad(gateInput));

				assertExitFails(exit, new NotFound({ message: "Sandbox script not found" }));
				expect(yield* (yield* FakeWorkflowLoad).enqueued).toEqual([
					{
						executingUserId,
						lane: "background",
						pluginId: availablePlugin.id,
						accountUserId: executingUserId,
						workflowSlug: gateInput.workflowSlug,
						executionId: `${runId}-workflow-load-0`,
						pluginInstallationId: availablePlugin.installationId,
						input: {
							items: [
								{
									index: 0,
									providerId: gateInput.providerId,
									entitySchemaSlug: gateInput.entitySchemaSlug,
									externalId: `${gateInput.identifierPrefix}-0`,
									command: {
										occurredAt: anyOf(String),
										accountUserId: executingUserId,
										itemIdentity: '["workflow-load",0]',
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
		testTimeout,
	);
});

layer(
	workflowLoadLayer({
		database: fakeDatabaseSession({
			execute: () =>
				Effect.succeed([{ deadlocks: 0, waiting_advisory_locks: 0, lock_waiting_connections: 0 }]),
			select: () => ({
				from: () => ({
					where: () => ({
						groupBy: () =>
							Effect.succeed([
								{ entries: 2, lastIndex: 1 },
								{ entries: 3, lastIndex: 2 },
								{ entries: 2, lastIndex: 3 },
								{ entries: 1, lastIndex: 1 },
							]),
					}),
				}),
			}),
		}),
	}),
)((test) => {
	test.effect(
		"counts contiguous journal entries and detects holes",
		() =>
			Effect.gen(function* () {
				const service = yield* OperationalGateService;
				const pressure = yield* service.samplePressure(["valid", "longest", "hole", "late"]);

				expect(pressure.journal).toEqual({
					projectionCount: 4,
					projectionErrors: 2,
					maxJournalEntries: 3,
				});
			}),
		testTimeout,
	);
});
