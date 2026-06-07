import { expect, it } from "@effect/vitest";
import { Effect, Exit, Layer } from "effect";

import { NotFound } from "#lib/errors";
import { EntitySchemaId, RelationshipSchemaId, UserId } from "#lib/schema/brands";
import { dbRunnerLayer, makeMock } from "#lib/test-support/effect";

import { RelationshipSchemasRepository } from "./repository";
import { RelationshipSchemasService } from "./service";

const scope = {
	id: RelationshipSchemaId.make("rs-id"),
	isBuiltin: true,
	slug: "in-library",
	name: "In Library",
	sourceEntitySchemaId: null,
	propertiesSchema: { fields: {} },
	targetEntitySchemaId: EntitySchemaId.make("library-id"),
};

const makeRepository = (overrides: Partial<RelationshipSchemasRepository> = {}) =>
	makeMock<RelationshipSchemasRepository>(
		{
			_tag: "RelationshipSchemasRepository" as const,
			findById: () => Effect.die("unused"),
			findBuiltinBySlug: () => Effect.die("unused"),
		},
		overrides,
	);

const makeServiceLayer = (repository: RelationshipSchemasRepository) =>
	RelationshipSchemasService.Default.pipe(
		Layer.provide(
			Layer.mergeAll(dbRunnerLayer, Layer.succeed(RelationshipSchemasRepository, repository)),
		),
	);

it.effect("returns builtin relationship schema by slug", () => {
	const layer = makeServiceLayer(
		makeRepository({
			findBuiltinBySlug: () => Effect.succeed(scope),
		}),
	);

	return Effect.gen(function* () {
		const service = yield* RelationshipSchemasService;
		const found = yield* service.findBuiltinBySlug("in-library");
		expect(found).toEqual(scope);
	}).pipe(Effect.provide(layer));
});

it.effect("returns not found when builtin slug does not exist", () => {
	const layer = makeServiceLayer(
		makeRepository({
			findBuiltinBySlug: () => Effect.succeed(null),
		}),
	);

	return Effect.gen(function* () {
		const service = yield* RelationshipSchemasService;
		const exit = yield* Effect.exit(service.findBuiltinBySlug("missing"));
		expect(exit).toEqual(Exit.fail(new NotFound({ message: "Relationship schema not found" })));
	}).pipe(Effect.provide(layer));
});

it.effect("returns relationship schema by id for user scope", () => {
	const layer = makeServiceLayer(
		makeRepository({
			findById: () => Effect.succeed(scope),
		}),
	);

	return Effect.gen(function* () {
		const service = yield* RelationshipSchemasService;
		const found = yield* service.findById(
			RelationshipSchemaId.make("rs-id"),
			UserId.make("user-id"),
		);
		expect(found).toEqual(scope);
	}).pipe(Effect.provide(layer));
});

it.effect("returns not found when id does not exist or is inaccessible", () => {
	const layer = makeServiceLayer(
		makeRepository({
			findById: () => Effect.succeed(null),
		}),
	);

	return Effect.gen(function* () {
		const service = yield* RelationshipSchemasService;
		const exit = yield* Effect.exit(
			service.findById(RelationshipSchemaId.make("missing"), UserId.make("user-id")),
		);
		expect(exit).toEqual(Exit.fail(new NotFound({ message: "Relationship schema not found" })));
	}).pipe(Effect.provide(layer));
});

it.effect("finds builtin schema by id with null userId", () => {
	const layer = makeServiceLayer(
		makeRepository({
			findById: () => Effect.succeed(scope),
		}),
	);

	return Effect.gen(function* () {
		const service = yield* RelationshipSchemasService;
		const found = yield* service.findById(RelationshipSchemaId.make("rs-id"), null);
		expect(found).toEqual(scope);
	}).pipe(Effect.provide(layer));
});
