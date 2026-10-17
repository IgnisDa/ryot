import { expect, layer } from "@effect/vitest";
import { definitionKey, definitionOwner } from "@ryot-app/contract/modules/plugins/references";
import { RelationshipSchemaSlug, SignalSchemaSlug } from "@ryot-app/contract/schema/brands";
import { assertExitFails } from "@ryot-app/testing/effect-assertions";
import { Context, Effect, Layer, Ref } from "effect";

import { RelationshipSchemaReader } from "#modules/definitions/relationship-schemas";
import { DefinitionRepository } from "#modules/definitions/repository";
import type { SignalSchemaDefinition } from "#modules/definitions/snapshot";
import type { MockOverrides } from "#testing/effect";
import { databaseLayer } from "#testing/effect";

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
	pluginId: null,
	id: SignalSchemaSlug.make("signal-schema-1"),
} satisfies SignalSchemaScope;

const relationshipScope = {
	pluginId: null,
	isBuiltin: true,
	slug: "example-monitoring",
	name: "Example monitoring",
	sourceEntitySchemaSlug: null,
	targetEntitySchemaSlug: null,
	propertiesSchema: { fields: {} },
	id: RelationshipSchemaSlug.make("relationship-schema-1"),
};

const mockSignalSchemasRepository = Layer.mock(SignalSchemasRepository);
const mockRelationshipSchemaReader = Layer.mock(RelationshipSchemaReader);

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

const makeRelationshipSchemaReader = (
	overrides: MockOverrides<typeof mockRelationshipSchemaReader> = {},
) => mockRelationshipSchemaReader({ ...overrides });

const makeLayer = (
	signalSchemasRepository: ReturnType<typeof makeSignalSchemasRepository>,
	relationshipSchemasRepository = makeRelationshipSchemaReader(),
) =>
	SignalSchemasService.layer.pipe(
		Layer.provideMerge(Layer.mergeAll(signalSchemasRepository, relationshipSchemasRepository)),
		Layer.provideMerge(databaseLayer),
	);

layer(
	makeLayer(
		makeSignalSchemasRepository({
			insertBuiltin: () => Effect.succeed(scope),
			findKernelBySlug: () => Effect.succeed(null),
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

const sameSlugDefinitions = [
	{
		pluginId: null,
		name: "Kernel signal",
		slug: "fixture.signal",
		catalogState: "active",
		propertiesSchema: { fields: {} },
		audiencePolicy: { kind: "actor" },
		notificationHookSlug: "kernel-notification",
	},
	{
		pluginId: "plugin-id",
		name: "Plugin signal",
		slug: "fixture.signal",
		catalogState: "active",
		propertiesSchema: { fields: {} },
		audiencePolicy: { kind: "actor" },
		notificationHookSlug: "plugin-notification",
	},
] as const satisfies ReadonlyArray<SignalSchemaDefinition>;

const signalDefinitionLayer = Layer.mock(DefinitionRepository)({
	findGlobalSignalSchema: (reference) =>
		Effect.succeed(
			sameSlugDefinitions.find(
				(candidate) =>
					definitionKey("signal", definitionOwner(candidate.pluginId), candidate.slug) ===
					definitionKey("signal", reference.owner, reference.slug),
			) ?? null,
		),
});

layer(SignalSchemasRepository.layer.pipe(Layer.provide(signalDefinitionLayer)))((test) => {
	test.effect("looks up the kernel signal when a plugin defines the same slug", () =>
		Effect.gen(function* () {
			const repository = yield* SignalSchemasRepository;

			expect(yield* repository.findKernelBySlug("fixture.signal")).toMatchObject({
				pluginId: null,
				name: "Kernel signal",
				slug: "fixture.signal",
			});
			expect(
				yield* repository.findGlobalByReference({
					owner: definitionOwner("plugin-id"),
					slug: SignalSchemaSlug.make("fixture.signal"),
				}),
			).toMatchObject({ pluginId: "plugin-id", name: "Plugin signal", slug: "fixture.signal" });
		}),
	);
});

layer(
	makeLayer(
		makeSignalSchemasRepository({
			findKernelBySlug: () => Effect.succeed(scope),
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
			findKernelBySlug: () =>
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
			findKernelBySlug: () => Effect.succeed({ ...scope, propertiesSchema: { fields: {} } }),
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
			findKernelBySlug: () =>
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
		makeRelationshipSchemaReader({ findKernelBySlug: () => Effect.succeed(null) }),
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
