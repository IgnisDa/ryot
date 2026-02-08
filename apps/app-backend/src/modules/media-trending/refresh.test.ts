import { expect, it } from "@effect/vitest";
import { WorkflowEngine, WorkflowInstance } from "@effect/workflow/WorkflowEngine";
import { SandboxRunError } from "@ryot/contract/errors";
import type { EntitySchemaSlug } from "@ryot/contract/schema/brands";
import {
	EntityId,
	RelationshipId,
	RelationshipSchemaSlug,
	SandboxScriptId,
} from "@ryot/contract/schema/brands";
import { Effect, Layer } from "effect";

import type { MockOverrides } from "#lib/test-utils/effect";
import {
	dbRunnerLayer,
	makeWorkflowActivityEngine,
	transactionLayer,
} from "#lib/test-utils/effect";
import { EntitiesService } from "#modules/entities/service";
import { RelationshipSchemasRepository } from "#modules/relationship-schemas/repository";
import { RelationshipsRepository } from "#modules/relationships/repository";
import { RelationshipsService } from "#modules/relationships/service";
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
} satisfies TrendingProviderTarget;

const showProvider = {
	scriptSlug: "show.tmdb",
	entitySchemaSlug: "show",
	scriptId: SandboxScriptId.make("script-show"),
} satisfies TrendingProviderTarget;

const mediaTrendingSchema = {
	isBuiltin: true,
	slug: "media-trending",
	name: "Media Trending",
	sourceEntitySchemaSlug: null,
	targetEntitySchemaSlug: null,
	propertiesSchema: { fields: {} },
	id: RelationshipSchemaSlug.make("schema-media-trending"),
};

const listedEntity = (input: {
	id: string;
	name: string;
	externalId: string;
	entitySchemaSlug: EntitySchemaSlug;
	sandboxScriptId: SandboxScriptId;
}) => ({
	properties: {},
	populatedAt: null,
	name: input.name,
	externalId: input.externalId,
	id: EntityId.make(input.id),
	entitySchemaSlug: input.entitySchemaSlug,
	createdAt: "2026-01-01T00:00:00.000Z",
	updatedAt: "2026-01-01T00:00:00.000Z",
	sandboxScriptId: input.sandboxScriptId,
});

const mockEntitiesService = Layer.mock(EntitiesService);
const mockRelationshipsRepository = Layer.mock(RelationshipsRepository);
const mockRelationshipsService = Layer.mock(RelationshipsService);
const mockMediaTrendingRepository = Layer.mock(MediaTrendingRepository);
const mockRelationshipSchemasRepository = Layer.mock(RelationshipSchemasRepository);

const makeEntitiesService = (overrides: MockOverrides<typeof mockEntitiesService> = {}) =>
	mockEntitiesService({
		create: () => Effect.die("unused"),
		...overrides,
		_tag: "EntitiesService",
	});

const makeRelationshipsRepository = (
	overrides: MockOverrides<typeof mockRelationshipsRepository> = {},
) =>
	mockRelationshipsRepository({
		listGlobalRelationships: () => Effect.succeed([]),
		...overrides,
		_tag: "RelationshipsRepository",
	});

const makeRelationshipsService = (overrides: MockOverrides<typeof mockRelationshipsService> = {}) =>
	mockRelationshipsService({
		create: (input) =>
			Effect.succeed({
				properties: {},
				wasInserted: true,
				sourceEntityId: input.sourceEntityId,
				targetEntityId: input.targetEntityId,
				createdAt: "2026-01-01T00:00:00.000Z",
				id: RelationshipId.make("relationship-id"),
				relationshipSchemaSlug: input.relationshipSchemaSlug,
			}),
		update: (input) =>
			Effect.succeed({
				properties: {},
				wasInserted: false,
				createdAt: "2026-01-01T00:00:00.000Z",
				sourceEntityId: input.sourceEntityId,
				targetEntityId: input.targetEntityId,
				id: RelationshipId.make("relationship-id"),
				relationshipSchemaSlug: input.relationshipSchemaSlug,
			}),
		delete: () => Effect.succeed(null),
		...overrides,
		_tag: "RelationshipsService",
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
	relationshipsService?: Layer.Layer<RelationshipsService>;
	mediaTrendingRepository?: Layer.Layer<MediaTrendingRepository>;
	relationshipsRepository?: Layer.Layer<RelationshipsRepository>;
	fetchTrending?: MediaTrendingWorkflowOperationsValue["fetchTrending"];
	relationshipSchemasRepository?: Layer.Layer<RelationshipSchemasRepository>;
};

const makeTestLayer = (options: TestLayerOptions) =>
	Layer.mergeAll(
		dbRunnerLayer,
		transactionLayer,
		Layer.mock(MediaTrendingWorkflowOperations, {
			fetchTrending: options.fetchTrending ?? (() => Effect.die("unused")),
		}),
		options.entitiesService ?? makeEntitiesService(),
		options.relationshipsRepository ?? makeRelationshipsRepository(),
		options.relationshipsService ?? makeRelationshipsService(),
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
	const savedInputs: unknown[] = [];
	const relationshipWrites: unknown[] = [];
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
			create: (input) => {
				savedInputs.push(input);
				const key = `${input.sandboxScriptId}:${input.externalId}`;
				return Effect.succeed(
					listedEntity({
						name: input.name,
						externalId: input.externalId ?? "",
						entitySchemaSlug: input.entitySchemaSlug,
						id: idByProviderItem.get(key) ?? "entity-unknown",
						sandboxScriptId: input.sandboxScriptId ?? SandboxScriptId.make("script-unknown"),
					}),
				);
			},
		}),
		relationshipsService: makeRelationshipsService({
			create: (input) =>
				Effect.sync(() => {
					relationshipWrites.push(input);
					return {
						properties: {},
						wasInserted: true,
						sourceEntityId: input.sourceEntityId,
						targetEntityId: input.targetEntityId,
						createdAt: "2026-01-01T00:00:00.000Z",
						id: RelationshipId.make("relationship-id"),
						relationshipSchemaSlug: input.relationshipSchemaSlug,
					};
				}),
		}),
		mediaTrendingRepository: makeMediaTrendingRepository({
			listProviderTargets: () => Effect.succeed([movieProvider, showProvider]),
		}),
	} satisfies TestLayerOptions;

	return withTestLayer(
		options,
		"exec-trending-success",
		Effect.gen(function* () {
			const result = yield* runMediaTrendingRefresh(
				{ executionId: "exec-trending-success" },
				"exec-trending-success",
			);

			expect(result).toEqual({ providerCount: 2, itemCount: 3, synced: true });
			expect(savedInputs).toHaveLength(4);
			expect(relationshipWrites).toEqual([
				expect.objectContaining({
					sourceEntityId: "entity-movie-one",
					targetEntityId: "entity-movie-one",
					properties: { rank: 1, fetchedAt: expect.any(String) },
				}),
				expect.objectContaining({
					sourceEntityId: "entity-movie-two",
					targetEntityId: "entity-movie-two",
					properties: { rank: 2, fetchedAt: expect.any(String) },
				}),
				expect.objectContaining({
					sourceEntityId: "entity-show-one",
					targetEntityId: "entity-show-one",
					properties: { rank: 3, fetchedAt: expect.any(String) },
				}),
			]);
		}),
	);
});

it.effect("skips failed providers and syncs successful providers", () => {
	let syncedEntityId: EntityId | undefined;
	const options = {
		fetchTrending: ({ scriptId }) =>
			scriptId === movieProvider.scriptId
				? Effect.fail(new SandboxRunError({ message: "not supported" }))
				: Effect.succeed([{ name: "Show One", externalId: "s1" }]),
		entitiesService: makeEntitiesService({
			create: (input) =>
				Effect.succeed(
					listedEntity({
						name: input.name,
						id: "entity-show-one",
						externalId: input.externalId ?? "",
						entitySchemaSlug: input.entitySchemaSlug,
						sandboxScriptId: input.sandboxScriptId ?? SandboxScriptId.make("script-show"),
					}),
				),
		}),
		relationshipsService: makeRelationshipsService({
			create: (input) =>
				Effect.sync(() => {
					syncedEntityId = input.sourceEntityId;
					return {
						properties: {},
						wasInserted: true,
						sourceEntityId: input.sourceEntityId,
						targetEntityId: input.targetEntityId,
						createdAt: "2026-01-01T00:00:00.000Z",
						id: RelationshipId.make("relationship-id"),
						relationshipSchemaSlug: input.relationshipSchemaSlug,
					};
				}),
		}),
		mediaTrendingRepository: makeMediaTrendingRepository({
			listProviderTargets: () => Effect.succeed([movieProvider, showProvider]),
		}),
	} satisfies TestLayerOptions;

	return withTestLayer(
		options,
		"exec-trending-partial",
		Effect.gen(function* () {
			const result = yield* runMediaTrendingRefresh(
				{ executionId: "exec-trending-partial" },
				"exec-trending-partial",
			);

			expect(result).toEqual({ providerCount: 1, itemCount: 1, synced: true });
			expect(syncedEntityId).toBe("entity-show-one");
		}),
	);
});

it.effect("updates current trend edges and deletes stale ones", () => {
	const updates: unknown[] = [];
	const deletes: unknown[] = [];
	const existing = [
		{
			properties: { rank: 9 },
			createdAt: "2026-01-01T00:00:00.000Z",
			relationshipSchemaSlug: mediaTrendingSchema.id,
			id: RelationshipId.make("current-relationship"),
			sourceEntityId: EntityId.make("entity-show-one"),
			targetEntityId: EntityId.make("entity-show-one"),
		},
		{
			properties: { rank: 10 },
			createdAt: "2026-01-01T00:00:00.000Z",
			relationshipSchemaSlug: mediaTrendingSchema.id,
			id: RelationshipId.make("stale-relationship"),
			sourceEntityId: EntityId.make("entity-stale"),
			targetEntityId: EntityId.make("entity-stale"),
		},
	];
	const options = {
		fetchTrending: () => Effect.succeed([{ name: "Show One", externalId: "s1" }]),
		entitiesService: makeEntitiesService({
			create: () =>
				Effect.succeed(
					listedEntity({
						name: "Show One",
						externalId: "s1",
						id: "entity-show-one",
						sandboxScriptId: showProvider.scriptId,
						entitySchemaSlug: showProvider.entitySchemaSlug,
					}),
				),
		}),
		relationshipsRepository: makeRelationshipsRepository({
			listGlobalRelationships: () => Effect.succeed(existing),
		}),
		relationshipsService: makeRelationshipsService({
			update: (input) =>
				Effect.sync(() => {
					updates.push(input);
					return {
						properties: {},
						wasInserted: false,
						sourceEntityId: input.sourceEntityId,
						targetEntityId: input.targetEntityId,
						createdAt: "2026-01-01T00:00:00.000Z",
						id: RelationshipId.make("current-relationship"),
						relationshipSchemaSlug: input.relationshipSchemaSlug,
					};
				}),
			delete: (input) =>
				Effect.sync(() => {
					deletes.push(input);
					return null;
				}),
		}),
		mediaTrendingRepository: makeMediaTrendingRepository({
			listProviderTargets: () => Effect.succeed([showProvider]),
		}),
	} satisfies TestLayerOptions;

	return withTestLayer(
		options,
		"exec-trending-reconcile",
		Effect.gen(function* () {
			const result = yield* runMediaTrendingRefresh(
				{ executionId: "exec-trending-reconcile" },
				"exec-trending-reconcile",
			);

			expect(result).toEqual({ providerCount: 1, itemCount: 1, synced: true });
			expect(updates).toHaveLength(1);
			expect(updates[0]).toMatchObject({
				sourceEntityId: "entity-show-one",
				properties: { rank: 1 },
			});
			expect(deletes).toEqual([
				expect.objectContaining({
					sourceEntityId: "entity-stale",
					targetEntityId: "entity-stale",
				}),
			]);
		}),
	);
});

it.effect("preserves prior trend edges when no provider succeeds", () => {
	let syncCalled = false;
	const options = {
		fetchTrending: () => Effect.fail(new SandboxRunError({ message: "provider unavailable" })),
		relationshipsService: makeRelationshipsService({
			create: () =>
				Effect.sync(() => {
					syncCalled = true;
					return {
						properties: {},
						wasInserted: true,
						createdAt: "2026-01-01T00:00:00.000Z",
						sourceEntityId: EntityId.make("unused"),
						targetEntityId: EntityId.make("unused"),
						id: RelationshipId.make("relationship-id"),
						relationshipSchemaSlug: RelationshipSchemaSlug.make("unused"),
					};
				}),
		}),
		mediaTrendingRepository: makeMediaTrendingRepository({
			listProviderTargets: () => Effect.succeed([movieProvider]),
		}),
	} satisfies TestLayerOptions;

	return withTestLayer(
		options,
		"exec-trending-none",
		Effect.gen(function* () {
			const result = yield* runMediaTrendingRefresh(
				{ executionId: "exec-trending-none" },
				"exec-trending-none",
			);

			expect(syncCalled).toBe(false);
			expect(result).toEqual({ providerCount: 0, itemCount: 0, synced: false });
		}),
	);
});
