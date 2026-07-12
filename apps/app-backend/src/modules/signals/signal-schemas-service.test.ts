import { expect, it } from "@effect/vitest";
import { RelationshipSchemaSlug, SignalSchemaSlug } from "@ryot/contract/schema/brands";
import { Effect, Layer } from "effect";

import { assertExitFails } from "#lib/test-utils/assertions";
import type { MockOverrides } from "#lib/test-utils/effect";
import { dbRunnerLayer } from "#lib/test-utils/effect";
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
	slug: "media-monitoring",
	name: "Media monitoring",
	sourceEntitySchemaSlug: null,
	targetEntitySchemaSlug: null,
	propertiesSchema: { fields: {} },
	id: RelationshipSchemaSlug.make("relationship-schema-1"),
};

const mockSignalSchemasRepository = Layer.mock(SignalSchemasRepository);
const mockRelationshipSchemasRepository = Layer.mock(RelationshipSchemasRepository);

const makeSignalSchemasRepository = (
	overrides: MockOverrides<typeof mockSignalSchemasRepository> = {},
) => mockSignalSchemasRepository({ ...overrides });

const makeRelationshipSchemasRepository = (
	overrides: MockOverrides<typeof mockRelationshipSchemasRepository> = {},
) => mockRelationshipSchemasRepository({ ...overrides });

const makeLayer = (
	signalSchemasRepository: ReturnType<typeof makeSignalSchemasRepository>,
	relationshipSchemasRepository = makeRelationshipSchemasRepository(),
) =>
	SignalSchemasService.layer.pipe(
		Layer.provide(
			Layer.mergeAll(dbRunnerLayer, signalSchemasRepository, relationshipSchemasRepository),
		),
	);

it.effect("inserts a missing built-in signal schema", () => {
	let inserted: BuiltinSignalSchemaInput | undefined;
	const layer = makeLayer(
		makeSignalSchemasRepository({
			findGlobalBySlug: () => Effect.succeed(null),
			insertBuiltin: (input) => {
				inserted = input;
				return Effect.succeed(scope);
			},
		}),
	);

	return Effect.gen(function* () {
		const service = yield* SignalSchemasService;
		const result = yield* service.ensureBuiltin(definition);
		expect(result).toEqual(scope);
		expect(inserted).toEqual(definition);
	}).pipe(Effect.provide(layer));
});

it.effect("leaves an unchanged built-in signal schema untouched", () => {
	const layer = makeLayer(
		makeSignalSchemasRepository({
			findGlobalBySlug: () => Effect.succeed(scope),
			insertBuiltin: () => Effect.die("unexpected insert"),
			updateBuiltinDisplay: () => Effect.die("unexpected update"),
		}),
	);

	return Effect.gen(function* () {
		const service = yield* SignalSchemasService;
		expect(yield* service.ensureBuiltin(definition)).toEqual(scope);
	}).pipe(Effect.provide(layer));
});

it.effect("updates only built-in display fields", () => {
	const existing = { ...scope, name: "Old name", catalogState: "hidden" as const };
	let update: { name: string; id: SignalSchemaSlug; catalogState: "active" | "hidden" } | undefined;
	const layer = makeLayer(
		makeSignalSchemasRepository({
			findGlobalBySlug: () => Effect.succeed(existing),
			updateBuiltinDisplay: (input) => {
				update = input;
				return Effect.succeed(scope);
			},
		}),
	);

	return Effect.gen(function* () {
		const service = yield* SignalSchemasService;
		expect(yield* service.ensureBuiltin(definition)).toEqual(scope);
		expect(update).toEqual({
			name: definition.name,
			id: scope.id,
			catalogState: definition.catalogState,
		});
	}).pipe(Effect.provide(layer));
});

it.effect("rejects built-in property contract drift", () => {
	const layer = makeLayer(
		makeSignalSchemasRepository({
			findGlobalBySlug: () => Effect.succeed({ ...scope, propertiesSchema: { fields: {} } }),
		}),
	);

	return Effect.gen(function* () {
		const service = yield* SignalSchemasService;
		const exit = yield* Effect.exit(service.ensureBuiltin(definition));
		assertExitFails(
			exit,
			new SignalSchemaContractDrift({
				message: "Built-in signal schema contract drifted: review.created",
			}),
		);
	}).pipe(Effect.provide(layer));
});

it.effect("rejects built-in audience contract drift", () => {
	const layer = makeLayer(
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
	);

	return Effect.gen(function* () {
		const service = yield* SignalSchemasService;
		const exit = yield* Effect.exit(service.ensureBuiltin(definition));
		assertExitFails(
			exit,
			new SignalSchemaContractDrift({
				message: "Built-in signal schema contract drifted: review.created",
			}),
		);
	}).pipe(Effect.provide(layer));
});

it.effect("rejects an invalid related-users schema contract", () => {
	const relatedDefinition = {
		...definition,
		audiencePolicy: {
			kind: "related_users",
			subjectSide: "source",
			relationshipSchemaSlug: relationshipScope.id,
		},
	} as const satisfies BuiltinSignalSchemaInput;
	const layer = makeLayer(
		makeSignalSchemasRepository(),
		makeRelationshipSchemasRepository({ findById: () => Effect.succeed(null) }),
	);

	return Effect.gen(function* () {
		const service = yield* SignalSchemasService;
		const exit = yield* Effect.exit(service.ensureBuiltin(relatedDefinition));
		assertExitFails(
			exit,
			new SignalSchemaContractDrift({
				message: "Built-in signal schema review.created references an invalid relationship schema",
			}),
		);
	}).pipe(Effect.provide(layer));
});
