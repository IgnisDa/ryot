import { PgClient } from "@effect/sql-pg";
import { assert, expect, layer } from "@effect/vitest";
import type { ContractPayload } from "@ryot-app/contract/client";
import {
	EntityId,
	EntitySchemaSlug,
	PluginId,
	RelationshipId,
	RelationshipSchemaSlug,
	SandboxProviderId,
	SandboxScriptId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { PluginClientArtifactFromBase64 } from "@ryot-app/plugin-client-contract";
import { Context, Effect, Layer, Ref, Schema } from "effect";

import { AuthService } from "#modules/accounts/auth/service";
import { LifecycleExecution } from "#modules/automations/lifecycle/execution";
import { LifecyclePlanner } from "#modules/automations/lifecycle/planning";
import { RelationshipSchemaReader } from "#modules/definitions/relationship-schemas";
import { TranslationsRepository } from "#modules/entities/localization/repository";
import { EntitiesRepository } from "#modules/entities/repository";
import { EntitiesService } from "#modules/entities/service";
import { InterestService } from "#modules/entities/watches/service";
import type { DomainLifecycleCommand } from "#modules/entities/write-context";
import { PluginInstallationService } from "#modules/plugins/installations/service";
import { PluginIngestionService } from "#modules/plugins/packages/ingestion-service";
import { PluginRepository } from "#modules/plugins/packages/repository";
import type { PluginSource } from "#modules/plugins/packages/types";
import { fixtureClientArtifact } from "#modules/plugins/source.test-support";
import { fixtureManifest } from "#modules/plugins/test-support";
import { RelationshipsService } from "#modules/relationships/service";
import { PluginCronService } from "#modules/scheduler/plugin-cron";
import { ScriptExecutionService } from "#modules/scripts/executions/service";
import { RedisService } from "#platform/redis";
import { databaseLayer, makeRedisService, type MockOverrides } from "#testing/effect";

import { TestSupportService } from "./service";

const entityId = EntityId.make("entity-id");
const entitySchemaSlug = EntitySchemaSlug.make("entity-schema-id");
const entitySchemaPluginId = PluginId.make("entity-schema-plugin-id");
const entitySchema = {
	slug: entitySchemaSlug,
	owner: { kind: "plugin" as const, pluginId: entitySchemaPluginId },
};
const scriptId = SandboxScriptId.make("script-id");

const mockAuth = Layer.mock(AuthService);
const mockEntities = Layer.mock(EntitiesService);
const mockInterest = Layer.mock(InterestService);
const mockPluginIngestion = Layer.mock(PluginIngestionService);
const mockPluginInstallations = Layer.mock(PluginInstallationService);
const mockPluginRepository = Layer.mock(PluginRepository);
const mockPluginCrons = Layer.mock(PluginCronService);
const mockSandbox = Layer.mock(ScriptExecutionService);
const mockTranslations = Layer.mock(TranslationsRepository);
const mockRelationships = Layer.mock(RelationshipsService);
const mockRelationshipSchemas = Layer.mock(RelationshipSchemaReader);
const makeServiceLayer = (
	overrides: {
		sandbox?: MockOverrides<typeof mockSandbox>;
		entities?: MockOverrides<typeof mockEntities>;
		interest?: MockOverrides<typeof mockInterest>;
		pluginCrons?: MockOverrides<typeof mockPluginCrons>;
		pluginIngestion?: MockOverrides<typeof mockPluginIngestion>;
		pluginInstallations?: MockOverrides<typeof mockPluginInstallations>;
		pluginRepository?: MockOverrides<typeof mockPluginRepository>;
		translations?: MockOverrides<typeof mockTranslations>;
		relationships?: MockOverrides<typeof mockRelationships>;
		relationshipSchemas?: MockOverrides<typeof mockRelationshipSchemas>;
	} = {},
) => {
	return TestSupportService.layer.pipe(
		Layer.provideMerge(
			Layer.mergeAll(
				databaseLayer,
				Layer.succeed(PgClient.PgClient, Object.create(null)),
				Layer.mock(LifecyclePlanner)({ plan: () => Effect.die("unused") }),
				Layer.mock(LifecycleExecution)({
					after: () => Effect.die("unused"),
					executePolicy: () => Effect.die("unused"),
					skipQueuedPolicies: () => Effect.die("unused"),
				}),
				Layer.mock(EntitiesRepository)({}),
				mockAuth({ handler: () => Effect.die("unused").pipe(Effect.runPromise) }),
				Layer.succeed(RedisService, makeRedisService()),
				mockEntities({ ...overrides.entities }),
				mockSandbox({ ...overrides.sandbox }),
				mockPluginCrons({
					trigger: (pluginId, cronSlug) =>
						Effect.succeed({ cronSlug, pluginId, status: "notFound" as const }),
					...overrides.pluginCrons,
				}),
				mockPluginIngestion({ ...overrides.pluginIngestion }),
				mockPluginInstallations({ ...overrides.pluginInstallations }),
				mockPluginRepository({ ...overrides.pluginRepository }),
				mockInterest({ ...overrides.interest }),
				mockTranslations({ ...overrides.translations }),
				mockRelationships({ ...overrides.relationships }),
				mockRelationshipSchemas({ ...overrides.relationshipSchemas }),
			),
		),
	);
};

const recordingServiceLayer = <A>(
	overrides: (
		record: (observation: A) => Effect.Effect<void>,
		recorded: Effect.Effect<ReadonlyArray<A>>,
	) => Parameters<typeof makeServiceLayer>[0],
) => {
	const Recorded = Context.Service<Effect.Effect<ReadonlyArray<A>>>(
		"test/RecordedTestSupportCalls",
	);
	return {
		recorded: Effect.flatten(Recorded),
		layer: Layer.unwrap(
			Effect.gen(function* () {
				const observations = yield* Ref.make<ReadonlyArray<A>>([]);
				const recorded = Ref.get(observations);
				return makeServiceLayer(
					overrides(
						(observation) => Ref.update(observations, (all) => [...all, observation]),
						recorded,
					),
				).pipe(Layer.provideMerge(Layer.succeed(Recorded, recorded)));
			}),
		),
	};
};

const persistedPluginResult = (revision: string) => ({
	id: "plugin-id",
	activationId: "activation-id",
	activeRevisionId: `revision-${revision}`,
	scripts: [{ slug: "fixture.script", id: `script-${revision}` }],
});

const systemPluginManifest = {
	...fixtureManifest(),
	client: {
		homeView: null,
		apiVersion: 1 as const,
		exports: {
			"fixture-page": {
				kind: "page" as const,
				entry: "client/page.tsx",
				settingsSchema: { fields: {} },
				automaticEntityPresentations: false,
			},
		},
	},
};
const systemPluginClient = systemPluginManifest.client;
assert(systemPluginClient);

type SystemPluginObservation =
	| { kind: "install"; input: PluginSource }
	| { kind: "update"; input: PluginSource & { pluginId: string; contentHash: string } }
	| {
			identity: Parameters<PluginRepository["Service"]["findTestSupportOperationResult"]>[0];
			kind: "result";
	  };

const systemPluginIngestion = recordingServiceLayer<SystemPluginObservation>(
	(record, recorded) => ({
		pluginIngestion: {
			installPlugin: (input) =>
				record({ input, kind: "install" }).pipe(
					Effect.as({ pluginId: PluginId.make("plugin-id") }),
				),
			updatePlugin: (input) =>
				record({ input, kind: "update" }).pipe(
					Effect.as({ pluginId: PluginId.make(input.pluginId) }),
				),
		},
		pluginRepository: {
			findTestSupportOperationResult: (identity) =>
				record({ identity, kind: "result" }).pipe(
					Effect.andThen(recorded),
					Effect.map((observations) => ({
						...persistedPluginResult(
							observations.some((observation) => observation.kind === "update") ? "v2" : "v1",
						),
						installationId: null,
						configRevisionId: null,
					})),
				),
		},
	}),
);

layer(systemPluginIngestion.layer)((test) => {
	test.effect("returns persisted system plugin identity after real ingestion completes", () => {
		const compiledClient = fixtureClientArtifact(
			systemPluginManifest.metadata.name,
			systemPluginManifest.metadata.packageId,
			systemPluginClient,
		);
		const compiledScripts = [
			{ format: 1, javascript: "compiled", entry: "backend/automations/fixture.sandbox.ts" },
		];
		return Effect.gen(function* () {
			const result = yield* (yield* TestSupportService).installSystemPlugin({
				compiledScripts,
				manifest: systemPluginManifest,
				compiledClient: yield* Schema.encodeUnknownEffect(PluginClientArtifactFromBase64)(
					compiledClient,
				),
			});
			expect(yield* systemPluginIngestion.recorded).toEqual([
				{
					kind: "install",
					input: { compiledClient, compiledScripts, manifest: systemPluginManifest },
				},
				{ kind: "result", identity: { pluginId: "plugin-id" } },
			]);
			expect(result).toEqual({
				installationId: null,
				pluginId: "plugin-id",
				configRevisionId: null,
				activationId: "activation-id",
				activePluginRevisionId: "revision-v1",
				scripts: [{ id: "script-v1", slug: "fixture.script" }],
			});
		});
	});
	test.effect("updates an exact system plugin with its source hash", () => {
		const compiledClient = fixtureClientArtifact(
			systemPluginManifest.metadata.name,
			systemPluginManifest.metadata.packageId,
			systemPluginClient,
		);
		const compiledScripts = [
			{ format: 1, javascript: "compiled update", entry: "backend/automations/fixture.sandbox.ts" },
		];
		const pluginId = PluginId.make("plugin-id");
		const contentHash = "current-source-hash";
		return Effect.gen(function* () {
			const result = yield* (yield* TestSupportService).updateSystemPlugin(pluginId, {
				contentHash,
				compiledScripts,
				manifest: systemPluginManifest,
				compiledClient: yield* Schema.encodeUnknownEffect(PluginClientArtifactFromBase64)(
					compiledClient,
				),
			});
			expect((yield* systemPluginIngestion.recorded).slice(-2)).toEqual([
				{
					kind: "update",
					input: {
						pluginId,
						contentHash,
						compiledClient,
						compiledScripts,
						manifest: systemPluginManifest,
					},
				},
				{ kind: "result", identity: { pluginId } },
			]);
			expect(result.activePluginRevisionId).toBe("revision-v2");
		});
	});
});

const translationUpserts = recordingServiceLayer<unknown>((record) => ({
	translations: {
		upsertOverlay: (input) =>
			record({ input }).pipe(Effect.as({ entityId: input.entityId, language: input.language })),
	},
}));

layer(translationUpserts.layer)((test) => {
	test.effect("returns the translation identity from an upsert", () =>
		Effect.gen(function* () {
			const result = yield* (yield* TestSupportService).upsertEntityTranslation({
				entityId,
				language: "es",
				name: "Nombre",
				properties: null,
			});
			expect(result).toEqual({ entityId, language: "es" });
			expect((yield* translationUpserts.recorded).at(-1)).toMatchObject({
				input: { entityId, language: "es", name: "Nombre" },
			});
		}),
	);
});

const populatedAt = "2026-07-20T12:00:00.000Z";
const populatedAtDate = new Date(populatedAt);
const unpopulatedEntity = {
	id: entityId,
	name: "Entity",
	entitySchemaSlug,
	externalId: null,
	providerId: null,
	populatedAt: null,
	entitySchemaPluginId,
	createdAt: populatedAt,
	updatedAt: populatedAt,
	properties: { title: "Entity" },
};

const entityUpdates = recordingServiceLayer<unknown>((record) => ({
	entities: {
		getByIdAnyScope: () => Effect.succeed(unpopulatedEntity),
		update: (input) =>
			record(input).pipe(
				Effect.as({ warnings: [], entity: { ...unpopulatedEntity, populatedAt } }),
			),
	},
}));

layer(entityUpdates.layer)((test) => {
	test.effect("updates populatedAt without changing entity fields", () =>
		Effect.gen(function* () {
			const service = yield* TestSupportService;
			yield* service.setEntityPopulatedAt(entityId, populatedAt);
			expect((yield* entityUpdates.recorded).at(-1)).toMatchObject({
				entityId,
				scope: "global",
				name: unpopulatedEntity.name,
				populatedAt: populatedAtDate,
				properties: unpopulatedEntity.properties,
				lifecycle: {
					writeContext: null,
					itemIdentity: '["test-support:set-entity-populated-at","entity-id"]',
					causation: { source: "api", initiator: { id: null, kind: "system" } },
				},
			});
		}),
	);
});

const interestMemberships = recordingServiceLayer<unknown>((record) => ({
	interest: { setEntityWatchMembership: (input) => record(input).pipe(Effect.as(undefined)) },
}));

layer(interestMemberships.layer)((test) => {
	test.effect("delegates session membership without reconciliation", () =>
		Effect.gen(function* () {
			const service = yield* TestSupportService;
			yield* service.setEntityWatchMembership({
				sessionId: "session-1",
				entityIds: [EntityId.make("entity-1")],
			});
			expect((yield* interestMemberships.recorded).at(-1)).toEqual({
				sessionId: "session-1",
				entityIds: ["entity-1"],
			});
		}),
	);
});

const providerId = SandboxProviderId.make("provider-id");
const providerEntity = {
	providerId,
	id: entityId,
	name: "Entity",
	entitySchemaSlug,
	populatedAt: null,
	entitySchemaPluginId,
	externalId: "external-id",
	properties: { title: "Entity" },
	createdAt: "2026-07-20T12:00:00.000Z",
	updatedAt: "2026-07-20T12:00:00.000Z",
};

const globalEntityCreates = recordingServiceLayer<unknown>((record) => ({
	entities: {
		createGlobal: (input) =>
			record(input).pipe(Effect.as({ warnings: [], entity: providerEntity })),
	},
}));

layer(globalEntityCreates.layer)((test) => {
	test.effect("creates global entities with provider provenance", () =>
		Effect.gen(function* () {
			const service = yield* TestSupportService;
			expect(
				yield* service.createGlobalEntity({
					providerId,
					entitySchema,
					name: providerEntity.name,
					externalId: providerEntity.externalId,
					properties: providerEntity.properties,
				}),
			).toEqual(providerEntity);
			expect((yield* globalEntityCreates.recorded).at(-1)).toMatchObject({
				providerId,
				entitySchema,
				populatedAt: null,
				name: providerEntity.name,
				externalId: providerEntity.externalId,
				properties: providerEntity.properties,
				lifecycle: {
					writeContext: null,
					itemIdentity: '["test-support:create-global-entity","create"]',
					causation: { source: "api", initiator: { id: null, kind: "system" } },
				},
			});
		}),
	);
});

const rootFactEntity = {
	id: entityId,
	name: "Entity",
	properties: {},
	entitySchemaSlug,
	externalId: null,
	providerId: null,
	populatedAt: null,
	entitySchemaPluginId,
	createdAt: "2026-07-20T12:00:00.000Z",
	updatedAt: "2026-07-20T12:00:00.000Z",
};

const rootFactCommands = recordingServiceLayer<DomainLifecycleCommand>((record) => ({
	entities: {
		createGlobal: (input) =>
			record(input.lifecycle).pipe(Effect.as({ warnings: [], entity: rootFactEntity })),
		update: (input) =>
			record(input.lifecycle).pipe(
				Effect.as({
					warnings: [],
					entity: { ...rootFactEntity, populatedAt: "2026-07-21T00:00:00.000Z" },
				}),
			),
	},
}));

layer(rootFactCommands.layer)((test) => {
	test.effect("uses one root fact for create and populatedAt update", () =>
		Effect.gen(function* () {
			yield* (yield* TestSupportService).createGlobalEntity({
				entitySchema,
				name: "Entity",
				properties: {},
				populatedAt: "2026-07-21T00:00:00.000Z",
			});
			const commands = yield* rootFactCommands.recorded;
			expect(commands.map(({ itemIdentity }) => itemIdentity)).toEqual([
				'["test-support:create-global-entity","create"]',
				'["test-support:create-global-entity","set-populated-at"]',
			]);
			expect(commands[1]?.occurredAt).toBe(commands[0]?.occurredAt);
			expect(commands[1]?.causation).toEqual(commands[0]?.causation);
		}),
	);
});

const relationshipSchemaSlug = RelationshipSchemaSlug.make("related");
const relationshipSchemaPluginId = PluginId.make("relationship-schema-plugin-id");
const relationshipSchema = {
	slug: relationshipSchemaSlug,
	owner: { kind: "plugin" as const, pluginId: relationshipSchemaPluginId },
};
const relationship = {
	properties: {},
	wasInserted: true,
	relationshipSchemaSlug,
	scope: "global" as const,
	sourceEntityId: entityId,
	relationshipSchemaPluginId,
	createdAt: "2026-07-20T12:00:00.000Z",
	id: RelationshipId.make("relationship-id"),
	targetEntityId: EntityId.make("target-id"),
};

const mutationCommands = recordingServiceLayer<{
	kind: "relationship" | "delete" | "relationship-schema";
	command?: DomainLifecycleCommand;
	input?: unknown;
	reference?: ContractPayload<"testSupport", "upsertGlobalRelationship">["relationshipSchema"];
	userId?: UserId | null;
}>((record) => ({
	entities: {
		deleteByIds: (_ids, command) =>
			record({ command, kind: "delete" }).pipe(Effect.as({ warnings: [], deletedCount: 1 })),
	},
	relationships: {
		create: (input, command) =>
			record({ input, command, kind: "relationship" }).pipe(
				Effect.as({ relationship, warnings: [] }),
			),
	},
	relationshipSchemas: {
		findByReference: (reference, userId) =>
			record({ userId, reference, kind: "relationship-schema" }).pipe(
				Effect.as({
					name: "Related",
					isBuiltin: false,
					id: relationshipSchemaSlug,
					slug: relationshipSchemaSlug,
					targetEntitySchemaSlug: null,
					sourceEntitySchemaSlug: null,
					propertiesSchema: { fields: {} },
					pluginId: relationshipSchemaPluginId,
				}),
			),
	},
}));

layer(mutationCommands.layer)((test) => {
	test.effect("unwraps test relationship and delete mutation results", () =>
		Effect.gen(function* () {
			const service = yield* TestSupportService;
			expect(
				yield* service.upsertGlobalRelationship({
					relationshipSchema,
					sourceEntityId: entityId,
					targetEntityId: relationship.targetEntityId,
				}),
			).toEqual(relationship);
			expect(yield* service.deleteGlobalEntities([entityId])).toBe(1);
			const commands = yield* mutationCommands.recorded;
			expect(commands.find((entry) => entry.kind === "relationship-schema")).toEqual({
				userId: null,
				kind: "relationship-schema",
				reference: relationshipSchema,
			});
			expect(commands.find((entry) => entry.kind === "relationship")?.input).toMatchObject({
				scope: "global",
				relationshipSchema,
			});
			const commandFor = (kind: "relationship" | "delete") =>
				commands.findLast((entry) => entry.kind === kind)?.command;
			expect(commandFor("relationship")?.causation).toMatchObject({
				source: "api",
				initiator: { id: null, kind: "system" },
			});
			expect(commandFor("relationship")?.writeContext).toBeNull();
			expect(commandFor("relationship")?.itemIdentity).toBe(
				'["test-support:upsert-global-relationship",{"owner":{"kind":"plugin","pluginId":"relationship-schema-plugin-id"},"slug":"related"},"entity-id","target-id"]',
			);
			expect(commandFor("delete")?.causation).toMatchObject({
				source: "api",
				initiator: { id: null, kind: "system" },
			});
			expect(commandFor("delete")?.writeContext).toBeNull();
		}),
	);
});

const sandboxEnqueues = recordingServiceLayer<unknown>((record) => ({
	sandbox: {
		enqueue: (userId, payload, lane) =>
			record({ lane, userId, payload }).pipe(
				Effect.as({ jobId: "job-id", executionId: "execution-id" }),
			),
	},
}));

layer(sandboxEnqueues.layer)((test) => {
	test.effect("delegates sandbox execution with the explicit executing user", () => {
		const executingUserId = UserId.make("user-id");
		return Effect.gen(function* () {
			const service = yield* TestSupportService;
			expect(
				yield* service.enqueueSandbox({ scriptId, executingUserId, lane: "interactive" }),
			).toEqual({ jobId: "job-id", executionId: "execution-id" });
			expect((yield* sandboxEnqueues.recorded).at(-1)).toEqual({
				lane: "interactive",
				payload: { scriptId },
				userId: executingUserId,
			});
		});
	});
});

const cronTriggers = recordingServiceLayer<ReadonlyArray<string>>((record) => ({
	pluginCrons: {
		trigger: (pluginId, cronSlug, executionId) =>
			record([pluginId, cronSlug, executionId]).pipe(
				Effect.as({
					cronSlug,
					pluginId,
					executionId,
					status: "executed" as const,
					result: { status: "completed" },
				}),
			),
	},
}));

layer(cronTriggers.layer)((test) => {
	test.effect("triggers exactly one requested plugin cron with a manual execution id", () =>
		Effect.gen(function* () {
			const service = yield* TestSupportService;
			const pluginId = PluginId.make("example-plugin-id");
			const result = yield* service.triggerPluginCron({ pluginId, cronSlug: "monitor" });
			const triggerInput = (yield* cronTriggers.recorded).at(-1);
			expect(result.status).toBe("executed");
			expect(triggerInput?.slice(0, 2)).toEqual([pluginId, "monitor"]);
			expect(triggerInput?.[2]).toMatch(/^plugin-cron-manual-/);
		}),
	);
});
