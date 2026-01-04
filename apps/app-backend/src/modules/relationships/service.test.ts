import { expect, it } from "@effect/vitest";
import { BadRequest } from "@ryot/contract/errors";
import {
	EntityId,
	RelationshipId,
	RelationshipSchemaId,
	UserId,
} from "@ryot/contract/schema/brands";
import { Cause, Effect, Exit, Layer } from "effect";

import type { MockOverrides } from "#lib/test-support/effect";
import { dbRunnerLayer } from "#lib/test-support/effect";

import { RelationshipsRepository } from "./repository";
import { RelationshipsService } from "./service";

const userId = UserId.make("user-id");
const sourceEntityId = EntityId.make("source-entity-id");
const targetEntityId = EntityId.make("target-entity-id");
const relationshipSchemaId = RelationshipSchemaId.make("rel-schema-id");

const savedRelationship = {
	properties: {},
	sourceEntityId,
	targetEntityId,
	wasInserted: true,
	relationshipSchemaId,
	id: RelationshipId.make("rel-id"),
	createdAt: "2026-06-22T00:00:00.000Z",
};

const createOutcome = { operation: "create" as const, relationship: savedRelationship };

const mockRelationshipsRepository = Layer.mock(RelationshipsRepository);

const makeRelationshipsRepository = (
	overrides: MockOverrides<typeof mockRelationshipsRepository> = {},
) =>
	mockRelationshipsRepository({
		...overrides,
		_tag: "RelationshipsRepository",
	});

const makeServiceLayer = (overrides: Parameters<typeof makeRelationshipsRepository>[0] = {}) =>
	RelationshipsService.Default.pipe(
		Layer.provide(Layer.mergeAll(dbRunnerLayer, makeRelationshipsRepository(overrides))),
	);

const baseInput = {
	userId,
	sourceEntityId,
	targetEntityId,
	relationshipSchemaId,
	scope: "user" as const,
	onConflict: "replaceProperties" as const,
};

const captureSave = () => {
	let savedInput: unknown;
	const layer = makeServiceLayer({
		saveRelationship: (input) =>
			Effect.sync(() => {
				savedInput = input;
				return createOutcome;
			}),
	});
	return { layer, read: () => savedInput };
};

it.effect("save (schema mode) fails with bad request when properties violate the schema", () => {
	const layer = makeServiceLayer();

	return Effect.gen(function* () {
		const service = yield* RelationshipsService;
		const exit = yield* Effect.exit(
			service.save({
				...baseInput,
				validation: "schema",
				properties: { status: "deleted" },
				propertiesSchema: {
					fields: {
						status: {
							label: "Status",
							type: "enum" as const,
							description: "Status",
							options: ["active", "inactive"],
						},
					},
				},
			}),
		);
		expect(Exit.isFailure(exit)).toBe(true);
		if (Exit.isFailure(exit)) {
			const failure = Cause.failureOption(exit.cause);
			expect(failure._tag).toBe("Some");
			if (failure._tag === "Some") {
				expect(failure.value).toBeInstanceOf(BadRequest);
			}
		}
	}).pipe(Effect.provide(layer));
});

it.effect(
	"save (schema mode) passes parsed properties to the repository and returns the outcome",
	() => {
		const { layer, read } = captureSave();

		return Effect.gen(function* () {
			const service = yield* RelationshipsService;
			const result = yield* service.save({
				...baseInput,
				validation: "schema",
				properties: { note: "hi" },
				propertiesSchema: {
					fields: { note: { label: "Note", type: "string" as const, description: "Note" } },
				},
			});
			expect(result).toEqual(createOutcome);
			expect(read()).toEqual({
				userId,
				scope: "user",
				sourceEntityId,
				targetEntityId,
				relationshipSchemaId,
				properties: { note: "hi" },
				onConflict: "replaceProperties",
			});
		}).pipe(Effect.provide(layer));
	},
);

it.effect("save (schema mode) validates and persists a global relationship", () => {
	const { layer, read } = captureSave();

	return Effect.gen(function* () {
		const service = yield* RelationshipsService;
		const result = yield* service.save({
			validation: "schema",
			sourceEntityId,
			targetEntityId,
			properties: {},
			scope: "global",
			relationshipSchemaId,
			onConflict: "replaceProperties",
			propertiesSchema: { fields: {} },
		});
		expect(result).toEqual(createOutcome);
		expect(read()).toEqual({
			properties: {},
			sourceEntityId,
			targetEntityId,
			scope: "global",
			relationshipSchemaId,
			onConflict: "replaceProperties",
		});
	}).pipe(Effect.provide(layer));
});

it.effect("save (prevalidated mode) persists properties verbatim without applying a schema", () => {
	const { layer, read } = captureSave();

	return Effect.gen(function* () {
		const service = yield* RelationshipsService;
		const result = yield* service.save({
			...baseInput,
			validation: "prevalidated",
			properties: { note: "member" },
		});
		expect(result).toEqual(createOutcome);
		expect(read()).toEqual({
			userId,
			scope: "user",
			sourceEntityId,
			targetEntityId,
			relationshipSchemaId,
			properties: { note: "member" },
			onConflict: "replaceProperties",
		});
	}).pipe(Effect.provide(layer));
});

it.effect("syncGlobal delegates to the repository and returns the sync outcome", () => {
	const syncOutcome = { afterCount: 1, beforeCount: 0, mutations: [] };
	let syncedInput: unknown;
	const layer = makeServiceLayer({
		syncGlobalRelationships: (input) =>
			Effect.sync(() => {
				syncedInput = input;
				return syncOutcome;
			}),
	});

	return Effect.gen(function* () {
		const service = yield* RelationshipsService;
		const result = yield* service.syncGlobal({
			type: "self",
			onConflict: "replaceProperties",
			synchronization: "authoritative",
			relationshipSchemaId,
			entries: [{ entityId: sourceEntityId, properties: { rank: 1 } }],
		});
		expect(result).toEqual(syncOutcome);
		expect(syncedInput).toMatchObject({ type: "self", relationshipSchemaId });
	}).pipe(Effect.provide(layer));
});
