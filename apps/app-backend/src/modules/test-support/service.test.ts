import { expect, it } from "@effect/vitest";
import {
	EntityId,
	EntitySchemaId,
	EventSchemaId,
	SandboxScriptId,
} from "@ryot/contract/schema/brands";
import { dayjs } from "@ryot/ts-utils/dayjs";
import { Effect, Layer } from "effect";

import type { MockOverrides } from "#lib/test-utils/effect";
import { transactionLayer } from "#lib/test-utils/effect";
import { AuthService } from "#modules/auth/service";
import { EntitiesService } from "#modules/entities/service";
import { EntitySchemasService } from "#modules/entity-schemas/service";
import { TranslationsService } from "#modules/entity-translation/service";
import { EventsService } from "#modules/events/service";
import { RelationshipSchemasService } from "#modules/relationship-schemas/service";
import { RelationshipsService } from "#modules/relationships/service";
import { SandboxApiService } from "#modules/sandbox/service";

import { TestSupportService } from "./service";

const entityId = EntityId.make("entity-id");
const scriptId = SandboxScriptId.make("script-id");
const entitySchemaId = EntitySchemaId.make("entity-schema-id");

const mockAuth = Layer.mock(AuthService);
const mockEvents = Layer.mock(EventsService);
const mockEntities = Layer.mock(EntitiesService);
const mockSandbox = Layer.mock(SandboxApiService);
const mockTranslations = Layer.mock(TranslationsService);
const mockRelationships = Layer.mock(RelationshipsService);
const mockEntitySchemas = Layer.mock(EntitySchemasService);
const mockRelationshipSchemas = Layer.mock(RelationshipSchemasService);

const makeServiceLayer = (
	overrides: {
		events?: MockOverrides<typeof mockEvents>;
		sandbox?: MockOverrides<typeof mockSandbox>;
		entities?: MockOverrides<typeof mockEntities>;
		relationships?: MockOverrides<typeof mockRelationships>;
		entitySchemas?: MockOverrides<typeof mockEntitySchemas>;
	} = {},
) =>
	TestSupportService.Default.pipe(
		Layer.provide(
			Layer.mergeAll(
				transactionLayer,
				mockAuth({ _tag: "AuthService", auth: Object.create(null) }),
				mockEvents({ _tag: "EventsService", ...overrides.events }),
				mockEntities({ _tag: "EntitiesService", ...overrides.entities }),
				mockSandbox({ _tag: "SandboxApiService", ...overrides.sandbox }),
				mockTranslations({ _tag: "TranslationsService" }),
				mockRelationships({ _tag: "RelationshipsService", ...overrides.relationships }),
				mockEntitySchemas({ _tag: "EntitySchemasService", ...overrides.entitySchemas }),
				mockRelationshipSchemas({ _tag: "RelationshipSchemasService" }),
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
		entitySchemaId,
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
			entitySchemaId,
			name: entity.name,
			properties: entity.properties,
			populatedAt: populatedAtDate,
		});
	}).pipe(Effect.provide(layer));
});

it.effect("defaults event schema trigger ownership to global", () => {
	let triggerInput: unknown;
	const layer = makeServiceLayer({
		events: {
			createTrigger: (input) =>
				Effect.sync(() => {
					triggerInput = input;
					return { id: "trigger-id" };
				}),
		},
	});

	return Effect.gen(function* () {
		const service = yield* TestSupportService;
		expect(
			yield* service.createEventSchemaTrigger({
				position: 10,
				name: "Trigger",
				phase: "before_create",
				sandboxScriptId: scriptId,
				eventSchemaId: EventSchemaId.make("event-schema-id"),
			}),
		).toEqual({ id: "trigger-id" });
		expect(triggerInput).toEqual({
			userId: null,
			position: 10,
			name: "Trigger",
			phase: "before_create",
			sandboxScriptId: scriptId,
			eventSchemaId: EventSchemaId.make("event-schema-id"),
		});
	}).pipe(Effect.provide(layer));
});
