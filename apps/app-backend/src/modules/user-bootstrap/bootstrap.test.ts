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
import { NotificationSubscriptionsService } from "#modules/automations/notification-subscriptions-service";
import { EntitiesService } from "#modules/entities/service";
import { SavedViewsService } from "#modules/saved-views/service";
import { TrackersService } from "#modules/trackers/service";

import { performBootstrap } from "./bootstrap";

const userId = UserId.make("user-id");
const mediaTrackerId = TrackerId.make("media-tracker-id");
const movieSchemaId = EntitySchemaId.make("movie-schema-id");
const fitnessTrackerId = TrackerId.make("fitness-tracker-id");
const librarySchemaId = EntitySchemaId.make("library-schema-id");
const collectionSchemaId = EntitySchemaId.make("collection-schema-id");

const makeTracker = (id: TrackerId, slug: string) => ({
	id,
	slug,
	config: {},
	name: slug,
	icon: "film",
	sortOrder: 0,
	isBuiltin: true,
	isDisabled: false,
	description: null,
	accentColor: "#5B7FFF",
});

const makeSavedView = (trackerId: TrackerId | null): ListedSavedView => ({
	trackerId,
	icon: "film",
	sortOrder: 0,
	isBuiltin: true,
	slug: "built-in",
	name: "Built-in",
	isDisabled: false,
	accentColor: "#5B7FFF",
	updatedAt: "2026-07-16T00:00:00.000Z",
	createdAt: "2026-07-16T00:00:00.000Z",
	id: SavedViewId.make("saved-view-id"),
	displayConfiguration: {
		table: { columns: [] },
		entityIdProperty: { type: "literal", value: "id" },
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
	queryDocument: {
		source: { alias: "entity", schemas: ["movie"], type: "entities", where: null },
		output: {
			fields: [],
			type: "rows",
			pagination: { limit: 20, page: 1 },
			orderBy: [
				{
					order: "asc",
					expr: { type: "ref", sourceAlias: "entity", field: { type: "system", name: "name" } },
				},
			],
		},
	},
});

const makeEntity = () => ({
	properties: {},
	name: "Library",
	externalId: null,
	populatedAt: null,
	sandboxScriptId: null,
	entitySchemaId: librarySchemaId,
	updatedAt: "2026-07-16T00:00:00.000Z",
	createdAt: "2026-07-16T00:00:00.000Z",
	id: EntityId.make("library-entity-id"),
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
	defaultRuleUserIds: UserId[],
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
	const notificationSubscriptionsLayer = Layer.mock(NotificationSubscriptionsService)({
		_tag: "NotificationSubscriptionsService",
		ensureDefaultRules: (inputUserId) =>
			Effect.sync(() => {
				defaultRuleUserIds.push(inputUserId);
			}),
	});

	return Layer.mergeAll(
		trackersLayer,
		entitiesLayer,
		savedViewsLayer,
		notificationSubscriptionsLayer,
	);
};

it.effect("routes bootstrap writes through owning services and sets the completion marker", () => {
	let markerUpdated = false;
	const createdViewSlugs: string[] = [];
	const createdEntities: unknown[] = [];
	const defaultRuleUserIds: UserId[] = [];
	const createdTrackerSlugs: string[] = [];
	const linkedSchemaIds: EntitySchemaId[] = [];

	return Effect.gen(function* () {
		yield* performBootstrap(userId);

		expect(createdTrackerSlugs).toEqual(["media", "fitness"]);
		expect(linkedSchemaIds).toEqual([movieSchemaId, collectionSchemaId]);
		expect(createdViewSlugs).toEqual(["collections", "all-movies"]);
		expect(createdEntities).toHaveLength(1);
		expect(defaultRuleUserIds).toEqual([userId]);
		expect(markerUpdated).toBe(true);
	}).pipe(
		Effect.provide(
			Layer.mergeAll(
				Layer.succeed(CurrentDb, makeBootstrapDb({ onMarkComplete: () => (markerUpdated = true) })),
				makeServiceLayers(
					createdTrackerSlugs,
					linkedSchemaIds,
					createdViewSlugs,
					createdEntities,
					defaultRuleUserIds,
				),
			),
		),
	);
});

it.effect("short-circuits when the completion marker is already set", () => {
	let markerUpdated = false;
	const createdViewSlugs: string[] = [];
	const createdEntities: unknown[] = [];
	const defaultRuleUserIds: UserId[] = [];
	const createdTrackerSlugs: string[] = [];
	const linkedSchemaIds: EntitySchemaId[] = [];

	return Effect.gen(function* () {
		yield* performBootstrap(userId);

		expect(createdTrackerSlugs).toEqual([]);
		expect(linkedSchemaIds).toEqual([]);
		expect(createdViewSlugs).toEqual([]);
		expect(createdEntities).toEqual([]);
		expect(defaultRuleUserIds).toEqual([]);
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
				makeServiceLayers(
					createdTrackerSlugs,
					linkedSchemaIds,
					createdViewSlugs,
					createdEntities,
					defaultRuleUserIds,
				),
			),
		),
	);
});
