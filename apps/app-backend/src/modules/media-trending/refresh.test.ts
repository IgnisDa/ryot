import { expect, it } from "@effect/vitest";
import { WorkflowEngine, WorkflowInstance } from "@effect/workflow/WorkflowEngine";
import { SandboxRunError } from "@ryot/contract/errors";
import {
	EntityId,
	EntitySchemaId,
	RelationshipSchemaId,
	SandboxScriptId,
} from "@ryot/contract/schema/brands";
import { Effect, Layer } from "effect";

import type { MockOverrides } from "#lib/test-support/effect";
import { dbRunnerLayer, makeWorkflowActivityEngine } from "#lib/test-support/effect";
import { EntitiesService } from "#modules/entities/service";
import { RelationshipSchemasRepository } from "#modules/relationship-schemas/repository";
import { RelationshipsRepository } from "#modules/relationships/repository";
import { InfrequentCronWorkflow } from "#modules/scheduler/cron-workflow";

import {
	MediaTrendingWorkflowOperations,
	type MediaTrendingWorkflowOperationsValue,
} from "./operations-workflow";
import { runMediaTrendingRefresh } from "./refresh";
import { MediaTrendingRepository } from "./repository";
import type { TrendingProviderTarget } from "./schemas";

const movieProvider = {
	scriptSlug: "movie.tmdb",
	entitySchemaSlug: "movie",
	scriptId: SandboxScriptId.make("script-movie"),
	entitySchemaId: EntitySchemaId.make("schema-movie"),
} satisfies TrendingProviderTarget;

const showProvider = {
	scriptSlug: "show.tmdb",
	entitySchemaSlug: "show",
	scriptId: SandboxScriptId.make("script-show"),
	entitySchemaId: EntitySchemaId.make("schema-show"),
} satisfies TrendingProviderTarget;

const mediaTrendingSchema = {
	isBuiltin: true,
	slug: "media-trending",
	name: "Media Trending",
	sourceEntitySchemaId: null,
	targetEntitySchemaId: null,
	propertiesSchema: { fields: {} },
	id: RelationshipSchemaId.make("schema-media-trending"),
};

const listedEntity = (input: {
	id: string;
	name: string;
	externalId: string;
	entitySchemaId: EntitySchemaId;
	sandboxScriptId: SandboxScriptId;
}) => ({
	properties: {},
	populatedAt: null,
	name: input.name,
	externalId: input.externalId,
	id: EntityId.make(input.id),
	entitySchemaId: input.entitySchemaId,
	createdAt: "2026-01-01T00:00:00.000Z",
	updatedAt: "2026-01-01T00:00:00.000Z",
	sandboxScriptId: input.sandboxScriptId,
});

const mockEntitiesService = Layer.mock(EntitiesService);
const mockRelationshipsRepository = Layer.mock(RelationshipsRepository);
const mockMediaTrendingRepository = Layer.mock(MediaTrendingRepository);
const mockRelationshipSchemasRepository = Layer.mock(RelationshipSchemasRepository);

const makeEntitiesService = (overrides: MockOverrides<typeof mockEntitiesService> = {}) =>
	mockEntitiesService({
		save: () => Effect.die("unused"),
		...overrides,
		_tag: "EntitiesService",
	});

const makeRelationshipsRepository = (
	overrides: MockOverrides<typeof mockRelationshipsRepository> = {},
) =>
	mockRelationshipsRepository({
		syncGlobalRelationshipSelfEdges: () => Effect.void,
		...overrides,
		_tag: "RelationshipsRepository",
	});

const makeMediaTrendingRepository = (
	overrides: MockOverrides<typeof mockMediaTrendingRepository> = {},
) =>
	mockMediaTrendingRepository({
		listProviderTargets: () => Effect.succeed([]),
		...overrides,
		_tag: "MediaTrendingRepository",
	});

const makeRelationshipSchemasRepository = (
	overrides: MockOverrides<typeof mockRelationshipSchemasRepository> = {},
) =>
	mockRelationshipSchemasRepository({
		findBuiltinBySlug: () => Effect.succeed(mediaTrendingSchema),
		...overrides,
		_tag: "RelationshipSchemasRepository",
	});

type TestLayerOptions = {
	entitiesService?: Layer.Layer<EntitiesService>;
	mediaTrendingRepository?: Layer.Layer<MediaTrendingRepository>;
	relationshipsRepository?: Layer.Layer<RelationshipsRepository>;
	fetchTrending?: MediaTrendingWorkflowOperationsValue["fetchTrending"];
	relationshipSchemasRepository?: Layer.Layer<RelationshipSchemasRepository>;
};

const makeTestLayer = (options: TestLayerOptions) =>
	Layer.mergeAll(
		dbRunnerLayer,
		Layer.mock(MediaTrendingWorkflowOperations, {
			fetchTrending: options.fetchTrending ?? (() => Effect.die("unused")),
		}),
		options.entitiesService ?? makeEntitiesService(),
		options.relationshipsRepository ?? makeRelationshipsRepository(),
		options.mediaTrendingRepository ?? makeMediaTrendingRepository(),
		options.relationshipSchemasRepository ?? makeRelationshipSchemasRepository(),
	);

const withTestLayer = <A, E, R>(
	options: TestLayerOptions,
	executionId: string,
	effect: Effect.Effect<A, E, R>,
) => {
	const instance = WorkflowInstance.initial(InfrequentCronWorkflow, executionId);
	const engine = makeWorkflowActivityEngine(instance);

	return effect.pipe(
		Effect.provideService(WorkflowEngine, engine),
		Effect.provideService(WorkflowInstance, instance),
		Effect.provide(makeTestLayer(options)),
	);
};

it.effect("syncs successful provider trend items as ranked self edges", () => {
	let syncedInput: unknown;
	const savedInputs: unknown[] = [];
	const idByProviderItem = new Map([
		["script-movie:m1", "entity-movie-one"],
		["script-movie:m2", "entity-movie-two"],
		["script-show:s1", "entity-show-one"],
	]);

	const options = {
		fetchTrending: ({ scriptId }) =>
			scriptId === movieProvider.scriptId
				? Effect.succeed([
						{ name: "Movie One", externalId: "m1" },
						{ name: "Movie Two", externalId: "m2" },
						{ name: "Movie One Duplicate", externalId: "m1" },
					])
				: Effect.succeed([{ name: "Show One", externalId: "s1" }]),
		entitiesService: makeEntitiesService({
			save: (input) => {
				savedInputs.push(input);
				const key = `${input.sandboxScriptId}:${input.externalId}`;
				return Effect.succeed(
					listedEntity({
						name: input.name,
						externalId: input.externalId ?? "",
						entitySchemaId: input.entitySchemaId,
						id: idByProviderItem.get(key) ?? "entity-unknown",
						sandboxScriptId: input.sandboxScriptId ?? SandboxScriptId.make("script-unknown"),
					}),
				);
			},
		}),
		relationshipsRepository: makeRelationshipsRepository({
			syncGlobalRelationshipSelfEdges: (input) => {
				syncedInput = input;
				return Effect.void;
			},
		}),
		mediaTrendingRepository: makeMediaTrendingRepository({
			listProviderTargets: () => Effect.succeed([movieProvider, showProvider]),
		}),
	} satisfies TestLayerOptions;

	return withTestLayer(
		options,
		"exec-trending-success",
		Effect.gen(function* () {
			const result = yield* runMediaTrendingRefresh({
				executionId: "exec-trending-success",
			});

			expect(result).toEqual({ providerCount: 2, itemCount: 3, synced: true });
			expect(savedInputs).toHaveLength(4);
			expect(syncedInput).toMatchObject({
				relationshipSchemaId: "schema-media-trending",
				entries: [
					{
						entityId: "entity-movie-one",
						properties: { rank: 1, fetchedAt: expect.any(String) },
					},
					{
						entityId: "entity-movie-two",
						properties: { rank: 2, fetchedAt: expect.any(String) },
					},
					{
						entityId: "entity-show-one",
						properties: { rank: 3, fetchedAt: expect.any(String) },
					},
				],
			});
		}),
	);
});

it.effect("skips failed providers and syncs successful providers", () => {
	let syncedInput: unknown;
	const options = {
		fetchTrending: ({ scriptId }) =>
			scriptId === movieProvider.scriptId
				? Effect.fail(new SandboxRunError({ message: "not supported" }))
				: Effect.succeed([{ name: "Show One", externalId: "s1" }]),
		entitiesService: makeEntitiesService({
			save: (input) =>
				Effect.succeed(
					listedEntity({
						name: input.name,
						id: "entity-show-one",
						externalId: input.externalId ?? "",
						entitySchemaId: input.entitySchemaId,
						sandboxScriptId: input.sandboxScriptId ?? SandboxScriptId.make("script-show"),
					}),
				),
		}),
		relationshipsRepository: makeRelationshipsRepository({
			syncGlobalRelationshipSelfEdges: (input) => {
				syncedInput = input;
				return Effect.void;
			},
		}),
		mediaTrendingRepository: makeMediaTrendingRepository({
			listProviderTargets: () => Effect.succeed([movieProvider, showProvider]),
		}),
	} satisfies TestLayerOptions;

	return withTestLayer(
		options,
		"exec-trending-partial",
		Effect.gen(function* () {
			const result = yield* runMediaTrendingRefresh({
				executionId: "exec-trending-partial",
			});

			expect(result).toEqual({ providerCount: 1, itemCount: 1, synced: true });
			expect(syncedInput).toMatchObject({
				entries: [
					{
						entityId: "entity-show-one",
						properties: { rank: 1, fetchedAt: expect.any(String) },
					},
				],
			});
		}),
	);
});

it.effect("preserves prior trend edges when no provider succeeds", () => {
	let syncCalled = false;
	const options = {
		fetchTrending: () => Effect.fail(new SandboxRunError({ message: "provider unavailable" })),
		relationshipsRepository: makeRelationshipsRepository({
			syncGlobalRelationshipSelfEdges: () => {
				syncCalled = true;
				return Effect.void;
			},
		}),
		mediaTrendingRepository: makeMediaTrendingRepository({
			listProviderTargets: () => Effect.succeed([movieProvider]),
		}),
	} satisfies TestLayerOptions;

	return withTestLayer(
		options,
		"exec-trending-none",
		Effect.gen(function* () {
			const result = yield* runMediaTrendingRefresh({ executionId: "exec-trending-none" });

			expect(syncCalled).toBe(false);
			expect(result).toEqual({ providerCount: 0, itemCount: 0, synced: false });
		}),
	);
});
