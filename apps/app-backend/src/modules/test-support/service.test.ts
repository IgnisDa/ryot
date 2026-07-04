import { assert, expect, it } from "@effect/vitest";
import { WorkflowEngine } from "@effect/workflow/WorkflowEngine";
import { EntityId, EntitySchemaSlug, SandboxScriptId } from "@ryot/contract/schema/brands";
import { dayjs } from "@ryot/ts-utils/dayjs";
import { Effect, Layer } from "effect";

import type { MockOverrides } from "#lib/test-utils/effect";
import { makeWorkflowEngine, transactionLayer } from "#lib/test-utils/effect";
import { AuthService } from "#modules/auth/service";
import { AutomationsService } from "#modules/automations/service";
import { DefinitionRegistry, makeDefinitionRegistry } from "#modules/definition-registry/service";
import { EntitiesService } from "#modules/entities/service";
import { InterestService } from "#modules/entity-interest/service";
import { EntitySchemasRepository } from "#modules/entity-schemas/repository";
import { TranslationsService } from "#modules/entity-translation/service";
import { RelationshipSchemasRepository } from "#modules/relationship-schemas/repository";
import { RelationshipsService } from "#modules/relationships/service";
import { SandboxApiService } from "#modules/sandbox/service";
import { SignalsService } from "#modules/signals/service";

import { TestSupportService } from "./service";

const entityId = EntityId.make("entity-id");
const scriptId = SandboxScriptId.make("script-id");
const entitySchemaSlug = EntitySchemaSlug.make("entity-schema-id");

const mockAuth = Layer.mock(AuthService);
const mockSignals = Layer.mock(SignalsService);
const mockEntities = Layer.mock(EntitiesService);
const mockInterest = Layer.mock(InterestService);
const mockSandbox = Layer.mock(SandboxApiService);
const mockAutomations = Layer.mock(AutomationsService);
const mockTranslations = Layer.mock(TranslationsService);
const mockRelationships = Layer.mock(RelationshipsService);
const mockEntitySchemas = Layer.mock(EntitySchemasRepository);
const mockRelationshipSchemas = Layer.mock(RelationshipSchemasRepository);
const workflowEngineLayer = Layer.succeed(
	WorkflowEngine,
	makeWorkflowEngine({ execute: () => Effect.void.pipe(Effect.as(undefined)) }),
);

const makeServiceLayer = (
	overrides: {
		sandbox?: MockOverrides<typeof mockSandbox>;
		entities?: MockOverrides<typeof mockEntities>;
		relationships?: MockOverrides<typeof mockRelationships>;
		entitySchemas?: MockOverrides<typeof mockEntitySchemas>;
	} = {},
	definitions = makeDefinitionRegistry(),
) =>
	TestSupportService.Default.pipe(
		Layer.provide(
			Layer.mergeAll(
				transactionLayer,
				mockAuth({ _tag: "AuthService", auth: Object.create(null) }),
				mockAutomations({ _tag: "AutomationsService" }),
				mockSignals({ _tag: "SignalsService" }),
				Layer.succeed(DefinitionRegistry, { _tag: "DefinitionRegistry", ...definitions }),
				mockEntities({ _tag: "EntitiesService", ...overrides.entities }),
				mockSandbox({ _tag: "SandboxApiService", ...overrides.sandbox }),
				mockInterest({ _tag: "InterestService" }),
				mockTranslations({ _tag: "TranslationsService" }),
				mockRelationships({ _tag: "RelationshipsService", ...overrides.relationships }),
				mockEntitySchemas({ _tag: "EntitySchemasRepository", ...overrides.entitySchemas }),
				mockRelationshipSchemas({ _tag: "RelationshipSchemasRepository" }),
				workflowEngineLayer,
			),
		),
	);

it.effect("deletes script-owned rows in order and remains idempotent", () => {
	const calls: string[] = [];
	const layer = makeServiceLayer({
		relationships: {
			deleteTouchingEntitiesOfSandboxScript: () =>
				Effect.sync(() => {
					calls.push("relationships");
					return 0;
				}),
		},
		entities: {
			deleteBySandboxScript: () =>
				Effect.sync(() => {
					calls.push("entities");
					return 0;
				}),
		},
		entitySchemas: {
			deleteSandboxScriptLinks: () =>
				Effect.sync(() => {
					calls.push("links");
					return 0;
				}),
		},
		sandbox: {
			deleteStoredScript: () =>
				Effect.sync(() => {
					calls.push("script");
					return null;
				}),
		},
	});

	return Effect.gen(function* () {
		const service = yield* TestSupportService;
		expect(yield* service.deleteSandboxScript(scriptId)).toEqual({ id: scriptId });
		expect(yield* service.deleteSandboxScript(scriptId)).toEqual({ id: scriptId });
		expect(calls).toEqual([
			"relationships",
			"entities",
			"links",
			"script",
			"relationships",
			"entities",
			"links",
			"script",
		]);
	}).pipe(Effect.provide(layer));
});

it.effect("updates populatedAt without changing entity fields", () => {
	const populatedAt = "2026-07-20T12:00:00.000Z";
	const populatedAtDate = dayjs(populatedAt).toDate();
	let updateInput: unknown;
	const entity = {
		id: entityId,
		name: "Entity",
		entitySchemaSlug,
		externalId: null,
		populatedAt: null,
		sandboxScriptId: null,
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
			properties: entity.properties,
			populatedAt: populatedAtDate,
		});
	}).pipe(Effect.provide(layer));
});

const emptyPropertiesSchema = { fields: {} } as const;
const testEntity = {
	icon: "book",
	name: "Test Book",
	slug: "test-book",
	accentColor: "blue",
	propertiesSchema: emptyPropertiesSchema,
	eventSchemas: [
		{
			name: "Started",
			slug: "started",
			propertiesSchema: emptyPropertiesSchema,
		},
	],
};

it.effect("additively installs entity, relationship, and tracker definitions", () => {
	const definitions = makeDefinitionRegistry();
	const layer = makeServiceLayer({}, definitions);

	return Effect.gen(function* () {
		const service = yield* TestSupportService;
		yield* service.installDefinitions({
			entitySchemas: [testEntity],
			trackers: [
				{
					icon: "library",
					name: "Test Books",
					slug: "test-books",
					sortOrder: 10,
					accentColor: "blue",
					description: null,
					entitySchemaSlugs: [testEntity.slug],
				},
			],
			relationshipSchemas: [
				{
					name: "Test Related",
					slug: "test-related",
					propertiesSchema: emptyPropertiesSchema,
					sourceEntitySchemaSlug: testEntity.slug,
					targetEntitySchemaSlug: null,
				},
			],
		});

		expect(definitions.getEntitySchema("movie")).toBeDefined();
		expect(definitions.getEntitySchema(testEntity.slug)).toBeDefined();
		expect(definitions.getRelationshipSchema("test-related")).toBeDefined();
		expect(definitions.getTracker("test-books")?.description).toBe("");
	}).pipe(Effect.provide(layer));
});

it.effect("replaces same-slug test definitions including nested events", () => {
	const definitions = makeDefinitionRegistry();
	const layer = makeServiceLayer({}, definitions);

	return Effect.gen(function* () {
		const service = yield* TestSupportService;
		yield* service.installDefinitions({
			entitySchemas: [testEntity, { ...testEntity, name: "Unrelated", slug: "test-unrelated" }],
		});
		yield* service.installDefinitions({
			entitySchemas: [
				{
					...testEntity,
					name: "Updated Test Book",
					eventSchemas: [
						{
							name: "Finished",
							slug: "finished",
							propertiesSchema: emptyPropertiesSchema,
						},
					],
				},
			],
		});

		expect(definitions.getEntitySchema(testEntity.slug)?.name).toBe("Updated Test Book");
		expect(definitions.getEventSchema(testEntity.slug, "started")).toBeUndefined();
		expect(definitions.getEventSchema(testEntity.slug, "finished")?.name).toBe("Finished");
		expect(definitions.getEntitySchema("test-unrelated")?.name).toBe("Unrelated");
	}).pipe(Effect.provide(layer));
});

it.effect("rejects a builtin definition slug", () => {
	const definitions = makeDefinitionRegistry();
	const layer = makeServiceLayer({}, definitions);

	return Effect.gen(function* () {
		const service = yield* TestSupportService;
		const movie = definitions.getEntitySchema("movie");
		assert(movie);
		const failure = yield* Effect.flip(
			service.installDefinitions({
				entitySchemas: [{ ...movie, eventSchemas: Object.values(movie.eventSchemas) }],
			}),
		);

		expect(failure.message).toMatch(/Builtin definition slug cannot be replaced: movie/);
		expect(definitions.getEntitySchema("movie")).toBe(movie);
	}).pipe(Effect.provide(layer));
});

it.effect("leaves the previous snapshot intact when complete-source validation fails", () => {
	const definitions = makeDefinitionRegistry();
	const layer = makeServiceLayer({}, definitions);
	const original = definitions.getSnapshot();

	return Effect.gen(function* () {
		const service = yield* TestSupportService;
		const failure = yield* Effect.flip(
			service.installDefinitions({
				trackers: [
					{
						icon: "broken",
						name: "Broken",
						slug: "broken",
						sortOrder: 0,
						accentColor: "red",
						description: null,
						entitySchemaSlugs: ["missing"],
					},
				],
			}),
		);

		expect(failure.message).toMatch(/references missing entity schema missing/);
		expect(definitions.getSnapshot()).toBe(original);
		expect(definitions.getTracker("broken")).toBeUndefined();
	}).pipe(Effect.provide(layer));
});
