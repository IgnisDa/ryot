import { BunContext } from "@effect/platform-bun";
import { expect, it } from "@effect/vitest";
import { WorkflowEngine } from "@effect/workflow/WorkflowEngine";
import {
	EntitySchemaSlug,
	ImportRunId,
	IntegrationId,
	SandboxProviderId,
	SandboxScriptId,
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
	KERNEL_PROVIDER_ENTITY_POPULATION_WORKFLOW,
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

const populationReferencesLayer = (
	authorizes: (providerId: SandboxProviderId) => boolean = () => true,
) =>
	Layer.provide(
		KernelWorkflowReferencesLive,
		Layer.mergeAll(
			dbRunnerLayer,
			unownedRepositories,
			BunContext.layer,
			makeAppConfigLayer(),
			Layer.succeed(ServerRun, { _tag: "ServerRun", id: "test-server-run" }),
			Layer.mock(PluginRuntimeResolver)({
				_tag: "PluginRuntimeResolver",
				findActiveScriptById: () =>
					Effect.succeed({
						providerId: null,
						source: "source",
						compiledFormat: 1,
						pluginSlug: "catalog",
						name: "Catalog refresh",
						slug: "catalog.refresh",
						compiledCode: "compiled",
						contentHash: "workflow-hash",
						createdAt: new Date(0),
						updatedAt: new Date(0),
						id: SandboxScriptId.make("caller-script"),
						metadata: {
							kind: "workflow",
							capabilities: [],
							name: "Catalog refresh",
							slug: "catalog.refresh",
							requiredAppConfigKeys: [],
						},
					}),
				findAuthorizedSchemaProviderById: ({ providerId }) =>
					Effect.succeed(
						authorizes(providerId)
							? {
									entitySchemaSlug: EntitySchemaSlug.make("book"),
									provider: {
										name: "Books",
										id: providerId,
										slug: "book.catalog",
										pluginSlug: "provider-owner",
										createdAt: new Date(0),
										updatedAt: new Date(0),
										information: { source: "catalog" },
									},
								}
							: null,
					),
			}),
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
			SandboxScriptId.make("caller-script"),
		);
		yield* references.execute(
			KERNEL_EVENT_CREATE_WORKFLOW,
			{ payload: [], origin: "import", userId: "attacker-selected-user" },
			authority,
			"event-create-execution",
			"parent-execution",
			SandboxScriptId.make("caller-script"),
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
			SandboxScriptId.make("caller-script"),
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
			SandboxScriptId.make("caller-script"),
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
				SandboxScriptId.make("caller-script"),
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
				SandboxScriptId.make("caller-script"),
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
				SandboxScriptId.make("caller-script"),
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

it.effect(
	"dispatches bounded provider population items with deterministic child ids using a cross-plugin provider",
	() => {
		const payloads: unknown[] = [];
		const executionIds: string[] = [];
		const engine = makeWorkflowEngine({
			execute: (_workflow, options) =>
				Effect.sync(() => {
					executionIds.push(options.executionId);
					payloads.push(options.payload);
					return { id: `entity-${executionIds.length}` };
				}),
		});

		return Effect.gen(function* () {
			const references = yield* KernelWorkflowReferences;
			const result = yield* references.execute(
				KERNEL_PROVIDER_ENTITY_POPULATION_WORKFLOW,
				{
					mode: "refresh",
					items: [
						{ externalId: "book-1", providerId: "provider-book-catalog", entitySchemaSlug: "book" },
						{ externalId: "book-2", providerId: "provider-book-catalog", entitySchemaSlug: "book" },
					],
				},
				{ type: "system" },
				"population-reference",
				"parent-execution",
				SandboxScriptId.make("caller-script"),
			);

			expect(result).toEqual([{ id: "entity-1" }, { id: "entity-2" }]);
			expect(executionIds).toEqual(["population-reference-item-0", "population-reference-item-1"]);
			expect(payloads).toEqual([
				expect.objectContaining({
					userId: null,
					mode: "refresh",
					externalId: "book-1",
					entitySchemaSlug: "book",
					providerId: "provider-book-catalog",
					origin: { kind: "provider_refresh" },
					executionId: "population-reference-item-0",
				}),
				expect.objectContaining({
					externalId: "book-2",
					executionId: "population-reference-item-1",
				}),
			]);
		}).pipe(
			Effect.provide(populationReferencesLayer()),
			Effect.provideService(WorkflowEngine, engine),
		);
	},
);

it.effect("rejects non-system and unauthorized provider population calls", () => {
	let dispatches = 0;
	const engine = makeWorkflowEngine({
		execute: () =>
			Effect.sync(() => {
				dispatches += 1;
				return { id: "entity-1" };
			}),
	});
	const input = {
		mode: "refresh" as const,
		items: [{ externalId: "book-1", providerId: "foreign", entitySchemaSlug: "book" }],
	};

	return Effect.gen(function* () {
		const references = yield* KernelWorkflowReferences;
		const userExit = yield* Effect.exit(
			references.execute(
				KERNEL_PROVIDER_ENTITY_POPULATION_WORKFLOW,
				input,
				{ type: "user", userId: UserId.make("user-1") },
				"user-call",
				"parent-execution",
				SandboxScriptId.make("caller-script"),
			),
		);
		expect(userExit.toString()).toContain("available only for system executions");

		const ownershipExit = yield* Effect.exit(
			references.execute(
				KERNEL_PROVIDER_ENTITY_POPULATION_WORKFLOW,
				input,
				{ type: "system" },
				"foreign-call",
				"parent-execution",
				SandboxScriptId.make("caller-script"),
			),
		);
		expect(ownershipExit.toString()).toContain(
			"is not active or has no exact binding to entity schema 'book' owned by plugin 'catalog'",
		);
		expect(dispatches).toBe(0);
	}).pipe(
		Effect.provide(populationReferencesLayer(() => false)),
		Effect.provideService(WorkflowEngine, engine),
	);
});

it.effect("authorizes every provider population item before dispatching any child", () => {
	let dispatches = 0;
	const engine = makeWorkflowEngine({
		execute: () =>
			Effect.sync(() => {
				dispatches += 1;
				return { id: "entity-1" };
			}),
	});

	return Effect.gen(function* () {
		const references = yield* KernelWorkflowReferences;
		const exit = yield* Effect.exit(
			references.execute(
				KERNEL_PROVIDER_ENTITY_POPULATION_WORKFLOW,
				{
					mode: "ensure",
					items: [
						{ externalId: "book-1", providerId: "owned", entitySchemaSlug: "book" },
						{ externalId: "book-2", providerId: "foreign", entitySchemaSlug: "book" },
					],
				},
				{ type: "system" },
				"population-reference",
				"parent-execution",
				SandboxScriptId.make("caller-script"),
			),
		);

		expect(exit.toString()).toContain(
			"is not active or has no exact binding to entity schema 'book' owned by plugin 'catalog'",
		);
		expect(dispatches).toBe(0);
	}).pipe(
		Effect.provide(populationReferencesLayer((providerId) => providerId === "owned")),
		Effect.provideService(WorkflowEngine, engine),
	);
});

it.effect(
	"accepts 1-100 provider population items and rejects batches outside those bounds",
	() => {
		let dispatches = 0;
		const item = {
			externalId: "book-1",
			entitySchemaSlug: "book",
			providerId: "provider-book-catalog",
		};
		const engine = makeWorkflowEngine({
			execute: () =>
				Effect.sync(() => {
					dispatches += 1;
					return { id: `entity-${dispatches}` };
				}),
		});

		return Effect.gen(function* () {
			const references = yield* KernelWorkflowReferences;
			for (const items of [[item], Array.from({ length: 100 }, () => item)]) {
				yield* references.execute(
					KERNEL_PROVIDER_ENTITY_POPULATION_WORKFLOW,
					{ items, mode: "ensure" },
					{ type: "system" },
					`valid-batch-${items.length}`,
					"parent-execution",
					SandboxScriptId.make("caller-script"),
				);
			}
			expect(dispatches).toBe(101);

			for (const items of [[], Array.from({ length: 101 }, () => item)]) {
				const exit = yield* Effect.exit(
					references.execute(
						KERNEL_PROVIDER_ENTITY_POPULATION_WORKFLOW,
						{ items, mode: "ensure" },
						{ type: "system" },
						"invalid-batch",
						"parent-execution",
						SandboxScriptId.make("caller-script"),
					),
				);
				expect(exit.toString()).toContain("Invalid kernel workflow input");
			}
		}).pipe(
			Effect.provide(populationReferencesLayer()),
			Effect.provideService(WorkflowEngine, engine),
		);
	},
);
