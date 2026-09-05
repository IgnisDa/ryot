import { PgClient } from "@effect/sql-pg";
import { expect, it } from "@effect/vitest";
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
import { Effect, Encoding, Layer, Schema } from "effect";

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
				mockAuth({ auth: Object.create(null) }),
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

it.effect("returns persisted system plugin identity after real ingestion completes", () => {
	const manifest = {
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
	const compiledClient = fixtureClientArtifact(manifest.metadata.name);
	const compiledScripts = [
		{
			format: 1,
			source: "source",
			javascript: "compiled",
			entry: "backend/automations/fixture.sandbox.ts",
		},
	];
	let ingestedFiles: Readonly<Record<string, Uint8Array>> | undefined;
	let ingestedCompiledScripts: PluginSource["compiledScripts"];
	let ingestedCompiledClient: PluginSource["compiledClient"];
	const layer = makeServiceLayer({
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
			installPlugin: ({ files, compiledScripts: scripts, compiledClient: clientArtifact }) =>
				Effect.sync(() => {
					ingestedFiles = files;
					ingestedCompiledScripts = scripts;
					ingestedCompiledClient = clientArtifact;
					return { slug: PluginSlug.make("fixture"), pluginId: PluginId.make("plugin-id") };
				}),
		},
	});

	return Effect.gen(function* () {
		const result = yield* (yield* TestSupportService).installSystemPlugin({
			manifest,
			compiledScripts,
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
		expect(
			new TextDecoder().decode(ingestedFiles?.["backend/automations/fixture.sandbox.ts"]),
		).toBe("source");
		expect(ingestedCompiledScripts).toEqual(compiledScripts);
		expect(ingestedCompiledClient).toEqual(compiledClient);
		expect(result).toEqual({
			installationId: null,
			pluginId: "plugin-id",
			configRevisionId: null,
			activePluginRevisionId: "revision-v1",
			scripts: [{ id: "script-v1", slug: "fixture.script" }],
		});
	}).pipe(Effect.provide(layer));
});

it.effect("returns a fresh persisted private handle after install and update", () => {
	const operations: string[] = [];
	let revision = "v1";
	const layer = makeServiceLayer({
		pluginRepository: {
			findTestSupportOperationResult: () => Effect.succeed(persistedPluginResult(revision)),
		},
		pluginInstallations: {
			installPrivatePlugin: () =>
				Effect.sync(() => {
					operations.push("install");
					return pluginInstallationResult;
				}),
			updatePrivatePlugin: () =>
				Effect.sync(() => {
					operations.push("update");
					revision = "v2";
					return pluginInstallationResult;
				}),
		},
	});

	return Effect.gen(function* () {
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
		expect(operations).toEqual(["install", "update"]);
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
	}).pipe(Effect.provide(layer));
});

it.effect("returns the persisted translation id from an upsert", () => {
	let received: unknown;
	const layer = makeServiceLayer({
		translations: {
			upsert: (input) =>
				Effect.sync(() => {
					received = input;
					return "translation-row-id";
				}),
		},
	});
	return Effect.gen(function* () {
		const result = yield* (yield* TestSupportService).upsertEntityTranslation({
			entityId,
			language: "es",
			name: "Nombre",
			properties: null,
		});
		expect(result).toEqual({ id: "translation-row-id" });
		expect(received).toMatchObject({ entityId, language: "es", name: "Nombre" });
	}).pipe(Effect.provide(layer));
});

it.effect("updates populatedAt without changing entity fields", () => {
	const populatedAt = "2026-07-20T12:00:00.000Z";
	const populatedAtDate = new Date(populatedAt);
	let updateInput: unknown;
	const entity = {
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
	const layer = makeServiceLayer({
		entities: {
			getByIdAnyScope: () => Effect.succeed(entity),
			update: (input) =>
				Effect.sync(() => {
					updateInput = input;
					return { warnings: [], entity: { ...entity, populatedAt } };
				}),
		},
	});

	return Effect.gen(function* () {
		const service = yield* TestSupportService;
		yield* service.setEntityPopulatedAt(entityId, populatedAt);
		expect(updateInput).toMatchObject({
			entityId,
			scope: "global",
			name: entity.name,
			populatedAt: populatedAtDate,
			properties: entity.properties,
			lifecycle: {
				itemIdentity: '["test-support:set-entity-populated-at","entity-id"]',
				causation: { source: "api", initiator: { id: null, kind: "system" } },
			},
		});
	}).pipe(Effect.provide(layer));
});

it.effect("delegates session membership without reconciliation", () => {
	let membership: unknown;
	const layer = makeServiceLayer({
		interest: {
			setEntityInterestMembership: (input) =>
				Effect.sync(() => {
					membership = input;
					return undefined;
				}),
		},
	});

	return Effect.gen(function* () {
		const service = yield* TestSupportService;
		yield* service.setEntityInterestMembership({
			sessionId: "session-1",
			entityIds: [EntityId.make("entity-1")],
		});
		expect(membership).toEqual({ sessionId: "session-1", entityIds: ["entity-1"] });
	}).pipe(Effect.provide(layer));
});

it.effect("creates global entities with provider provenance", () => {
	const providerId = SandboxProviderId.make("provider-id");
	let createInput: unknown;
	const entity = {
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
	const layer = makeServiceLayer({
		entities: {
			createGlobal: (input) =>
				Effect.sync(() => {
					createInput = input;
					return { entity, warnings: [] };
				}),
		},
	});

	return Effect.gen(function* () {
		const service = yield* TestSupportService;
		expect(
			yield* service.createGlobalEntity({
				providerId,
				entitySchemaSlug,
				name: entity.name,
				externalId: entity.externalId,
				properties: entity.properties,
			}),
		).toEqual(entity);
		expect(createInput).toMatchObject({
			providerId,
			entitySchemaSlug,
			populatedAt: null,
			name: entity.name,
			externalId: entity.externalId,
			properties: entity.properties,
			lifecycle: {
				itemIdentity: '["test-support:create-global-entity","create"]',
				causation: { source: "api", initiator: { id: null, kind: "system" } },
			},
		});
	}).pipe(Effect.provide(layer));
});

it.effect("uses one root fact for create and populatedAt update", () => {
	const commands: LifecycleCommand[] = [];
	const entity = {
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
	const layer = makeServiceLayer({
		entities: {
			createGlobal: (input) =>
				Effect.sync(() => {
					commands.push(input.lifecycle);
					return { entity, warnings: [] };
				}),
			update: (input) =>
				Effect.sync(() => {
					commands.push(input.lifecycle);
					return { warnings: [], entity: { ...entity, populatedAt: "2026-07-21T00:00:00.000Z" } };
				}),
		},
	});
	return Effect.gen(function* () {
		yield* (yield* TestSupportService).createGlobalEntity({
			name: "Entity",
			properties: {},
			entitySchemaSlug,
			populatedAt: "2026-07-21T00:00:00.000Z",
		});
		expect(commands.map(({ itemIdentity }) => itemIdentity)).toEqual([
			'["test-support:create-global-entity","create"]',
			'["test-support:create-global-entity","set-populated-at"]',
		]);
		expect(commands[1]?.occurredAt).toBe(commands[0]?.occurredAt);
		expect(commands[1]?.causation).toEqual(commands[0]?.causation);
	}).pipe(Effect.provide(layer));
});

it.effect("unwraps test relationship and delete mutation results", () => {
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
	let relationshipCommand: LifecycleCommand | undefined;
	let deleteCommand: LifecycleCommand | undefined;
	const layer = makeServiceLayer({
		entities: {
			deleteByIds: (_ids, command) =>
				Effect.sync(() => {
					deleteCommand = command;
					return { warnings: [], deletedCount: 1 };
				}),
		},
		relationships: {
			create: (_input, command) =>
				Effect.sync(() => {
					relationshipCommand = command;
					return { relationship, warnings: [] };
				}),
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
	});
	return Effect.gen(function* () {
		const service = yield* TestSupportService;
		expect(
			yield* service.upsertGlobalRelationship({
				relationshipSchemaSlug,
				sourceEntityId: entityId,
				targetEntityId: relationship.targetEntityId,
			}),
		).toEqual(relationship);
		expect(yield* service.deleteGlobalEntities([entityId])).toBe(1);
		expect(relationshipCommand?.causation).toMatchObject({
			source: "api",
			initiator: { id: null, kind: "system" },
		});
		expect(deleteCommand?.causation).toMatchObject({
			source: "api",
			initiator: { id: null, kind: "system" },
		});
	}).pipe(Effect.provide(layer));
});

it.effect("delegates sandbox execution with the explicit executing user", () => {
	const executingUserId = UserId.make("user-id");
	let enqueueInput: unknown;
	const layer = makeServiceLayer({
		sandbox: {
			enqueue: (userId, payload) =>
				Effect.sync(() => {
					enqueueInput = { userId, payload };
					return { jobId: "job-id", executionId: "execution-id" };
				}),
		},
	});

	return Effect.gen(function* () {
		const service = yield* TestSupportService;
		expect(yield* service.enqueueSandbox({ scriptId, executingUserId })).toEqual({
			jobId: "job-id",
			executionId: "execution-id",
		});
		expect(enqueueInput).toEqual({ payload: { scriptId }, userId: executingUserId });
	}).pipe(Effect.provide(layer));
});

it.effect("triggers exactly one requested plugin cron with a manual execution id", () => {
	let triggerInput: ReadonlyArray<string> | undefined;
	const layer = makeServiceLayer({
		pluginCrons: {
			trigger: (pluginSlug, cronSlug, executionId) =>
				Effect.sync(() => {
					triggerInput = [pluginSlug, cronSlug, executionId];
					return {
						cronSlug,
						pluginSlug,
						executionId,
						status: "executed" as const,
						result: { status: "completed" },
					};
				}),
		},
	});

	return Effect.gen(function* () {
		const service = yield* TestSupportService;
		const result = yield* service.triggerPluginCron({
			cronSlug: "monitor",
			pluginSlug: PluginSlug.make("example"),
		});
		expect(result.status).toBe("executed");
		expect(triggerInput?.slice(0, 2)).toEqual(["example", "monitor"]);
		expect(triggerInput?.[2]).toMatch(/^plugin-cron-manual-/);
	}).pipe(Effect.provide(layer));
});
