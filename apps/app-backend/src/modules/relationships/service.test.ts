import { expect, it } from "@effect/vitest";
import { BadRequest, NotFound } from "@ryot/contract/errors";
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

const relationship = {
	properties: {},
	sourceEntityId,
	targetEntityId,
	wasInserted: true,
	relationshipSchemaId,
	id: RelationshipId.make("rel-id"),
	createdAt: "2026-06-22T00:00:00.000Z",
};

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
	properties: {},
	sourceEntityId,
	targetEntityId,
	relationshipSchemaId,
	scope: "user" as const,
	propertiesSchema: { fields: {} } as const,
};

it.effect("returns bad request when create properties violate the relationship schema", () => {
	const layer = makeServiceLayer();

	return Effect.gen(function* () {
		const service = yield* RelationshipsService;
		const exit = yield* Effect.exit(
			service.create({
				...baseInput,
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

it.effect("creates a validated user relationship", () => {
	let createdInput: unknown;
	const layer = makeServiceLayer({
		createRelationship: (input) =>
			Effect.sync(() => {
				createdInput = input;
				return relationship;
			}),
	});

	return Effect.gen(function* () {
		const service = yield* RelationshipsService;
		const result = yield* service.create(baseInput);
		expect(result).toEqual(relationship);
		expect(createdInput).toEqual({
			userId,
			properties: {},
			sourceEntityId,
			targetEntityId,
			relationshipSchemaId,
			scope: "user",
		});
	}).pipe(Effect.provide(layer));
});

it.effect("updates a validated global relationship", () => {
	let updatedInput: unknown;
	const updated = { ...relationship, wasInserted: false };
	const layer = makeServiceLayer({
		updateRelationship: (input) =>
			Effect.sync(() => {
				updatedInput = input;
				return updated;
			}),
	});

	return Effect.gen(function* () {
		const service = yield* RelationshipsService;
		const result = yield* service.update({
			properties: {},
			sourceEntityId,
			targetEntityId,
			scope: "global",
			relationshipSchemaId,
			propertiesSchema: { fields: {} },
		});
		expect(result).toEqual(updated);
		expect(updatedInput).toEqual({
			properties: {},
			sourceEntityId,
			targetEntityId,
			scope: "global",
			relationshipSchemaId,
		});
	}).pipe(Effect.provide(layer));
});

it.effect("returns not found when updating a missing relationship", () => {
	const layer = makeServiceLayer({ updateRelationship: () => Effect.succeed(null) });

	return Effect.gen(function* () {
		const service = yield* RelationshipsService;
		const exit = yield* Effect.exit(service.update({ ...baseInput }));
		expect(exit).toEqual(Exit.fail(new NotFound({ message: "Relationship not found" })));
	}).pipe(Effect.provide(layer));
});

it.effect("deletes one relationship through the repository", () => {
	let deletedInput: unknown;
	const layer = makeServiceLayer({
		deleteRelationship: (input) =>
			Effect.sync(() => {
				deletedInput = input;
				return relationship;
			}),
	});

	return Effect.gen(function* () {
		const service = yield* RelationshipsService;
		const result = yield* service.delete({
			userId,
			scope: "user",
			sourceEntityId,
			targetEntityId,
			relationshipSchemaId,
		});
		expect(result).toEqual(relationship);
		expect(deletedInput).toEqual({
			userId,
			scope: "user",
			sourceEntityId,
			targetEntityId,
			relationshipSchemaId,
		});
	}).pipe(Effect.provide(layer));
});
