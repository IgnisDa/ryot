import type {
	AuthoredAppSchema,
	ManifestText,
} from "@ryot-app/contract/modules/plugins/manifest-text";
import { reviewPropertyFields } from "@ryot-app/plugin-kit/schema";

import {
	CONSUMED_ON_ITEM_LIMIT,
	CONSUMED_ON_SOURCES_LIMIT,
} from "../../shared/consumed-on-settings";
import { catalogMessage } from "../../shared/messages.generated";
import { mediaPositionField, withConsumptionFacts } from "./consumption";
import {
	animePropertiesSchema,
	audiobookPropertiesSchema,
	bookPropertiesSchema,
	comicBookPropertiesSchema,
	companyPropertiesSchema,
	mangaPropertiesSchema,
	mediaGroupPropertiesSchema,
	moviePropertiesSchema,
	musicPropertiesSchema,
	personPropertiesSchema,
	podcastEpisodePropertiesSchema,
	podcastPropertiesSchema,
	showEpisodePropertiesSchema,
	showPropertiesSchema,
	showSeasonPropertiesSchema,
	videoGamePropertiesSchema,
	visualNovelPropertiesSchema,
} from "./property";

const consumedOnField = {
	consumedOn: {
		type: "array" as const,
		label: catalogMessage("property.consumed-on"),
		validation: { maxItems: CONSUMED_ON_SOURCES_LIMIT },
		description:
			"The sources or platforms where this content was consumed (e.g. Netflix, Jellyfin)",
		items: {
			type: "string" as const,
			description: "A source or platform",
			label: catalogMessage("property.source"),
			validation: { maxLength: CONSUMED_ON_ITEM_LIMIT },
		},
	},
};

const startedOnField = {
	type: "datetime" as const,
	label: catalogMessage("property.started-on"),
	description: "Date and time you started consuming this media",
};

const timeSpentField = {
	type: "number" as const,
	validation: { minimum: 0 },
	label: catalogMessage("property.time-spent"),
	description: "Time spent consuming this media in minutes",
};

const withStartedOn = (schema: AuthoredAppSchema): AuthoredAppSchema => ({
	...schema,
	fields: { startedOn: startedOnField, ...schema.fields },
});

const withTimeSpent = (schema: AuthoredAppSchema): AuthoredAppSchema => ({
	...schema,
	fields: { ...schema.fields, timeSpent: timeSpentField },
});

const progressPercentPropertiesSchema = (): AuthoredAppSchema => ({
	fields: {
		...consumedOnField,
		progressPercent: {
			type: "number" as const,
			validation: { maximum: 100, exclusiveMinimum: 0 },
			label: catalogMessage("property.progress-percent"),
			description: "Percentage of the media completed so far (0 to 100)",
		},
	},
});

const progressPropertiesSchemaByEntity = (
	entitySchemaSlug: string | undefined,
): AuthoredAppSchema => {
	if (entitySchemaSlug === undefined) {
		return progressPercentPropertiesSchema();
	}
	switch (entitySchemaSlug) {
		case "book":
		case "comic-book":
			return {
				fields: {
					...progressPercentPropertiesSchema().fields,
					progressPages: {
						type: "number",
						validation: { minimum: 0 },
						label: catalogMessage("property.pages-reached"),
						description: "Exact cumulative pages in this run",
					},
				},
			};
		case "anime":
		case "manga":
			return {
				fields: {
					...progressPercentPropertiesSchema().fields,
					position: mediaPositionField(entitySchemaSlug, {
						label: catalogMessage("property.position"),
						description: "Cumulative position consumed through",
					}),
				},
			};
		default:
			return progressPercentPropertiesSchema();
	}
};

const statusPropertiesSchemaByEntity = (entitySchemaSlug: string | undefined): AuthoredAppSchema =>
	entitySchemaSlug === "show" || entitySchemaSlug === "podcast"
		? { fields: { ...consumedOnField } }
		: progressPropertiesSchemaByEntity(entitySchemaSlug);

const listStateDateComponent = (label: ManifestText, description: string, maximum?: number) => ({
	label,
	description,
	type: "integer" as const,
	validation: { minimum: 1, ...(maximum === undefined ? {} : { maximum }) },
});

const listStateDateField = (label: ManifestText, description: string, position: number) => ({
	label,
	position,
	description,
	type: "object" as const,
	unknownKeys: "strict" as const,
	properties: {
		year: listStateDateComponent(catalogMessage("property.year"), "Year in the AniList date"),
		day: listStateDateComponent(catalogMessage("property.day"), "Day in the AniList date", 31),
		month: listStateDateComponent(
			catalogMessage("property.month"),
			"Month in the AniList date",
			12,
		),
	},
});

const listStateEventSchema = (entitySchemaSlug: "anime" | "manga") => ({
	slug: "list-state",
	name: catalogMessage("event-schema.list-state.name"),
	propertiesSchema: {
		unknownKeys: "strict" as const,
		fields: {
			startedDate: listStateDateField(
				catalogMessage("property.started-date"),
				"The partial start date AniList reports, without inferred components",
				6,
			),
			completedDate: listStateDateField(
				catalogMessage("property.completed-date"),
				"The partial completion date AniList reports, without inferred components",
				7,
			),
			position: {
				...mediaPositionField(entitySchemaSlug, {
					label: catalogMessage("property.position"),
					description: "The position AniList reports",
				}),
				position: 8,
			},
			repeatCount: {
				position: 5,
				type: "integer" as const,
				label: catalogMessage("property.repeat-count"),
				validation: { minimum: 0, required: true as const },
				description: "The number of repeats recorded by AniList",
			},
			sourceEntryId: {
				position: 2,
				type: "string" as const,
				label: catalogMessage("property.source-entry-id"),
				validation: { minLength: 1, required: true as const },
				description: "The AniList list entry that provided this state",
			},
			sourceUpdatedAt: {
				position: 4,
				type: "datetime" as const,
				validation: { required: true as const },
				label: catalogMessage("property.source-updated-at"),
				description: "The last update time AniList reports for this list entry",
			},
			sourceAccountId: {
				position: 1,
				type: "string" as const,
				label: catalogMessage("property.source-account-id"),
				validation: { minLength: 1, required: true as const },
				description: "The AniList account that provided this list state",
			},
			source: {
				position: 0,
				type: "enum" as const,
				validation: { required: true as const },
				label: catalogMessage("property.source"),
				description: "The source that provided this list state",
				choices: {
					kind: "static" as const,
					values: [{ value: "anilist", label: catalogMessage("choice.anilist") }],
				},
			},
			state: {
				position: 3,
				type: "enum" as const,
				validation: { required: true as const },
				label: catalogMessage("property.list-state"),
				description: "The current state recorded by AniList",
				choices: {
					kind: "static" as const,
					values: [
						{ value: "backlog" },
						{ value: "in_progress" },
						{ value: "on_hold" },
						{ value: "dropped" },
						{ value: "complete" },
					],
				},
			},
		},
	},
});

const lifecycleEventSchemaBySlug = (slug: string) => {
	const eventSchema = mediaLifecycleEventSchemas().find((schema) => schema.slug === slug);
	if (!eventSchema) {
		throw new Error(`Missing builtin lifecycle event schema: ${slug}`);
	}
	return eventSchema;
};

const libraryEventSchema = () => ({
	slug: "add-to-media-library",
	propertiesSchema: { fields: {} },
	name: catalogMessage("event-schema.add-to-media-library.name"),
});

const reviewPropertiesSchemaByEntity = (
	entitySchemaSlug: string | undefined,
): AuthoredAppSchema => {
	const fields: AuthoredAppSchema["fields"] = {
		...reviewPropertyFields("Your written thoughts or notes about this media"),
		consumptionEventId: {
			type: "string",
			reference: { kind: "event-id" },
			label: catalogMessage("property.about"),
			description: "The completion, progress or status record this review is about",
		},
	};
	switch (entitySchemaSlug) {
		case "anime":
		case "manga":
			return {
				fields: {
					...fields,
					position: mediaPositionField(entitySchemaSlug, {
						label: catalogMessage("property.reviewed-item"),
						description: "The episode, chapter or volume being reviewed",
					}),
				},
			};
		case undefined:
		default:
			return { fields };
	}
};

const mediaLifecycleEventSchemas = (entitySchemaSlug?: string) => [
	libraryEventSchema(),
	{
		slug: "backlog",
		propertiesSchema: { fields: {} },
		name: catalogMessage("event-schema.backlog.name"),
	},
	{
		slug: "progress",
		name: catalogMessage("event-schema.progress.name"),
		propertiesSchema: withConsumptionFacts(
			withStartedOn(withTimeSpent(progressPropertiesSchemaByEntity(entitySchemaSlug))),
		),
	},
	{
		slug: "review",
		name: catalogMessage("event-schema.review.name"),
		propertiesSchema: reviewPropertiesSchemaByEntity(entitySchemaSlug),
	},
	{
		slug: "dropped",
		name: catalogMessage("event-schema.dropped.name"),
		propertiesSchema: withStartedOn(
			withTimeSpent(withConsumptionFacts(statusPropertiesSchemaByEntity(entitySchemaSlug))),
		),
	},
	{
		slug: "on_hold",
		name: catalogMessage("event-schema.on-hold.name"),
		propertiesSchema: withStartedOn(
			withTimeSpent(withConsumptionFacts(statusPropertiesSchemaByEntity(entitySchemaSlug))),
		),
	},
	{
		slug: "complete",
		name: catalogMessage("event-schema.complete.name"),
		propertiesSchema: withConsumptionFacts({
			fields: {
				...consumedOnField,
				timeSpent: timeSpentField,
				startedOn: startedOnField,
				completionKey: {
					type: "string" as const,
					label: catalogMessage("property.automatic-completion-identity"),
					description: "Key of the completion occurrence that derived this record",
				},
				completionSilent: {
					type: "boolean" as const,
					label: catalogMessage("property.silent-history-correction"),
					description: "Whether creating this derived record must skip external delivery",
				},
				dateUnknown: {
					type: "boolean" as const,
					label: catalogMessage("property.date-unknown"),
					description:
						"Whether the completion date is unknown; occurredAt is the real completion time otherwise",
				},
			},
		}),
	},
	...(entitySchemaSlug === "anime" || entitySchemaSlug === "manga"
		? [
				listStateEventSchema(entitySchemaSlug),
				{
					slug: "item-complete",
					name: catalogMessage("event-schema.item-complete.name"),
					propertiesSchema: withConsumptionFacts({
						fields: {
							...consumedOnField,
							timeSpent: timeSpentField,
							startedOn: startedOnField,
							position: mediaPositionField(entitySchemaSlug, {
								required: true,
								label: catalogMessage("property.consumed-item"),
								description:
									"One independent numbered occurrence, not cumulative progress or title completion",
							}),
						},
					}),
				},
			]
		: []),
];

const buildMediaGroupEntitySchema = (slug: string, name: ManifestText, icon: string) => ({
	slug,
	name,
	icon,
	propertiesSchema: mediaGroupPropertiesSchema,
	eventSchemas: mediaLifecycleEventSchemas(slug).filter(
		(s) => s.slug === "review" || s.slug === "add-to-media-library",
	),
});

export const mediaEntitySchemas = () => [
	{
		icon: "library",
		eventSchemas: [],
		slug: "media-library",
		propertiesSchema: { fields: {} },
		name: catalogMessage("entity-schema.media-library.name"),
		userState: { deniedOperations: ["clear", "merge"] as const },
	},
	{
		icon: "user",
		slug: "person",
		refreshIntervalDays: 365,
		propertiesSchema: personPropertiesSchema,
		name: catalogMessage("entity-schema.person.name"),
		eventSchemas: mediaLifecycleEventSchemas("person").filter(
			(schema) => schema.slug === "review" || schema.slug === "add-to-media-library",
		),
	},
	{
		icon: "tags",
		slug: "genre",
		eventSchemas: [],
		propertiesSchema: { fields: {} },
		name: catalogMessage("entity-schema.genre.name"),
	},
	{
		slug: "company",
		icon: "building-2",
		refreshIntervalDays: 365,
		propertiesSchema: companyPropertiesSchema,
		name: catalogMessage("entity-schema.company.name"),
		eventSchemas: mediaLifecycleEventSchemas("company").filter(
			(schema) => schema.slug === "review" || schema.slug === "add-to-media-library",
		),
	},
	buildMediaGroupEntitySchema(
		"movie-group",
		catalogMessage("entity-schema.movie-group.name"),
		"film",
	),
	buildMediaGroupEntitySchema(
		"audiobook-group",
		catalogMessage("entity-schema.audiobook-group.name"),
		"mic",
	),
	buildMediaGroupEntitySchema(
		"book-group",
		catalogMessage("entity-schema.book-group.name"),
		"book-copy",
	),
	buildMediaGroupEntitySchema(
		"comic-book-group",
		catalogMessage("entity-schema.comic-book-group.name"),
		"sparkles",
	),
	buildMediaGroupEntitySchema(
		"music-group",
		catalogMessage("entity-schema.music-group.name"),
		"disc-3",
	),
	buildMediaGroupEntitySchema(
		"video-game-group",
		catalogMessage("entity-schema.video-game-group.name"),
		"joystick",
	),
	{
		slug: "book",
		icon: "book-open",
		refreshIntervalDays: 365,
		occursAtProperties: ["publishDate"],
		propertiesSchema: bookPropertiesSchema,
		name: catalogMessage("entity-schema.book.name"),
		eventSchemas: mediaLifecycleEventSchemas("book"),
	},
	{
		icon: "book-image",
		slug: "comic-book",
		refreshIntervalDays: 365,
		occursAtProperties: ["publishDate"],
		propertiesSchema: comicBookPropertiesSchema,
		name: catalogMessage("entity-schema.comic-book.name"),
		eventSchemas: mediaLifecycleEventSchemas("comic-book"),
	},
	{
		icon: "tv",
		slug: "anime",
		refreshIntervalDays: 30,
		occursAtProperties: ["publishDate"],
		propertiesSchema: animePropertiesSchema,
		name: catalogMessage("entity-schema.anime.name"),
		eventSchemas: mediaLifecycleEventSchemas("anime"),
	},
	{
		slug: "movie",
		icon: "clapperboard",
		refreshIntervalDays: 180,
		occursAtProperties: ["publishDate"],
		propertiesSchema: moviePropertiesSchema,
		name: catalogMessage("entity-schema.movie.name"),
		eventSchemas: mediaLifecycleEventSchemas("movie"),
	},
	{
		slug: "show",
		icon: "monitor-play",
		refreshIntervalDays: 7,
		propertiesSchema: showPropertiesSchema,
		name: catalogMessage("entity-schema.show.name"),
		eventSchemas: mediaLifecycleEventSchemas("show").filter((schema) => schema.slug !== "progress"),
	},
	{
		icon: "list-video",
		slug: "show-season",
		propertiesSchema: showSeasonPropertiesSchema,
		name: catalogMessage("entity-schema.show-season.name"),
		eventSchemas: [
			lifecycleEventSchemaBySlug("review"),
			lifecycleEventSchemaBySlug("add-to-media-library"),
		],
	},
	{
		icon: "play-square",
		slug: "show-episode",
		propertiesSchema: showEpisodePropertiesSchema,
		occursAtProperties: ["airingAt", "publishDate"],
		name: catalogMessage("entity-schema.show-episode.name"),
		eventSchemas: [
			lifecycleEventSchemaBySlug("progress"),
			lifecycleEventSchemaBySlug("review"),
			lifecycleEventSchemaBySlug("complete"),
			lifecycleEventSchemaBySlug("add-to-media-library"),
		],
	},
	{
		icon: "book",
		slug: "manga",
		refreshIntervalDays: 30,
		occursAtProperties: ["publishDate"],
		propertiesSchema: mangaPropertiesSchema,
		name: catalogMessage("entity-schema.manga.name"),
		eventSchemas: mediaLifecycleEventSchemas("manga"),
	},
	{
		slug: "audiobook",
		icon: "headphones",
		refreshIntervalDays: 365,
		occursAtProperties: ["publishDate"],
		propertiesSchema: audiobookPropertiesSchema,
		name: catalogMessage("entity-schema.audiobook.name"),
		eventSchemas: mediaLifecycleEventSchemas("audiobook"),
	},
	{
		slug: "podcast",
		icon: "podcast",
		refreshIntervalDays: 30,
		propertiesSchema: podcastPropertiesSchema,
		name: catalogMessage("entity-schema.podcast.name"),
		eventSchemas: mediaLifecycleEventSchemas("podcast").filter(
			(schema) => schema.slug !== "progress",
		),
	},
	{
		icon: "radio",
		slug: "podcast-episode",
		occursAtProperties: ["airingAt", "publishDate"],
		propertiesSchema: podcastEpisodePropertiesSchema,
		name: catalogMessage("entity-schema.podcast-episode.name"),
		eventSchemas: [
			lifecycleEventSchemaBySlug("progress"),
			lifecycleEventSchemaBySlug("review"),
			lifecycleEventSchemaBySlug("complete"),
			lifecycleEventSchemaBySlug("add-to-media-library"),
		],
	},
	{
		icon: "gamepad-2",
		slug: "video-game",
		refreshIntervalDays: 180,
		occursAtProperties: ["publishDate"],
		propertiesSchema: videoGamePropertiesSchema,
		name: catalogMessage("entity-schema.video-game.name"),
		eventSchemas: mediaLifecycleEventSchemas("video-game"),
	},
	{
		slug: "music",
		icon: "music",
		refreshIntervalDays: 180,
		occursAtProperties: ["publishDate"],
		propertiesSchema: musicPropertiesSchema,
		name: catalogMessage("entity-schema.music.name"),
		eventSchemas: mediaLifecycleEventSchemas("music"),
	},
	{
		icon: "book-heart",
		slug: "visual-novel",
		refreshIntervalDays: 180,
		occursAtProperties: ["publishDate"],
		propertiesSchema: visualNovelPropertiesSchema,
		name: catalogMessage("entity-schema.visual-novel.name"),
		eventSchemas: mediaLifecycleEventSchemas("visual-novel"),
	},
];
