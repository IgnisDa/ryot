import { Effect } from "effect";

import type { Client } from "~/fixtures/kernel/auth";
import { findBuiltinSchemaBySlug } from "~/fixtures/kernel/entity-schemas";
import { listEventSchemas, requireEventSchemaBySlug } from "~/fixtures/kernel/event-schemas";
import { assertPresent } from "~/support/assertions";

import { seedMediaEntity } from "./media";

const defaultMediaProperties = {
	genres: [],
	isNsfw: null,
	sourceUrl: null,
	description: null,
	publishYear: null,
	providerRating: null,
	productionStatus: null,
};

const defaultMediaPropertiesWithUnlinkedCreators = {
	...defaultMediaProperties,
	unlinkedCreators: [],
};

type BuiltinMediaLifecycleFixtureOptions = {
	entitySchemaSlug?: string;
	properties?: Record<string, unknown>;
};

const propertiesBySchemaSlug: Record<string, Record<string, unknown>> = {
	book: { ...defaultMediaProperties },
	movie: { ...defaultMediaProperties, images: [] },
	anime: { ...defaultMediaProperties, images: [], episodes: null },
	manga: { ...defaultMediaProperties, images: [], volumes: null, chapters: null },
	podcast: {
		...defaultMediaPropertiesWithUnlinkedCreators,
		images: [],
		episodes: [],
		totalEpisodes: null,
	},
	show: {
		...defaultMediaPropertiesWithUnlinkedCreators,
		images: [],
		totalSeasons: null,
		totalEpisodes: null,
	},
};

export const createBuiltinMediaLifecycleFixture = (
	client: Client,
	options: BuiltinMediaLifecycleFixtureOptions = {},
) =>
	Effect.gen(function* () {
		const entitySchemaSlug = options.entitySchemaSlug ?? "book";
		const { schema: selectedSchema } = yield* findBuiltinSchemaBySlug(client, entitySchemaSlug);

		const providerId = selectedSchema.providers[0]?.providerId;
		assertPresent(providerId, `Missing built-in ${entitySchemaSlug} provider`);

		const eventSchemas = yield* listEventSchemas(client, selectedSchema.id);
		const backlogEventSchema = requireEventSchemaBySlug(eventSchemas, "backlog");
		const progressEventSchema = requireEventSchemaBySlug(eventSchemas, "progress");
		const completeEventSchema = requireEventSchemaBySlug(eventSchemas, "complete");
		const reviewEventSchema = requireEventSchemaBySlug(eventSchemas, "review");
		const droppedEventSchema = requireEventSchemaBySlug(eventSchemas, "dropped");
		const onHoldEventSchema = requireEventSchemaBySlug(eventSchemas, "on_hold");

		const entity = yield* seedMediaEntity({
			providerId,
			userId: null,
			entitySchemaSlug: selectedSchema.id,
			externalId: `${entitySchemaSlug}-${crypto.randomUUID()}`,
			name: `Built-in ${entitySchemaSlug} ${crypto.randomUUID()}`,
			properties: {
				...(propertiesBySchemaSlug[entitySchemaSlug] ?? defaultMediaProperties),
				...options.properties,
			},
		});

		return {
			entityId: entity.id,
			reviewEventSchemaSlug: reviewEventSchema.id,
			onHoldEventSchemaSlug: onHoldEventSchema.id,
			backlogEventSchemaSlug: backlogEventSchema.id,
			droppedEventSchemaSlug: droppedEventSchema.id,
			completeEventSchemaSlug: completeEventSchema.id,
			progressEventSchemaSlug: progressEventSchema.id,
		};
	});
