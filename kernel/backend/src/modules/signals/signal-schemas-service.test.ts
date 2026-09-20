import { expect, layer } from "@effect/vitest";
import { RelationshipSchemaSlug, SignalSchemaSlug } from "@ryot-app/contract/schema/brands";
import { Context, Effect, Layer, Ref } from "effect";

import { assertExitFails } from "#lib/test-utils/assertions";
import type { MockOverrides } from "#lib/test-utils/effect";
import { databaseLayer } from "#lib/test-utils/effect";
import { RelationshipSchemasRepository } from "#modules/relationship-schemas/repository";

import { SignalSchemaContractDrift, SignalSchemasService } from "./service";
import {
	SignalSchemasRepository,
	type BuiltinSignalSchemaInput,
	type SignalSchemaScope,
} from "./signal-schemas-repository";

const definition = {
	slug: "review.created",
	name: "Review created",
	catalogState: "active",
	audiencePolicy: { kind: "actor" },
	propertiesSchema: {
		unknownKeys: "strict",
		fields: {
			entityName: {
				type: "string",
				label: "Entity name",
				validation: { required: true },
				description: "Reviewed entity name",
			},
		},
	},
} as const satisfies BuiltinSignalSchemaInput;

const scope = {
	...definition,
	userId: null,
	id: SignalSchemaSlug.make("signal-schema-1"),
} satisfies SignalSchemaScope;

const relationshipScope = {
	isBuiltin: true,
	slug: "example-monitoring",
	name: "Example monitoring",
	sourceEntitySchemaSlug: null,
	targetEntitySchemaSlug: null,
	propertiesSchema: { fields: {} },
	id: RelationshipSchemaSlug.make("relationship-schema-1"),
};

const mockSignalSchemasRepository = Layer.mock(SignalSchemasRepository);
const mockRelationshipSchemasRepository = Layer.mock(RelationshipSchemasRepository);

type DisplayUpdate = Parameters<SignalSchemasRepository["Service"]["updateBuiltinDisplay"]>[0];

class SignalSchemaWrites extends Context.Service<
	SignalSchemaWrites,
	{
		readonly inserted: Effect.Effect<ReadonlyArray<BuiltinSignalSchemaInput>>;
		readonly displayUpdates: Effect.Effect<ReadonlyArray<DisplayUpdate>>;
	}
>()("test/SignalSchemaWrites") {}

const makeSignalSchemasRepository = (
	overrides: MockOverrides<typeof mockSignalSchemasRepository> = {},
) =>
	Layer.unwrap(
		Effect.gen(function* () {
			const inserted = yield* Ref.make<ReadonlyArray<BuiltinSignalSchemaInput>>([]);
			const displayUpdates = yield* Ref.make<ReadonlyArray<DisplayUpdate>>([]);
			return Layer.merge(
				mockSignalSchemasRepository({
					...overrides,
					insertBuiltin: (input) =>
						Ref.update(inserted, (all) => [...all, input]).pipe(
							Effect.andThen(overrides.insertBuiltin?.(input) ?? Effect.die("unexpected insert")),
						),
					updateBuiltinDisplay: (input) =>
						Ref.update(displayUpdates, (all) => [...all, input]).pipe(
							Effect.andThen(
								overrides.updateBuiltinDisplay?.(input) ?? Effect.die("unexpected update"),
							),
						),
				}),
				Layer.succeed(SignalSchemaWrites, {
					inserted: Ref.get(inserted),
					displayUpdates: Ref.get(displayUpdates),
				}),
			);
		}),
	);

const makeRelationshipSchemasRepository = (
	overrides: MockOverrides<typeof mockRelationshipSchemasRepository> = {},
) => mockRelationshipSchemasRepository({ ...overrides });

const makeLayer = (
	signalSchemasRepository: ReturnType<typeof makeSignalSchemasRepository>,
	relationshipSchemasRepository = makeRelationshipSchemasRepository(),
) =>
	SignalSchemasService.layer.pipe(
		Layer.provideMerge(Layer.mergeAll(signalSchemasRepository, relationshipSchemasRepository)),
		Layer.provideMerge(databaseLayer),
	);

layer(
	makeLayer(
		makeSignalSchemasRepository({
			insertBuiltin: () => Effect.succeed(scope),
			findGlobalBySlug: () => Effect.succeed(null),
		}),
	),
)((test) => {
	test.effect("inserts a missing built-in signal schema", () =>
		Effect.gen(function* () {
			const service = yield* SignalSchemasService;
			const result = yield* service.ensureBuiltin(definition);
			expect(result).toEqual(scope);
			expect(yield* (yield* SignalSchemaWrites).inserted).toEqual([definition]);
		}),
	);
});

layer(
	makeLayer(
		makeSignalSchemasRepository({
			findGlobalBySlug: () => Effect.succeed(scope),
			insertBuiltin: () => Effect.die("unexpected insert"),
			updateBuiltinDisplay: () => Effect.die("unexpected update"),
		}),
	),
)((test) => {
	test.effect("leaves an unchanged built-in signal schema untouched", () =>
		Effect.gen(function* () {
			const service = yield* SignalSchemasService;
			expect(yield* service.ensureBuiltin(definition)).toEqual(scope);
		}),
	);
});

layer(
	makeLayer(
		makeSignalSchemasRepository({
			updateBuiltinDisplay: () => Effect.succeed(scope),
			findGlobalBySlug: () =>
				Effect.succeed({ ...scope, name: "Old name", catalogState: "hidden" as const }),
		}),
	),
)((test) => {
	test.effect("updates only built-in display fields", () =>
		Effect.gen(function* () {
			const service = yield* SignalSchemasService;
			expect(yield* service.ensureBuiltin(definition)).toEqual(scope);
			expect(yield* (yield* SignalSchemaWrites).displayUpdates).toEqual([
				{ id: scope.id, name: definition.name, catalogState: definition.catalogState },
			]);
		}),
	);
});

layer(
	makeLayer(
		makeSignalSchemasRepository({
			findGlobalBySlug: () => Effect.succeed({ ...scope, propertiesSchema: { fields: {} } }),
		}),
	),
)((test) => {
	test.effect("rejects built-in property contract drift", () =>
		Effect.gen(function* () {
			const service = yield* SignalSchemasService;
			const exit = yield* Effect.exit(service.ensureBuiltin(definition));
			assertExitFails(
				exit,
				new SignalSchemaContractDrift({
					message: "Built-in signal schema contract drifted: review.created",
				}),
			);
		}),
	);
});

layer(
	makeLayer(
		makeSignalSchemasRepository({
			findGlobalBySlug: () =>
				Effect.succeed({
					...scope,
					audiencePolicy: {
						kind: "related_users",
						subjectSide: "source",
						relationshipSchemaSlug: relationshipScope.id,
					},
				}),
		}),
	),
)((test) => {
	test.effect("rejects built-in audience contract drift", () =>
		Effect.gen(function* () {
			const service = yield* SignalSchemasService;
			const exit = yield* Effect.exit(service.ensureBuiltin(definition));
			assertExitFails(
				exit,
				new SignalSchemaContractDrift({
					message: "Built-in signal schema contract drifted: review.created",
				}),
			);
		}),
	);
});

layer(
	makeLayer(
		makeSignalSchemasRepository(),
		makeRelationshipSchemasRepository({ findById: () => Effect.succeed(null) }),
	),
)((test) => {
	test.effect("rejects an invalid related-users schema contract", () =>
		Effect.gen(function* () {
			const relatedDefinition = {
				...definition,
				audiencePolicy: {
					kind: "related_users",
					subjectSide: "source",
					relationshipSchemaSlug: relationshipScope.id,
				},
			} as const satisfies BuiltinSignalSchemaInput;
			const service = yield* SignalSchemasService;
			const exit = yield* Effect.exit(service.ensureBuiltin(relatedDefinition));
			assertExitFails(
				exit,
				new SignalSchemaContractDrift({
					message:
						"Built-in signal schema review.created references an invalid relationship schema",
				}),
			);
		}),
	);
});
