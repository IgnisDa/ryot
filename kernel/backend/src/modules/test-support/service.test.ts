import { PgClient } from "@effect/sql-pg";
import { expect, layer } from "@effect/vitest";
import { PluginClientArtifactFromBase64 } from "@ryot-app/client-plugin-contract";
import {
	EntityId,
	EntitySchemaSlug,
	PluginId,
	PluginSlug,
	RelationshipId,
	RelationshipSchemaSlug,
	SandboxProviderId,
	SandboxScriptId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { Context, Effect, Encoding, Layer, Ref, Schema } from "effect";

import { LifecyclePlanner } from "#lib/domain/lifecycle";
import type { LifecycleCommand } from "#lib/domain/lifecycle-command";
import { LifecycleExecution } from "#lib/domain/lifecycle-execution";
import { RedisService } from "#lib/infrastructure/redis";
import { databaseLayer, makeRedisService, type MockOverrides } from "#lib/test-utils/effect";
import { AuthService } from "#modules/auth/service";
import { EntitiesRepository } from "#modules/entities/repository";
import { EntitiesService } from "#modules/entities/service";
import { InterestService } from "#modules/entity-interest/service";
import { TranslationsService } from "#modules/entity-translation/service";
import { PluginInstallationService } from "#modules/plugins/installation-service";
import { PluginRepository } from "#modules/plugins/repository";
import { PluginIngestionService } from "#modules/plugins/service";
import { fixtureClientArtifact } from "#modules/plugins/source.test-support";
import { fixtureManifest } from "#modules/plugins/test-support";
import type { PluginSource } from "#modules/plugins/types";
import { RelationshipSchemasRepository } from "#modules/relationship-schemas/repository";
import { RelationshipsService } from "#modules/relationships/service";
import { SandboxExecutionService } from "#modules/sandbox/service";
import { PluginCronService } from "#modules/scheduler/plugin-cron";

import { TestSupportService } from "./service";

const entityId = EntityId.make("entity-id");
const entitySchemaSlug = EntitySchemaSlug.make("entity-schema-id");
const scriptId = SandboxScriptId.make("script-id");

const mockAuth = Layer.mock(AuthService);
const mockEntities = Layer.mock(EntitiesService);
const mockInterest = Layer.mock(InterestService);
const mockPluginIngestion = Layer.mock(PluginIngestionService);
const mockPluginInstallations = Layer.mock(PluginInstallationService);
const mockPluginRepository = Layer.mock(PluginRepository);
const mockPluginCrons = Layer.mock(PluginCronService);
const mockSandbox = Layer.mock(SandboxExecutionService);
const mockTranslations = Layer.mock(TranslationsService);
const mockRelationships = Layer.mock(RelationshipsService);
const mockRelationshipSchemas = Layer.mock(RelationshipSchemasRepository);
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
					trigger: (pluginSlug, cronSlug) =>
						Effect.succeed({ cronSlug, pluginSlug, status: "notFound" as const }),
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

const testPluginManifest = () => {
	const manifest = fixtureManifest();
	return { ...manifest, metadata: { ...manifest.metadata, slug: "fixture" } };
};

const persistedPluginResult = (revision: string) => ({
	id: "plugin-id",
	installationId: "installation-id",
	configRevisionId: `config-${revision}`,
	activeRevisionId: `revision-${revision}`,
	scripts: [{ slug: "fixture.script", id: `script-${revision}` }],
});

const pluginInstallationResult = { id: "installation-id", pluginId: PluginId.make("plugin-id") };

const systemPluginManifest = {
	...testPluginManifest(),
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

const systemPluginIngestion = recordingServiceLayer<{
	files: Readonly<Record<string, Uint8Array>>;
	compiledScripts: PluginSource["compiledScripts"];
	compiledClient: PluginSource["compiledClient"];
}>((record) => ({
	pluginRepository: {
		findTestSupportOperationResult: () =>
			Effect.succeed({
				...persistedPluginResult("v1"),
				installationId: null,
				configRevisionId: null,
				scope: "system" as const,
			}),
	},
	pluginIngestion: {
		installPlugin: ({ files, compiledClient, compiledScripts }) =>
			record({ files, compiledClient, compiledScripts }).pipe(
				Effect.as({ slug: PluginSlug.make("fixture"), pluginId: PluginId.make("plugin-id") }),
			),
	},
}));

layer(systemPluginIngestion.layer)((test) => {
	test.effect("returns persisted system plugin identity after real ingestion completes", () => {
		const compiledClient = fixtureClientArtifact(systemPluginManifest.metadata.name);
		const compiledScripts = [
			{
				format: 1,
				source: "source",
				javascript: "compiled",
				entry: "backend/automations/fixture.sandbox.ts",
			},
		];
		return Effect.gen(function* () {
			const result = yield* (yield* TestSupportService).installSystemPlugin({
				compiledScripts,
				manifest: systemPluginManifest,
				compiledClient: yield* Schema.encodeUnknownEffect(PluginClientArtifactFromBase64)(
					compiledClient,
				),
				files: {
					"client/page.tsx": Encoding.encodeBase64(
						new TextEncoder().encode("export default () => null;"),
					),
					"backend/automations/fixture.sandbox.ts": Encoding.encodeBase64(
						new TextEncoder().encode("source"),
					),
				},
			});
			const ingested = (yield* systemPluginIngestion.recorded).at(-1);
			expect(
				new TextDecoder().decode(ingested?.files["backend/automations/fixture.sandbox.ts"]),
			).toBe("source");
			expect(ingested?.compiledScripts).toEqual(compiledScripts);
			expect(ingested?.compiledClient).toEqual(compiledClient);
			expect(result).toEqual({
				installationId: null,
				pluginId: "plugin-id",
				configRevisionId: null,
				activePluginRevisionId: "revision-v1",
				scripts: [{ id: "script-v1", slug: "fixture.script" }],
			});
		});
	});
});

const privatePluginOperations = recordingServiceLayer<"install" | "update">((record, recorded) => ({
	pluginRepository: {
		findTestSupportOperationResult: () =>
			Effect.map(recorded, (operations) =>
				persistedPluginResult(operations.includes("update") ? "v2" : "v1"),
			),
	},
	pluginInstallations: {
		updatePrivatePlugin: () => record("update").pipe(Effect.as(pluginInstallationResult)),
		installPrivatePlugin: () => record("install").pipe(Effect.as(pluginInstallationResult)),
	},
}));

layer(privatePluginOperations.layer)((test) => {
	test.effect("returns a fresh persisted private handle after install and update", () =>
		Effect.gen(function* () {
			const service = yield* TestSupportService;
			const installed = yield* service.installPrivatePlugin(UserId.make("owner"), {
				config: {},
				uploadToken: "install-upload",
			});
			const updated = yield* service.updatePrivatePlugin(
				UserId.make("owner"),
				PluginSlug.make("fixture"),
				{ uploadToken: "update-upload" },
			);
			expect(yield* privatePluginOperations.recorded).toEqual(["install", "update"]);
			expect(installed).toEqual({
				pluginId: "plugin-id",
				configRevisionId: "config-v1",
				installationId: "installation-id",
				activePluginRevisionId: "revision-v1",
				scripts: [{ id: "script-v1", slug: "fixture.script" }],
			});
			expect(updated).toEqual({
				pluginId: installed.pluginId,
				configRevisionId: "config-v2",
				activePluginRevisionId: "revision-v2",
				installationId: installed.installationId,
				scripts: [{ id: "script-v2", slug: "fixture.script" }],
			});
		}),
	);
});

const translationUpserts = recordingServiceLayer<unknown>((record) => ({
	translations: {
		upsert: (input) =>
			record(input).pipe(Effect.as({ entityId: input.entityId, language: input.language })),
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
				entityId,
				language: "es",
				name: "Nombre",
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
					itemIdentity: '["test-support:set-entity-populated-at","entity-id"]',
					causation: { source: "api", initiator: { id: null, kind: "system" } },
				},
			});
		}),
	);
});

const interestMemberships = recordingServiceLayer<unknown>((record) => ({
	interest: { setEntityInterestMembership: (input) => record(input).pipe(Effect.as(undefined)) },
}));

layer(interestMemberships.layer)((test) => {
	test.effect("delegates session membership without reconciliation", () =>
		Effect.gen(function* () {
			const service = yield* TestSupportService;
			yield* service.setEntityInterestMembership({
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
					entitySchemaSlug,
					name: providerEntity.name,
					externalId: providerEntity.externalId,
					properties: providerEntity.properties,
				}),
			).toEqual(providerEntity);
			expect((yield* globalEntityCreates.recorded).at(-1)).toMatchObject({
				providerId,
				entitySchemaSlug,
				populatedAt: null,
				name: providerEntity.name,
				externalId: providerEntity.externalId,
				properties: providerEntity.properties,
				lifecycle: {
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
	createdAt: "2026-07-20T12:00:00.000Z",
	updatedAt: "2026-07-20T12:00:00.000Z",
};

const rootFactCommands = recordingServiceLayer<LifecycleCommand>((record) => ({
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
				name: "Entity",
				properties: {},
				entitySchemaSlug,
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
const relationship = {
	properties: {},
	wasInserted: true,
	relationshipSchemaSlug,
	sourceEntityId: entityId,
	createdAt: "2026-07-20T12:00:00.000Z",
	id: RelationshipId.make("relationship-id"),
	targetEntityId: EntityId.make("target-id"),
};

const mutationCommands = recordingServiceLayer<{
	kind: "relationship" | "delete";
	command: LifecycleCommand;
}>((record) => ({
	entities: {
		deleteByIds: (_ids, command) =>
			record({ command, kind: "delete" }).pipe(Effect.as({ warnings: [], deletedCount: 1 })),
	},
	relationships: {
		create: (_input, command) =>
			record({ command, kind: "relationship" }).pipe(Effect.as({ relationship, warnings: [] })),
	},
	relationshipSchemas: {
		findById: () =>
			Effect.succeed({
				pluginId: null,
				name: "Related",
				slug: "related",
				isBuiltin: false,
				id: relationshipSchemaSlug,
				targetEntitySchemaSlug: null,
				sourceEntitySchemaSlug: null,
				propertiesSchema: { fields: {} },
			}),
	},
}));

layer(mutationCommands.layer)((test) => {
	test.effect("unwraps test relationship and delete mutation results", () =>
		Effect.gen(function* () {
			const service = yield* TestSupportService;
			expect(
				yield* service.upsertGlobalRelationship({
					relationshipSchemaSlug,
					sourceEntityId: entityId,
					targetEntityId: relationship.targetEntityId,
				}),
			).toEqual(relationship);
			expect(yield* service.deleteGlobalEntities([entityId])).toBe(1);
			const commands = yield* mutationCommands.recorded;
			const commandFor = (kind: "relationship" | "delete") =>
				commands.findLast((entry) => entry.kind === kind)?.command;
			expect(commandFor("relationship")?.causation).toMatchObject({
				source: "api",
				initiator: { id: null, kind: "system" },
			});
			expect(commandFor("delete")?.causation).toMatchObject({
				source: "api",
				initiator: { id: null, kind: "system" },
			});
		}),
	);
});

const sandboxEnqueues = recordingServiceLayer<unknown>((record) => ({
	sandbox: {
		enqueue: (userId, payload) =>
			record({ userId, payload }).pipe(Effect.as({ jobId: "job-id", executionId: "execution-id" })),
	},
}));

layer(sandboxEnqueues.layer)((test) => {
	test.effect("delegates sandbox execution with the explicit executing user", () => {
		const executingUserId = UserId.make("user-id");
		return Effect.gen(function* () {
			const service = yield* TestSupportService;
			expect(yield* service.enqueueSandbox({ scriptId, executingUserId })).toEqual({
				jobId: "job-id",
				executionId: "execution-id",
			});
			expect((yield* sandboxEnqueues.recorded).at(-1)).toEqual({
				payload: { scriptId },
				userId: executingUserId,
			});
		});
	});
});

const cronTriggers = recordingServiceLayer<ReadonlyArray<string>>((record) => ({
	pluginCrons: {
		trigger: (pluginSlug, cronSlug, executionId) =>
			record([pluginSlug, cronSlug, executionId]).pipe(
				Effect.as({
					cronSlug,
					pluginSlug,
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
			const result = yield* service.triggerPluginCron({
				cronSlug: "monitor",
				pluginSlug: PluginSlug.make("example"),
			});
			const triggerInput = (yield* cronTriggers.recorded).at(-1);
			expect(result.status).toBe("executed");
			expect(triggerInput?.slice(0, 2)).toEqual(["example", "monitor"]);
			expect(triggerInput?.[2]).toMatch(/^plugin-cron-manual-/);
		}),
	);
});
