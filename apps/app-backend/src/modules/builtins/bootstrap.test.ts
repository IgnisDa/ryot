import { expect, it } from "@effect/vitest";
import type { ListedSavedView } from "@ryot/contract/modules/saved-views/schemas";
import {
	EntityId,
	EntitySchemaId,
	SavedViewId,
	TrackerId,
	UserId,
} from "@ryot/contract/schema/brands";
import { Effect, Layer } from "effect";

import * as schema from "#lib/infrastructure/db/schema/tables/combined";
import { CurrentDb } from "#lib/infrastructure/db/service";
import { EntitiesService } from "#modules/entities/service";
import { SavedViewsService } from "#modules/saved-views/service";
import { TrackersService } from "#modules/trackers/service";

import { performBootstrap } from "./bootstrap";

const userId = UserId.make("user-id");
const mediaTrackerId = TrackerId.make("media-tracker-id");
const fitnessTrackerId = TrackerId.make("fitness-tracker-id");
const collectionSchemaId = EntitySchemaId.make("collection-schema-id");
const movieSchemaId = EntitySchemaId.make("movie-schema-id");
const librarySchemaId = EntitySchemaId.make("library-schema-id");

const makeTracker = (id: TrackerId, slug: string) => ({
	config: {},
	description: null,
	accentColor: "#5B7FFF",
	icon: "film",
	id,
	isBuiltin: true,
	isDisabled: false,
	name: slug,
	slug,
	sortOrder: 0,
});

const makeSavedView = (trackerId: TrackerId | null): ListedSavedView => ({
	accentColor: "#5B7FFF",
	createdAt: "2026-07-16T00:00:00.000Z",
	displayConfiguration: {
		entityIdProperty: { type: "literal", value: "id" },
		table: { columns: [] },
		grid: {
			imageProperty: null,
			eyebrowProperty: null,
			calloutProperty: null,
			primarySubtitleProperty: null,
			secondarySubtitleProperty: null,
			titleProperty: { type: "literal", value: "name" },
		},
		list: {
			imageProperty: null,
			eyebrowProperty: null,
			calloutProperty: null,
			primarySubtitleProperty: null,
			secondarySubtitleProperty: null,
			titleProperty: { type: "literal", value: "name" },
		},
	},
	icon: "film",
	id: SavedViewId.make("saved-view-id"),
	isBuiltin: true,
	isDisabled: false,
	name: "Built-in",
	queryDocument: {
		output: {
			fields: [],
			orderBy: [
				{
					order: "asc",
					expr: { type: "ref", sourceAlias: "entity", field: { type: "system", name: "name" } },
				},
			],
			pagination: { limit: 20, page: 1 },
			type: "rows",
		},
		source: { alias: "entity", schemas: ["movie"], type: "entities", where: null },
	},
	slug: "built-in",
	sortOrder: 0,
	trackerId,
	updatedAt: "2026-07-16T00:00:00.000Z",
});

const makeEntity = () => ({
	createdAt: "2026-07-16T00:00:00.000Z",
	entitySchemaId: librarySchemaId,
	externalId: null,
	id: EntityId.make("library-entity-id"),
	name: "Library",
	populatedAt: null,
	properties: {},
	sandboxScriptId: null,
	updatedAt: "2026-07-16T00:00:00.000Z",
});

const entitySchemas = [
	{ id: librarySchemaId, slug: "library", icon: "library", accentColor: "#9CA3AF" },
	{ id: collectionSchemaId, slug: "collection", icon: "folder", accentColor: "#FACC15" },
	{ id: movieSchemaId, slug: "movie", icon: "film", accentColor: "#5B7FFF" },
];

const makeBootstrapDb = (options?: {
	bootstrapCompletedAt?: Date | null;
	onMarkComplete?: () => void;
}) => {
	const marker = options?.bootstrapCompletedAt ?? null;
	const userRows = [{ bootstrapCompletedAt: marker }];

	return Object.assign(Object.create(null), {
		select: () => ({
			from: (table: unknown) => {
				if (table === schema.user) {
					return {
						where: () =>
							Object.assign(Promise.resolve(userRows), {
								for: () => Promise.resolve(userRows),
							}),
					};
				}

				if (table === schema.entitySchema) {
					return {
						where: () => Promise.resolve(entitySchemas),
					};
				}

				if (table === schema.entity) {
					return {
						where: () =>
							Object.assign(Promise.resolve([]), {
								limit: () => Promise.resolve([]),
							}),
					};
				}

				return { where: () => Promise.resolve([]) };
			},
		}),
		update: () => ({
			set: () => ({
				where: () => {
					options?.onMarkComplete?.();
					return Promise.resolve({});
				},
			}),
		}),
		execute: () => Promise.resolve({}),
	});
};

const makeServiceLayers = (
	createdTrackerSlugs: string[],
	linkedSchemaIds: EntitySchemaId[],
	createdViewSlugs: string[],
	createdEntities: unknown[],
) => {
	const trackersLayer = Layer.mock(TrackersService)({
		_tag: "TrackersService",
		create: (_user, input) =>
			Effect.sync(() => {
				createdTrackerSlugs.push(input.slug ?? "");
				return input.slug === "media"
					? makeTracker(mediaTrackerId, "media")
					: makeTracker(fitnessTrackerId, "fitness");
			}),
		linkEntitySchema: ({ entitySchemaId }) =>
			Effect.sync(() => {
				linkedSchemaIds.push(entitySchemaId);
				return mediaTrackerId;
			}),
		list: () =>
			Effect.succeed([
				makeTracker(mediaTrackerId, "media"),
				makeTracker(fitnessTrackerId, "fitness"),
			]),
	});

	const savedViewsLayer = Layer.mock(SavedViewsService)({
		_tag: "SavedViewsService",
		create: (_user, input) =>
			Effect.sync(() => {
				createdViewSlugs.push(input.slug ?? "");
				return makeSavedView(input.trackerId ?? null);
			}),
	});

	const entitiesLayer = Layer.mock(EntitiesService)({
		_tag: "EntitiesService",
		create: (input) =>
			Effect.sync(() => {
				createdEntities.push(input);
				return makeEntity();
			}),
	});

	return Layer.mergeAll(trackersLayer, savedViewsLayer, entitiesLayer);
};

it.effect("routes bootstrap writes through owning services and sets the completion marker", () => {
	const createdTrackerSlugs: string[] = [];
	const linkedSchemaIds: EntitySchemaId[] = [];
	const createdViewSlugs: string[] = [];
	const createdEntities: unknown[] = [];
	let markerUpdated = false;

	return Effect.gen(function* () {
		yield* performBootstrap(userId);

		expect(createdTrackerSlugs).toEqual(["media", "fitness"]);
		expect(linkedSchemaIds).toEqual([movieSchemaId, collectionSchemaId]);
		expect(createdViewSlugs).toEqual(["collections", "all-movies"]);
		expect(createdEntities).toHaveLength(1);
		expect(markerUpdated).toBe(true);
	}).pipe(
		Effect.provide(
			Layer.mergeAll(
				Layer.succeed(CurrentDb, makeBootstrapDb({ onMarkComplete: () => (markerUpdated = true) })),
				makeServiceLayers(createdTrackerSlugs, linkedSchemaIds, createdViewSlugs, createdEntities),
			),
		),
	);
});

it.effect("short-circuits when the completion marker is already set", () => {
	const createdTrackerSlugs: string[] = [];
	const linkedSchemaIds: EntitySchemaId[] = [];
	const createdViewSlugs: string[] = [];
	const createdEntities: unknown[] = [];
	let markerUpdated = false;

	return Effect.gen(function* () {
		yield* performBootstrap(userId);

		expect(createdTrackerSlugs).toEqual([]);
		expect(linkedSchemaIds).toEqual([]);
		expect(createdViewSlugs).toEqual([]);
		expect(createdEntities).toEqual([]);
		expect(markerUpdated).toBe(false);
	}).pipe(
		Effect.provide(
			Layer.mergeAll(
				Layer.succeed(
					CurrentDb,
					makeBootstrapDb({
						bootstrapCompletedAt: new Date("2026-01-01T00:00:00Z"),
						onMarkComplete: () => (markerUpdated = true),
					}),
				),
				makeServiceLayers(createdTrackerSlugs, linkedSchemaIds, createdViewSlugs, createdEntities),
			),
		),
	);
});
