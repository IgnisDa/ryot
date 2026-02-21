import { BunContext } from "@effect/platform-bun";
import { expect, it } from "@effect/vitest";
import { WorkflowEngine } from "@effect/workflow/WorkflowEngine";
import {
	ImportRunId,
	IntegrationId,
	SandboxProviderId,
	UserId,
} from "@ryot/contract/schema/brands";
import { Effect, Layer } from "effect";

import { ServerRun } from "#lib/infrastructure/server-run";
import { dbRunnerLayer, makeAppConfigLayer, makeWorkflowEngine } from "#lib/test-utils/effect";
import { ImportsRepository } from "#modules/imports/repository";
import { IntegrationsRepository } from "#modules/integrations/repository";
import { PluginRuntimeResolver } from "#modules/plugins/runtime-resolver";
import {
	KERNEL_EVENT_CREATE_WORKFLOW,
	KERNEL_LIBRARY_ENTITY_IMPORT_WORKFLOW,
	KERNEL_PROCESS_IMPORT_CHUNKS_WORKFLOW,
	KernelWorkflowReferences,
} from "#modules/sandbox/kernel-workflow-references";

import { KernelWorkflowReferencesLive } from "./kernel-workflow-references";

const mockImportsRepository = Layer.mock(ImportsRepository);
const mockIntegrationsRepository = Layer.mock(IntegrationsRepository);

const unownedRepositories = Layer.mergeAll(
	mockImportsRepository({ _tag: "ImportsRepository", getRunById: () => Effect.succeed(null) }),
	mockIntegrationsRepository({
		_tag: "IntegrationsRepository",
		getForUser: () => Effect.succeed(null),
	}),
);

const referencesLayer = (repositories: Layer.Layer<ImportsRepository | IntegrationsRepository>) =>
	Layer.provide(
		KernelWorkflowReferencesLive,
		Layer.mergeAll(
			dbRunnerLayer,
			repositories,
			BunContext.layer,
			makeAppConfigLayer(),
			Layer.succeed(ServerRun, { _tag: "ServerRun", id: "test-server-run" }),
			Layer.mock(PluginRuntimeResolver)({ _tag: "PluginRuntimeResolver" }),
		),
	);

it.effect("binds kernel workflow user ids to the trusted execution authority", () => {
	const payloads: unknown[] = [];
	const engine = makeWorkflowEngine({
		execute: (workflow, options) =>
			Effect.sync(() => {
				payloads.push(options.payload);
				return workflow.name === "EventCreateWorkflow" ? [] : { id: "entity-1" };
			}),
	});

	return Effect.gen(function* () {
		const references = yield* KernelWorkflowReferences;
		const authority = { type: "user" as const, userId: UserId.make("trusted-user") };
		yield* references.execute(
			KERNEL_LIBRARY_ENTITY_IMPORT_WORKFLOW,
			{
				externalId: "book-1",
				entitySchemaSlug: "book",
				providerId: "openlibrary",
				origin: { kind: "import" },
				userId: "attacker-selected-user",
			},
			authority,
			"entity-import-execution",
			"parent-execution",
		);
		yield* references.execute(
			KERNEL_EVENT_CREATE_WORKFLOW,
			{ payload: [], origin: "import", userId: "attacker-selected-user" },
			authority,
			"event-create-execution",
			"parent-execution",
		);

		expect(payloads).toMatchObject([
			{ userId: "trusted-user", executionId: "entity-import-execution" },
			{ userId: "trusted-user", executionId: "event-create-execution" },
		]);
	}).pipe(
		Effect.provide(referencesLayer(unownedRepositories)),
		Effect.provideService(WorkflowEngine, engine),
	);
});

it.effect("resolves plugin provider slugs before dispatching library imports", () => {
	const payloads: unknown[] = [];
	const engine = makeWorkflowEngine({
		execute: (_workflow, options) =>
			Effect.sync(() => {
				payloads.push(options.payload);
				return { id: "entity-1" };
			}),
	});
	const layer = Layer.provide(
		KernelWorkflowReferencesLive,
		Layer.mergeAll(
			dbRunnerLayer,
			unownedRepositories,
			BunContext.layer,
			makeAppConfigLayer(),
			Layer.succeed(ServerRun, { _tag: "ServerRun", id: "test-server-run" }),
			Layer.mock(PluginRuntimeResolver)({
				_tag: "PluginRuntimeResolver",
				findSchemaProviderBySlug: () =>
					Effect.succeed({
						entitySchemaSlug: "show",
						provider: {
							name: "TMDB",
							slug: "show.tmdb",
							pluginSlug: "media",
							createdAt: new Date(0),
							updatedAt: new Date(0),
							information: { source: "tmdb" },
							id: SandboxProviderId.make("provider-show-tmdb"),
						},
					}),
			}),
		),
	);

	return Effect.gen(function* () {
		const references = yield* KernelWorkflowReferences;
		yield* references.execute(
			KERNEL_LIBRARY_ENTITY_IMPORT_WORKFLOW,
			{
				externalId: "show-1",
				providerSlug: "show.tmdb",
				origin: { kind: "import" },
				entitySchemaSlug: "attacker-selected-schema",
			},
			{ type: "user", userId: UserId.make("trusted-user") },
			"entity-import-execution",
			"parent-execution",
		);

		expect(payloads).toEqual([
			expect.objectContaining({
				userId: "trusted-user",
				entitySchemaSlug: "show",
				providerId: "provider-show-tmdb",
			}),
		]);
	}).pipe(Effect.provide(layer), Effect.provideService(WorkflowEngine, engine));
});

it.effect("binds import harvest provenance to the trusted parent workflow execution", () => {
	const payloads: unknown[] = [];
	const engine = makeWorkflowEngine({
		execute: (_workflow, options) =>
			Effect.sync(() => {
				payloads.push(options.payload);
				return { failedItems: 0, importedItems: 0, processedItems: 0 };
			}),
	});
	const ownedRepositories = Layer.mergeAll(
		mockImportsRepository({
			_tag: "ImportsRepository",
			getRunById: () =>
				Effect.succeed({
					progress: 0,
					failedItems: 0,
					startedAt: null,
					finishedAt: null,
					inputSummary: {},
					importedItems: 0,
					totalItems: null,
					processedItems: 0,
					errorSummary: null,
					status: "pending" as const,
					source: "open_scale" as const,
					id: ImportRunId.make("run-1"),
					createdAt: "2026-01-01T00:00:00.000Z",
					updatedAt: "2026-01-01T00:00:00.000Z",
				}),
		}),
		mockIntegrationsRepository({ _tag: "IntegrationsRepository" }),
	);

	return Effect.gen(function* () {
		const references = yield* KernelWorkflowReferences;
		yield* references.execute(
			KERNEL_PROCESS_IMPORT_CHUNKS_WORKFLOW,
			{
				totalItems: 0,
				runId: "run-1",
				chunkFiles: [],
				failureCount: 0,
				writeItemCount: 0,
				expectedHarvestDirectoryPrefix: "/tmp/attacker-selected",
			},
			{ type: "user", userId: UserId.make("trusted-user") },
			"child-execution",
			"parent/execution",
		);

		expect(payloads).toEqual([
			expect.objectContaining({
				userId: "trusted-user",
				executionId: "child-execution",
				expectedHarvestDirectoryPrefix:
					"/tmp/ryot-sandbox-harvest-test-server-run/parent-execution-activity-",
			}),
		]);
	}).pipe(
		Effect.provide(referencesLayer(ownedRepositories)),
		Effect.provideService(WorkflowEngine, engine),
	);
});

it.effect("rejects user-scoped kernel workflows for system executions", () =>
	Effect.gen(function* () {
		const references = yield* KernelWorkflowReferences;
		const exit = yield* Effect.exit(
			references.execute(
				KERNEL_LIBRARY_ENTITY_IMPORT_WORKFLOW,
				{
					externalId: "book-1",
					entitySchemaSlug: "book",
					providerId: "openlibrary",
					origin: { kind: "import" },
					userId: "attacker-selected-user",
				},
				{ type: "system" },
				"entity-import-execution",
				"parent-execution",
			),
		);

		expect(exit.toString()).toContain("is not available for system executions");
	}).pipe(
		Effect.provide(referencesLayer(unownedRepositories)),
		Effect.provideService(WorkflowEngine, makeWorkflowEngine()),
	),
);

it.effect("rejects a script-supplied import run owned by another user", () =>
	Effect.gen(function* () {
		const references = yield* KernelWorkflowReferences;
		const exit = yield* Effect.exit(
			references.execute(
				KERNEL_LIBRARY_ENTITY_IMPORT_WORKFLOW,
				{
					externalId: "book-1",
					entitySchemaSlug: "book",
					providerId: "openlibrary",
					origin: { kind: "import", importRunId: ImportRunId.make("victim-run") },
				},
				{ type: "user", userId: UserId.make("trusted-user") },
				"entity-import-execution",
				"parent-execution",
			),
		);

		expect(exit.toString()).toContain(
			"import run 'victim-run' does not belong to the executing user",
		);
	}).pipe(
		Effect.provide(referencesLayer(unownedRepositories)),
		Effect.provideService(WorkflowEngine, makeWorkflowEngine()),
	),
);

it.effect("rejects a script-supplied integration owned by another user", () =>
	Effect.gen(function* () {
		const references = yield* KernelWorkflowReferences;
		const exit = yield* Effect.exit(
			references.execute(
				KERNEL_EVENT_CREATE_WORKFLOW,
				{
					payload: [],
					origin: "integration",
					integrationId: IntegrationId.make("victim-integration"),
				},
				{ type: "user", userId: UserId.make("trusted-user") },
				"event-create-execution",
				"parent-execution",
			),
		);

		expect(exit.toString()).toContain(
			"integration 'victim-integration' does not belong to the executing user",
		);
	}).pipe(
		Effect.provide(referencesLayer(unownedRepositories)),
		Effect.provideService(WorkflowEngine, makeWorkflowEngine()),
	),
);
