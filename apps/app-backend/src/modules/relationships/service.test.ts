import { expect, it } from "@effect/vitest";
import { Cause, Effect, Exit, Layer } from "effect";

import { BadRequest } from "#lib/errors";
import { EntityId, RelationshipId, RelationshipSchemaId, UserId } from "#lib/schema/brands";
import { dbRunnerLayer, makeMock } from "#lib/test-support/effect";

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

const makeRelationshipsRepository = (overrides: Partial<RelationshipsRepository> = {}) =>
	makeMock<RelationshipsRepository>(
		{
			_tag: "RelationshipsRepository" as const,
			saveRelationship: () => Effect.die("unused"),
			deleteUserRelationship: () => Effect.die("unused"),
			findRelationshipProperties: () => Effect.die("unused"),
			deleteUserRelationshipsForEntity: () => Effect.die("unused"),
			moveUserRelationshipsBetweenEntities: () => Effect.die("unused"),
		},
		overrides,
	);

const makeServiceLayer = (overrides: Partial<RelationshipsRepository> = {}) =>
	RelationshipsService.Default.pipe(
		Layer.provide(
			Layer.mergeAll(
				dbRunnerLayer,
				Layer.succeed(RelationshipsRepository, makeRelationshipsRepository(overrides)),
			),
		),
	);

const baseInput = {
	userId,
	properties: {},
	sourceEntityId,
	targetEntityId,
	relationshipSchemaId,
	scope: "user" as const,
	onConflict: "replaceProperties" as const,
	propertiesSchema: { fields: {} } as const,
};

it.effect("returns bad request when properties violate the relationship schema", () => {
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

it.effect("creates relationship and returns saved relationship", () => {
	const layer = makeServiceLayer({ saveRelationship: () => Effect.succeed(savedRelationship) });

	return Effect.gen(function* () {
		const service = yield* RelationshipsService;
		const result = yield* service.create(baseInput);
		expect(result).toEqual(savedRelationship);
	}).pipe(Effect.provide(layer));
});

it.effect("creates global-scoped relationship", () => {
	const layer = makeServiceLayer({ saveRelationship: () => Effect.succeed(savedRelationship) });

	return Effect.gen(function* () {
		const service = yield* RelationshipsService;
		const result = yield* service.create({
			sourceEntityId,
			targetEntityId,
			properties: {},
			scope: "global",
			relationshipSchemaId,
			onConflict: "replaceProperties",
			propertiesSchema: { fields: {} },
		});
		expect(result).toEqual(savedRelationship);
	}).pipe(Effect.provide(layer));
});
