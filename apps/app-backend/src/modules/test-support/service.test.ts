import { expect, it } from "@effect/vitest";
import {
	EntityId,
	EntitySchemaSlug,
	PluginSlug,
	SandboxProviderId,
	SandboxScriptId,
	UserId,
} from "@ryot/contract/schema/brands";
import { Effect, Layer } from "effect";

import type { MockOverrides } from "#lib/test-utils/effect";
import { AuthService } from "#modules/auth/service";
import { AutomationsService } from "#modules/automations/service";
import { DefinitionRegistry, makeDefinitionRegistry } from "#modules/definition-registry/service";
import { EntitiesService } from "#modules/entities/service";
import { InterestService } from "#modules/entity-interest/service";
import { TranslationsService } from "#modules/entity-translation/service";
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
	source: "export default {}",
	compiledCode: "export default {}",
	compiledFormat: 1,
	metadata: { kind: "script" as const },
};

const mockAuth = Layer.mock(AuthService);
const mockSignals = Layer.mock(SignalsService);
const mockEntities = Layer.mock(EntitiesService);
const mockInterest = Layer.mock(InterestService);
const mockPluginBoots = Layer.mock(PluginBootService);
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
		pluginBoots?: MockOverrides<typeof mockPluginBoots>;
		pluginCrons?: MockOverrides<typeof mockPluginCrons>;
	} = {},
	definitions = makeDefinitionRegistry(),
) => {
	return TestSupportService.Default.pipe(
		Layer.provide(
			Layer.mergeAll(
				mockAuth({ _tag: "AuthService", auth: Object.create(null) }),
				mockAutomations({ _tag: "AutomationsService" }),
				mockSignals({ _tag: "SignalsService" }),
				Layer.succeed(DefinitionRegistry, { _tag: "DefinitionRegistry", ...definitions }),
				mockEntities({ _tag: "EntitiesService", ...overrides.entities }),
				mockSandbox({ _tag: "SandboxExecutionService", ...overrides.sandbox }),
				mockPluginCrons({
					_tag: "PluginCronService",
					trigger: (pluginSlug, cronSlug) =>
						Effect.succeed({ status: "notFound" as const, cronSlug, pluginSlug }),
					...overrides.pluginCrons,
				}),
				mockPluginBoots({
					_tag: "PluginBootService",
					triggerAll: () => Effect.void,
					...overrides.pluginBoots,
				}),
				mockInterest({ _tag: "InterestService" }),
				mockTranslations({ _tag: "TranslationsService" }),
				mockRelationships({ _tag: "RelationshipsService" }),
				mockRelationshipSchemas({ _tag: "RelationshipSchemasRepository" }),
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
		populatedAt: null,
		providerId: null,
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
			entitySchemaSlug,
			name: entity.name,
			populatedAt: populatedAtDate,
			properties: entity.properties,
		});
	}).pipe(Effect.provide(layer));
});

it.effect("creates global entities with provider provenance", () => {
	const providerId = SandboxProviderId.make("provider-id");
	let createInput: unknown;
	const entity = {
		id: entityId,
		providerId,
		name: "Entity",
		externalId: "external-id",
		populatedAt: null,
		entitySchemaSlug,
		createdAt: "2026-07-20T12:00:00.000Z",
		updatedAt: "2026-07-20T12:00:00.000Z",
		properties: { title: "Entity" },
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
				name: entity.name,
				externalId: entity.externalId,
				properties: entity.properties,
				entitySchemaSlug,
			}),
		).toEqual(entity);
		expect(createInput).toEqual({
			providerId,
			populatedAt: null,
			name: entity.name,
			externalId: entity.externalId,
			properties: entity.properties,
			entitySchemaSlug,
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
					return { jobId: "job-id" };
				}),
		},
	});

	return Effect.gen(function* () {
		const service = yield* TestSupportService;
		expect(yield* service.enqueueSandbox({ executingUserId, scriptId })).toEqual({
			jobId: "job-id",
		});
		expect(enqueueInput).toEqual({
			userId: executingUserId,
			payload: { scriptId },
		});
	}).pipe(Effect.provide(layer));
});

it.effect("brands provider IDs in stored sandbox script responses", () => {
	const providerId = "provider-id";
	const layer = makeServiceLayer({
		sandbox: {
			getStoredScript: () => Effect.succeed({ ...storedSandboxScript, providerId }),
			listStoredScripts: () =>
				Effect.succeed([
					{ ...storedSandboxScript, providerId },
					{ ...storedSandboxScript, id: SandboxScriptId.make("standalone-id"), providerId: null },
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
			{ ...storedSandboxScript, id: SandboxScriptId.make("standalone-id"), providerId: null },
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
						lot: "script" as const,
						result: { status: "completed" },
						status: "executed" as const,
					};
				}),
		},
	});

	return Effect.gen(function* () {
		const service = yield* TestSupportService;
		const result = yield* service.triggerPluginCron({
			cronSlug: "monitor",
			pluginSlug: PluginSlug.make("media"),
		});
		expect(result.status).toBe("executed");
		expect(triggerInput?.slice(0, 2)).toEqual(["media", "monitor"]);
		expect(triggerInput?.[2]).toMatch(/^plugin-cron-manual-/);
	}).pipe(Effect.provide(layer));
});

it.effect("triggers plugin boots with the manual boot execution id", () => {
	let pluginBootExecutionId: string | undefined;
	const layer = makeServiceLayer({
		pluginBoots: {
			triggerAll: (executionId) =>
				Effect.sync(() => {
					pluginBootExecutionId = executionId;
				}),
		},
	});

	return Effect.gen(function* () {
		const service = yield* TestSupportService;
		const result = yield* service.triggerPluginBoot();
		expect(result.executionId).toMatch(/^plugin-boot-manual-/);
		expect(pluginBootExecutionId).toBe(result.executionId);
	}).pipe(Effect.provide(layer));
});
