import type { ApiPostRequestBody } from "#/lib/api/types";
import type { AppEventSchema } from "../event-schemas/model";

const lifecycleEventSlugs = [
	"backlog",
	"complete",
	"progress",
	"review",
] as const;

export type MediaSearchDoneAction = "track" | "log" | "backlog" | "rate";

export type MediaSearchLogDateOption = "now" | "unknown" | "custom" | "started";

type LifecycleEventSlug = (typeof lifecycleEventSlugs)[number];

type LifecycleEventSchemas = Record<LifecycleEventSlug, AppEventSchema>;

type CreateEventPayload = ApiPostRequestBody<"/events">;

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

export function createReviewEventPayload(input: {
	rating: number;
	review: string;
	entityId: string;
	eventSchemas: AppEventSchema[];
}): CreateEventPayload {
	const schemas = resolveLifecycleEventSchemas(input.eventSchemas);
	const rating = resolveRating(input.rating);
	const review = input.review.trim();

	return [
		{
			entityId: input.entityId,
			eventSchemaId: schemas.review.id,
			properties: review ? { rating, review } : { rating },
		},
	];
}

export function createLogEventPayload(input: {
	entityId: string;
	startedOn: string;
	completedOn: string;
	eventSchemas: AppEventSchema[];
	logDate: MediaSearchLogDateOption;
}): CreateEventPayload {
	const schemas = resolveLifecycleEventSchemas(input.eventSchemas);

	if (input.logDate === "started") {
		return [
			{
				entityId: input.entityId,
				eventSchemaId: schemas.progress.id,
				properties: { progressPercent: 1 },
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

	if (startedOn && new Date(startedOn) > new Date(completedOn)) {
		throw new Error("Started on must be before completed on");
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
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) {
		throw new Error(`${label} must be a valid date and time`);
	}

	return date.toISOString();
}
