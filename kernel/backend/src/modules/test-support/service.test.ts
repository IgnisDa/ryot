import { expect, it } from "@effect/vitest";
import {
	EntityId,
	EntitySchemaSlug,
	PluginSlug,
	SandboxProviderId,
	SandboxScriptId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { Effect, Layer } from "effect";

import { RedisService } from "#lib/infrastructure/redis";
import { databaseLayer, makeRedisService, type MockOverrides } from "#lib/test-utils/effect";
import { AuthService } from "#modules/auth/service";
import { AutomationsService } from "#modules/automations/service";
import { DefinitionRegistry, makeDefinitionRegistry } from "#modules/definition-registry/service";
import { EntitiesService } from "#modules/entities/service";
import { InterestService } from "#modules/entity-interest/service";
import { TranslationsService } from "#modules/entity-translation/service";
import { PluginInstallationService } from "#modules/plugins/installation-service";
import { PluginIngestionService } from "#modules/plugins/service";
import { RelationshipSchemasRepository } from "#modules/relationship-schemas/repository";
import { RelationshipsService } from "#modules/relationships/service";
import { SandboxExecutionService } from "#modules/sandbox/service";
import { PluginBootService } from "#modules/scheduler/plugin-boot";
import { PluginCronService } from "#modules/scheduler/plugin-cron";
import { SignalsService } from "#modules/signals/service";

import { TestSupportService } from "./service";

const entityId = EntityId.make("entity-id");
const entitySchemaSlug = EntitySchemaSlug.make("entity-schema-id");
const scriptId = SandboxScriptId.make("script-id");

const storedSandboxScript = {
	id: scriptId,
	name: "Script",
	slug: "script",
	compiledFormat: 1,
	source: "export default {}",
	compiledCode: "export default {}",
	metadata: { kind: "script" as const },
};

const mockAuth = Layer.mock(AuthService);
const mockSignals = Layer.mock(SignalsService);
const mockEntities = Layer.mock(EntitiesService);
const mockInterest = Layer.mock(InterestService);
const mockPluginBoots = Layer.mock(PluginBootService);
const mockPluginIngestion = Layer.mock(PluginIngestionService);
const mockPluginInstallations = Layer.mock(PluginInstallationService);
const mockPluginCrons = Layer.mock(PluginCronService);
const mockAutomations = Layer.mock(AutomationsService);
const mockSandbox = Layer.mock(SandboxExecutionService);
const mockTranslations = Layer.mock(TranslationsService);
const mockRelationships = Layer.mock(RelationshipsService);
const mockRelationshipSchemas = Layer.mock(RelationshipSchemasRepository);
const makeServiceLayer = (
	overrides: {
		sandbox?: MockOverrides<typeof mockSandbox>;
		entities?: MockOverrides<typeof mockEntities>;
		interest?: MockOverrides<typeof mockInterest>;
		pluginBoots?: MockOverrides<typeof mockPluginBoots>;
		pluginCrons?: MockOverrides<typeof mockPluginCrons>;
	} = {},
	definitions = makeDefinitionRegistry(),
) => {
	return TestSupportService.layer.pipe(
		Layer.provideMerge(
			Layer.mergeAll(
				databaseLayer,
				mockAuth({ auth: Object.create(null) }),
				mockAutomations({}),
				mockSignals({}),
				Layer.succeed(RedisService, makeRedisService()),
				Layer.succeed(DefinitionRegistry, { ...definitions }),
				mockEntities({ ...overrides.entities }),
				mockSandbox({ ...overrides.sandbox }),
				mockPluginCrons({
					trigger: (pluginSlug, cronSlug) =>
						Effect.succeed({ cronSlug, pluginSlug, status: "notFound" as const }),
					...overrides.pluginCrons,
				}),
				mockPluginBoots({ trigger: () => Effect.void, ...overrides.pluginBoots }),
				mockPluginIngestion({}),
				mockPluginInstallations({}),
				mockInterest({ ...overrides.interest }),
				mockTranslations({}),
				mockRelationships({}),
				mockRelationshipSchemas({}),
			),
		),
	);
};

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
					return { ...entity, populatedAt };
				}),
		},
	});

	return Effect.gen(function* () {
		const service = yield* TestSupportService;
		yield* service.setEntityPopulatedAt(entityId, populatedAt);
		expect(updateInput).toEqual({
			entityId,
			scope: "global",
			name: entity.name,
			populatedAt: populatedAtDate,
			properties: entity.properties,
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
					return entity;
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
		expect(createInput).toEqual({
			providerId,
			entitySchemaSlug,
			populatedAt: null,
			name: entity.name,
			externalId: entity.externalId,
			properties: entity.properties,
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

it.effect("brands provider IDs in stored sandbox script responses", () => {
	const providerId = "provider-id";
	const layer = makeServiceLayer({
		sandbox: {
			getStoredScript: () => Effect.succeed({ ...storedSandboxScript, providerId }),
			listStoredScripts: Effect.succeed([
				{ ...storedSandboxScript, providerId },
				{ ...storedSandboxScript, providerId: null, id: SandboxScriptId.make("standalone-id") },
			]),
		},
	});

	return Effect.gen(function* () {
		const service = yield* TestSupportService;
		expect(yield* service.getSandboxScript(scriptId)).toEqual({
			...storedSandboxScript,
			providerId: SandboxProviderId.make(providerId),
		});
		expect(yield* service.listSandboxScripts()).toEqual([
			{ ...storedSandboxScript, providerId: SandboxProviderId.make(providerId) },
			{ ...storedSandboxScript, providerId: null, id: SandboxScriptId.make("standalone-id") },
		]);
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

it.effect("triggers plugin boots with the manual boot execution id", () => {
	let pluginBootExecutionId: string | undefined;
	let pluginBootIdentity: { bootSlug: string; pluginSlug: string } | undefined;
	const layer = makeServiceLayer({
		pluginBoots: {
			trigger: (identity, executionId) =>
				Effect.sync(() => {
					pluginBootIdentity = identity;
					pluginBootExecutionId = executionId;
				}),
		},
	});

	return Effect.gen(function* () {
		const service = yield* TestSupportService;
		const result = yield* service.triggerPluginBoot({
			bootSlug: "fixture",
			pluginSlug: PluginSlug.make("example"),
		});
		expect(result.executionId).toMatch(/^plugin-boot-manual-/);
		expect(pluginBootIdentity).toEqual({ bootSlug: "fixture", pluginSlug: "example" });
		expect(pluginBootExecutionId).toBe(result.executionId);
	}).pipe(Effect.provide(layer));
});
