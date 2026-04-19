import { dayjs } from "@ryot/ts-utils";
import type { ApiPostRequestBody } from "~/lib/api/types";
import type { AppEventSchema } from "../event-schemas/model";

const lifecycleEventSlugs = [
	"backlog",
	"complete",
	"progress",
	"review",
] as const;

export type MediaSearchDoneAction =
	| "track"
	| "log"
	| "backlog"
	| "rate"
	| "collection";

export type MediaSearchLogDateOption = "now" | "unknown" | "custom" | "started";

type LifecycleEventSlug = (typeof lifecycleEventSlugs)[number];

type LifecycleEventSchemas = Record<LifecycleEventSlug, AppEventSchema>;

type CreateEventPayload = ApiPostRequestBody<"/events">;

export type EpisodicEntitySchemaSlug = "show" | "anime" | "manga" | "podcast";

type EpisodicProgressFields = {
	showSeason?: number;
	showEpisode?: number;
	animeEpisode?: number;
	mangaChapter?: number;
	mangaVolume?: number;
	podcastEpisode?: number;
};

export function isEpisodicMediaEntitySchemaSlug(
	entitySchemaSlug: string,
): entitySchemaSlug is EpisodicEntitySchemaSlug {
	return ["show", "anime", "manga", "podcast"].includes(entitySchemaSlug);
}

export function getMediaDoneActionLabel(
	action: MediaSearchDoneAction,
	options?: { logDate: MediaSearchLogDateOption; rateStars: number },
) {
	if (action === "track") {
		return "Added";
	}
	if (action === "log") {
		return options?.logDate === "started" ? "Started" : "Logged";
	}
	if (action === "backlog") {
		return "In watchlist";
	}
	if (action === "collection") {
		return "In collection";
	}
	return options?.rateStars ? `Rated ${options.rateStars}/5` : "Rated";
}

export function getMediaLifecycleUnavailableMessage(
	eventSchemas: AppEventSchema[],
) {
	const missingSlugs = lifecycleEventSlugs.filter(
		(slug) => !eventSchemas.find((schema) => schema.slug === slug),
	);

	if (missingSlugs.length === 0) {
		return null;
	}

	return "Some actions are unavailable. Please check your event schemas configuration.";
}

export function createBacklogEventPayload(input: {
	entityId: string;
	eventSchemas: AppEventSchema[];
}): CreateEventPayload {
	const schemas = resolveLifecycleEventSchemas(input.eventSchemas);

	return [
		{
			properties: {},
			entityId: input.entityId,
			eventSchemaId: schemas.backlog.id,
		},
	];
}

export function createProgressEventPayload(input: {
	entityId: string;
	showSeason?: number;
	mangaVolume?: number;
	showEpisode?: number;
	animeEpisode?: number;
	mangaChapter?: number;
	podcastEpisode?: number;
	progressPercent: number;
	eventSchemas: AppEventSchema[];
}): CreateEventPayload {
	const schemas = resolveLifecycleEventSchemas(input.eventSchemas);

	return [
		{
			entityId: input.entityId,
			eventSchemaId: schemas.progress.id,
			properties: {
				progressPercent: input.progressPercent,
				...resolveProgressFields(input),
			},
		},
	];
}

export function createReviewEventPayload(input: {
	rating: number;
	review?: string;
	entityId: string;
	eventSchemas: AppEventSchema[];
}): CreateEventPayload {
	const reviewSchema = input.eventSchemas.find((s) => s.slug === "review");
	if (!reviewSchema) {
		throw new Error(
			"Review event schema is unavailable. Please check your event schemas configuration.",
		);
	}
	const rating = resolveRating(input.rating);
	const review = input.review?.trim();

	return [
		{
			entityId: input.entityId,
			eventSchemaId: reviewSchema.id,
			properties: review ? { rating, review } : { rating },
		},
	];
}

export function createLogEventPayload(input: {
	entityId: string;
	startedOn: string;
	completedOn: string;
	showSeason?: number;
	mangaVolume?: number;
	showEpisode?: number;
	animeEpisode?: number;
	mangaChapter?: number;
	podcastEpisode?: number;
	entitySchemaSlug: string;
	eventSchemas: AppEventSchema[];
	logDate: MediaSearchLogDateOption;
}): CreateEventPayload {
	const schemas = resolveLifecycleEventSchemas(input.eventSchemas);
	const isEpisodic = isEpisodicMediaEntitySchemaSlug(input.entitySchemaSlug);
	const progressFields = resolveProgressFields(input);

	if (input.logDate === "started") {
		return [
			{
				entityId: input.entityId,
				eventSchemaId: schemas.progress.id,
				properties: { progressPercent: 1, ...progressFields },
			},
		];
	}

	if (isEpisodic && input.logDate === "now") {
		return [
			{
				entityId: input.entityId,
				eventSchemaId: schemas.progress.id,
				properties: { progressPercent: 100, ...progressFields },
			},
		];
	}

	if (input.logDate === "now") {
		return [
			{
				entityId: input.entityId,
				eventSchemaId: schemas.complete.id,
				properties: { completionMode: "just_now" },
			},
		];
	}

	if (isEpisodic && input.logDate === "unknown") {
		return [
			{
				entityId: input.entityId,
				eventSchemaId: schemas.progress.id,
				properties: { progressPercent: 100, ...progressFields },
			},
		];
	}

	if (input.logDate === "unknown") {
		return [
			{
				entityId: input.entityId,
				eventSchemaId: schemas.complete.id,
				properties: { completionMode: "unknown" },
			},
		];
	}

	const completedOn = resolveIsoDateTime(input.completedOn, "Completed on");
	const startedOn = resolveOptionalIsoDateTime(input.startedOn, "Started on");

	if (startedOn && dayjs(startedOn).isAfter(dayjs(completedOn))) {
		throw new Error("Started on must be before completed on");
	}

	if (isEpisodic) {
		return [
			{
				entityId: input.entityId,
				eventSchemaId: schemas.progress.id,
				properties: { progressPercent: 100, ...progressFields },
			},
		];
	}

	return [
		{
			entityId: input.entityId,
			eventSchemaId: schemas.complete.id,
			properties: startedOn
				? {
						startedOn,
						completedOn,
						completionMode: "custom_timestamps",
					}
				: {
						completedOn,
						completionMode: "custom_timestamps",
					},
		},
	];
}

function resolveLifecycleEventSchemas(eventSchemas: AppEventSchema[]) {
	const schemas = Object.fromEntries(
		lifecycleEventSlugs.map((slug) => [
			slug,
			eventSchemas.find((schema) => schema.slug === slug),
		]),
	) as Partial<LifecycleEventSchemas>;

	const missingSlugs = lifecycleEventSlugs.filter((slug) => !schemas[slug]);
	if (missingSlugs.length > 0) {
		throw new Error(getMediaLifecycleUnavailableMessage(eventSchemas) ?? "");
	}

	return schemas as LifecycleEventSchemas;
}

function resolveProgressFields(input: EpisodicProgressFields) {
	return Object.fromEntries(
		Object.entries({
			showSeason: input.showSeason,
			showEpisode: input.showEpisode,
			mangaVolume: input.mangaVolume,
			animeEpisode: input.animeEpisode,
			mangaChapter: input.mangaChapter,
			podcastEpisode: input.podcastEpisode,
		}).filter(([, value]) => value !== undefined),
	);
}

function resolveRating(value: number) {
	if (!Number.isInteger(value) || value < 1 || value > 5) {
		throw new Error("Rating must be an integer from 1 to 5");
	}

	return value;
}

function resolveOptionalIsoDateTime(value: string, label: string) {
	const trimmed = value.trim();
	if (!trimmed) {
		return undefined;
	}

	return resolveIsoDateTime(trimmed, label);
}

function resolveIsoDateTime(value: string, label: string) {
	const parsed = dayjs(value);
	if (!parsed.isValid()) {
		throw new Error(`${label} must be a valid date and time`);
	}

	return parsed.toISOString();
}
