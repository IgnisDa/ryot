import { expect, it } from "@effect/vitest";
import { Effect, Exit, Layer } from "effect";

import { CurrentDb, DbRunner } from "../../lib/db";
import { NotFound } from "../../lib/errors";
import { RelationshipSchemasRepository } from "./repository";
import { RelationshipSchemasService } from "./service";

const dbRunnerLayer = Layer.succeed(
	DbRunner,
	<A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, Exclude<R, CurrentDb>> =>
		Effect.provideService(effect, CurrentDb, Object.create(null)),
);

const scope = {
	id: "rs-id",
	isBuiltin: true,
	slug: "in-library",
	name: "In Library",
	sourceEntitySchemaId: null,
	propertiesSchema: { fields: {} },
	targetEntitySchemaId: "library-id",
};

it.effect("returns builtin relationship schema by slug", () => {
	const layer = RelationshipSchemasService.Default.pipe(
		Layer.provide(
			Layer.mergeAll(
				dbRunnerLayer,
				Layer.mock(RelationshipSchemasRepository, {
					_tag: "RelationshipSchemasRepository" as const,
					findById: () => Effect.die("unused"),
					findBuiltinBySlug: () => Effect.succeed(scope),
				}),
			),
		),
	);

	return Effect.gen(function* () {
		const service = yield* RelationshipSchemasService;
		const found = yield* service.getBuiltinBySlug("in-library");
		expect(found).toEqual(scope);
	}).pipe(Effect.provide(layer));
});

it.effect("returns not found when builtin slug does not exist", () => {
	const layer = RelationshipSchemasService.Default.pipe(
		Layer.provide(
			Layer.mergeAll(
				dbRunnerLayer,
				Layer.mock(RelationshipSchemasRepository, {
					_tag: "RelationshipSchemasRepository" as const,
					findById: () => Effect.die("unused"),
					findBuiltinBySlug: () => Effect.succeed(null),
				}),
			),
		),
	);

	return Effect.gen(function* () {
		const service = yield* RelationshipSchemasService;
		const exit = yield* Effect.exit(service.getBuiltinBySlug("missing"));
		expect(exit).toEqual(Exit.fail(new NotFound({ message: "Relationship schema not found" })));
	}).pipe(Effect.provide(layer));
});

it.effect("returns relationship schema by id for user scope", () => {
	const layer = RelationshipSchemasService.Default.pipe(
		Layer.provide(
			Layer.mergeAll(
				dbRunnerLayer,
				Layer.mock(RelationshipSchemasRepository, {
					_tag: "RelationshipSchemasRepository" as const,
					findById: () => Effect.succeed(scope),
					findBuiltinBySlug: () => Effect.die("unused"),
				}),
			),
		),
	);

	return Effect.gen(function* () {
		const service = yield* RelationshipSchemasService;
		const found = yield* service.getById("rs-id", "user-id");
		expect(found).toEqual(scope);
	}).pipe(Effect.provide(layer));
});

it.effect("returns not found when id does not exist or is inaccessible", () => {
	const layer = RelationshipSchemasService.Default.pipe(
		Layer.provide(
			Layer.mergeAll(
				dbRunnerLayer,
				Layer.mock(RelationshipSchemasRepository, {
					_tag: "RelationshipSchemasRepository" as const,
					findById: () => Effect.succeed(null),
					findBuiltinBySlug: () => Effect.die("unused"),
				}),
			),
		),
	);

	return Effect.gen(function* () {
		const service = yield* RelationshipSchemasService;
		const exit = yield* Effect.exit(service.getById("missing", "user-id"));
		expect(exit).toEqual(Exit.fail(new NotFound({ message: "Relationship schema not found" })));
	}).pipe(Effect.provide(layer));
});

it.effect("finds builtin schema by id with null userId", () => {
	const layer = RelationshipSchemasService.Default.pipe(
		Layer.provide(
			Layer.mergeAll(
				dbRunnerLayer,
				Layer.mock(RelationshipSchemasRepository, {
					_tag: "RelationshipSchemasRepository" as const,
					findById: () => Effect.succeed(scope),
					findBuiltinBySlug: () => Effect.die("unused"),
				}),
			),
		),
	);

	return Effect.gen(function* () {
		const service = yield* RelationshipSchemasService;
		const found = yield* service.getById("rs-id", null);
		expect(found).toEqual(scope);
	}).pipe(Effect.provide(layer));
});
