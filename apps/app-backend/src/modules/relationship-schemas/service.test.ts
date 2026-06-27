import { expect, it } from "@effect/vitest";
import type { CurrentUserValue } from "@ryot/contract/auth-middleware";
import { BadRequest, Conflict, NotFound } from "@ryot/contract/errors";
import { EntitySchemaId, RelationshipSchemaId, UserId } from "@ryot/contract/schema/brands";
import { Effect, Exit, Layer } from "effect";

import type { MockOverrides } from "#lib/test-utils/effect";
import { dbRunnerLayer } from "#lib/test-utils/effect";

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

const user = {
	name: "Test User",
	email: "user@example.com",
	id: UserId.make("user-id"),
	preferences: { isNsfw: false, language: null, disableIntegrations: false },
} satisfies CurrentUserValue;

const mockRelationshipSchemasRepository = Layer.mock(RelationshipSchemasRepository);

const makeRepository = (overrides: MockOverrides<typeof mockRelationshipSchemasRepository> = {}) =>
	mockRelationshipSchemasRepository({
		...overrides,
		_tag: "RelationshipSchemasRepository",
	});

const makeServiceLayer = (repository: ReturnType<typeof makeRepository>) =>
	RelationshipSchemasService.Default.pipe(Layer.provide(Layer.mergeAll(dbRunnerLayer, repository)));

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

it.effect("lists relationship schemas for user", () => {
	const layer = makeServiceLayer(makeRepository({ listByUser: () => Effect.succeed([scope]) }));

	return Effect.gen(function* () {
		const service = yield* RelationshipSchemasService;
		const found = yield* service.list(user, { slugs: ["in-library"] });
		expect(found).toEqual([scope]);
	}).pipe(Effect.provide(layer));
});

it.effect("returns not found when source entity schema is inaccessible during list", () => {
	const layer = makeServiceLayer(
		makeRepository({ getEntitySchemaScopeById: () => Effect.succeed(null) }),
	);

	return Effect.gen(function* () {
		const service = yield* RelationshipSchemasService;
		const exit = yield* Effect.exit(
			service.list(user, { sourceEntitySchemaId: EntitySchemaId.make("missing") }),
		);
		expect(exit).toEqual(Exit.fail(new NotFound({ message: "Entity schema not found" })));
	}).pipe(Effect.provide(layer));
});

it.effect("creates relationship schema with normalized slug", () => {
	let createdSlug = "";
	const layer = makeServiceLayer(
		makeRepository({
			findBySlugForUser: () => Effect.succeed(null),
			createRelationshipSchema: (input) =>
				Effect.sync(() => {
					createdSlug = input.slug;
					return {
						...scope,
						name: input.name,
						slug: input.slug,
						isBuiltin: false,
						propertiesSchema: input.propertiesSchema,
						sourceEntitySchemaId: input.sourceEntitySchemaId,
						targetEntitySchemaId: input.targetEntitySchemaId,
					};
				}),
		}),
	);

	return Effect.gen(function* () {
		const service = yield* RelationshipSchemasService;
		const created = yield* service.create(user, {
			name: " My Relationship ",
			propertiesSchema: { fields: {} },
		});

		expect(createdSlug).toBe("my-relationship");
		expect(created.slug).toBe("my-relationship");
	}).pipe(Effect.provide(layer));
});

it.effect("returns conflict when relationship schema slug already exists", () => {
	const layer = makeServiceLayer(
		makeRepository({
			findBySlugForUser: () => Effect.succeed({ id: RelationshipSchemaId.make("existing-id") }),
		}),
	);

	return Effect.gen(function* () {
		const service = yield* RelationshipSchemasService;
		const exit = yield* Effect.exit(
			service.create(user, {
				name: "Duplicate Relationship",
				slug: "duplicate-relationship",
				propertiesSchema: { fields: {} },
			}),
		);
		expect(exit).toEqual(
			Exit.fail(new Conflict({ message: "Relationship schema slug already exists" })),
		);
	}).pipe(Effect.provide(layer));
});

it.effect("returns bad request for reserved relationship schema slug", () => {
	const layer = makeServiceLayer(makeRepository());

	return Effect.gen(function* () {
		const service = yield* RelationshipSchemasService;
		const exit = yield* Effect.exit(
			service.create(user, {
				name: "Member Of",
				slug: "member-of",
				propertiesSchema: { fields: {} },
			}),
		);
		expect(exit).toEqual(
			Exit.fail(
				new BadRequest({
					message: 'Relationship schema slug "member-of" is reserved for built-in schemas',
				}),
			),
		);
	}).pipe(Effect.provide(layer));
});
