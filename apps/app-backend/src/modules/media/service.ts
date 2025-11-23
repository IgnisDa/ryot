import { dayjs } from "@ryot/ts-utils/dayjs";
import { getQueryEngineField } from "@ryot/ts-utils/query-engine";

import {
	type BuiltinMediaEntitySchemaSlug,
	builtinMediaEntitySchemaSlugSet,
	builtinMediaEntitySchemaSlugs,
	builtinMediaEventSchemaSlugs,
} from "~/lib/media/constants";
import { serviceData, serviceError } from "~/lib/result";
import { QueryEngineNotFoundError, QueryEngineValidationError } from "~/lib/views/errors";
import {
	type AggregateQueryEngineRequest,
	type EntityQueryEngineRequest,
	type EventsQueryEngineRequest,
	prepareAndExecute,
	type QueryEngineItem,
	type QueryEngineRequest,
	type QueryEngineResponse,
	type TimeSeriesQueryEngineRequest,
} from "~/modules/query-engine";

import {
	type BuiltInMediaOverviewSourceItem,
	buildContinueSectionResponse,
	buildRateTheseSectionResponse,
	buildRecentActivitySectionResponse,
	buildUpNextSectionResponse,
	buildWeekActivitySectionResponse,
	type ContinueSourceItem,
	type RateTheseSourceItem,
	type RecentActivitySourceItem,
	type UpNextSourceItem,
} from "./response-builder";

const mediaOverviewMisconfiguredError = "Built-in media overview configuration is invalid";

const SECTION_LIMITS = { upNext: 6, continue: 6, rateThese: 6, activity: 12 };

const computedFieldExpression = (key: string) => ({
	type: "reference" as const,
	reference: { key, type: "computed-field" as const },
});

const entityColumnExpression = (slug: string, column: "createdAt" | "id" | "name" | "image") => ({
	type: "reference" as const,
	reference: { slug, path: [column], type: "entity" as const },
});

const entityPropertyExpression = (slug: string, property: string) => ({
	type: "reference" as const,
	reference: { slug, path: ["properties", property], type: "entity" as const },
});

const eventJoinColumnExpression = (joinKey: string, column: "createdAt" | "id" | "occurredAt") => ({
	type: "reference" as const,
	reference: { joinKey, path: [column], type: "event-join" as const },
});

const eventJoinPropertyExpression = (joinKey: string, property: string) => ({
	type: "reference" as const,
	reference: {
		joinKey,
		type: "event-join" as const,
		path: ["properties", property],
	},
});

const lifecycleComparisonPredicate = (
	left: ReturnType<typeof eventJoinColumnExpression>,
	right: ReturnType<typeof eventJoinColumnExpression>,
) => ({
	type: "or" as const,
	predicates: [
		{ type: "isNull" as const, expression: right },
		{ left, right, operator: "gt" as const, type: "comparison" as const },
		{
			type: "and" as const,
			predicates: [
				{ left, right, operator: "eq" as const, type: "comparison" as const },
				{
					left: eventJoinColumnExpression(left.reference.joinKey, "createdAt"),
					right: eventJoinColumnExpression(right.reference.joinKey, "createdAt"),
					operator: "gt" as const,
					type: "comparison" as const,
				},
			],
		},
		{
			type: "and" as const,
			predicates: [
				{ left, right, operator: "eq" as const, type: "comparison" as const },
				{
					left: eventJoinColumnExpression(left.reference.joinKey, "createdAt"),
					right: eventJoinColumnExpression(right.reference.joinKey, "createdAt"),
					operator: "eq" as const,
					type: "comparison" as const,
				},
				{
					left: eventJoinColumnExpression(left.reference.joinKey, "id"),
					right: eventJoinColumnExpression(right.reference.joinKey, "id"),
					operator: "gt" as const,
					type: "comparison" as const,
				},
			],
		},
	],
});

const entitySchemaExpression = (column: string) => ({
	type: "reference" as const,
	reference: { type: "entity-schema" as const, path: [column] },
});

const eventColumnExpression = (column: "createdAt" | "id" | "occurredAt") => ({
	type: "reference" as const,
	reference: { type: "event" as const, path: [column] },
});

const eventPropertyExpression = (eventSchemaSlug: string, property: string) => ({
	type: "reference" as const,
	reference: {
		eventSchemaSlug,
		type: "event" as const,
		path: ["properties", property],
	},
});

const eventSchemaColumnExpression = (column: string) => ({
	type: "reference" as const,
	reference: { type: "event-schema" as const, path: [column] },
});

const coalesceExpression = (
	...values: Array<
		| ReturnType<typeof entityColumnExpression>
		| ReturnType<typeof computedFieldExpression>
		| ReturnType<typeof entityPropertyExpression>
		| ReturnType<typeof eventJoinColumnExpression>
		| ReturnType<typeof eventJoinPropertyExpression>
	>
) => ({ values, type: "coalesce" as const });

const mediaEntityColumnExpression = (column: "createdAt" | "id" | "name" | "image") =>
	coalesceExpression(
		...builtinMediaEntitySchemaSlugs.map((slug) => entityColumnExpression(slug, column)),
	);

const getFieldValue = (item: QueryEngineItem, key: string) => getQueryEngineField(item, key)?.value;

const toNullableNumber = (value: unknown) => {
	if (typeof value === "number" && Number.isFinite(value)) {
		return value;
	}
	if (typeof value === "string" && value.trim().length > 0) {
		const parsed = Number(value);
		return Number.isFinite(parsed) ? parsed : null;
	}

	return null;
};

const toNullableDate = (value: unknown): Date | null => {
	if (value instanceof Date) {
		return dayjs(value).isValid() ? value : null;
	}
	if (typeof value === "string") {
		const parsed = dayjs(value);
		return parsed.isValid() ? parsed.toDate() : null;
	}

	return null;
};

const toBuiltinMediaSourceItem = (item: QueryEngineItem): BuiltInMediaOverviewSourceItem | null => {
	const slug = getFieldValue(item, "entitySchemaSlug");
	if (typeof slug !== "string" || !isBuiltInMediaEntitySchemaSlug(slug)) {
		return null;
	}
	const entityId = getFieldValue(item, "entityId");
	const entityName = getFieldValue(item, "entityName");
	if (typeof entityId !== "string" || typeof entityName !== "string") {
		return null;
	}

	return {
		id: entityId,
		title: entityName,
		entitySchemaSlug: slug,
		reviewAt: toNullableDate(getFieldValue(item, "reviewAt")),
		image: toNullableImage(getFieldValue(item, "entityImage")),
		backlogAt: toNullableDate(getFieldValue(item, "backlogAt")),
		progressAt: toNullableDate(getFieldValue(item, "progressAt")),
		completeAt: toNullableDate(getFieldValue(item, "completeAt")),
		totalUnits: toNullableNumber(getFieldValue(item, "totalUnits")),
		publishYear: toNullableNumber(getFieldValue(item, "publishYear")),
		reviewRating: toNullableNumber(getFieldValue(item, "reviewRating")),
		progressPercent: toNullableNumber(getFieldValue(item, "progressPercent")),
	};
};

function isBuiltInMediaEntitySchemaSlug(
	value: string,
): value is BuiltInMediaOverviewSourceItem["entitySchemaSlug"] {
	return builtinMediaEntitySchemaSlugSet.has(
		// oxlint-disable-next-line no-unsafe-type-assertion
		value as BuiltInMediaOverviewSourceItem["entitySchemaSlug"],
	);
}

const toNullableImage = (value: unknown): BuiltInMediaOverviewSourceItem["image"] => {
	if (!value || typeof value !== "object") {
		return null;
	}
	if ("type" in value && value.type === "s3" && "key" in value) {
		return typeof value.key === "string" ? { type: "s3", key: value.key } : null;
	}
	if ("type" in value && value.type === "remote" && "url" in value) {
		return typeof value.url === "string" ? { type: "remote", url: value.url } : null;
	}

	return null;
};

const buildBaseRequest = (): Omit<EntityQueryEngineRequest, "filter" | "pagination" | "sort"> => {
	const entityCreatedAt = mediaEntityColumnExpression("createdAt");
	const publishYear = coalesceExpression(
		entityPropertyExpression("book", "publishYear"),
		entityPropertyExpression("show", "publishYear"),
		entityPropertyExpression("movie", "publishYear"),
		entityPropertyExpression("comic-book", "publishYear"),
		entityPropertyExpression("anime", "publishYear"),
		entityPropertyExpression("manga", "publishYear"),
		entityPropertyExpression("audiobook", "publishYear"),
		entityPropertyExpression("podcast", "publishYear"),
		entityPropertyExpression("music", "publishYear"),
	);
	const totalUnits = coalesceExpression(
		entityPropertyExpression("book", "pages"),
		entityPropertyExpression("comic-book", "pages"),
		entityPropertyExpression("anime", "episodes"),
		entityPropertyExpression("manga", "chapters"),
		entityPropertyExpression("audiobook", "runtime"),
		entityPropertyExpression("podcast", "totalEpisodes"),
		entityPropertyExpression("music", "duration"),
	);

	return {
		mode: "entities",
		scope: [...builtinMediaEntitySchemaSlugs],
		relationshipJoins: [
			{
				required: true,
				key: "inLibrary",
				direction: "outgoing",
				kind: "latestRelationship",
				relationshipSchemaSlug: "in-library",
			},
		],
		eventJoins: [...mediaLifecycleEventJoins],
		computedFields: [
			{ key: "totalUnits", expression: totalUnits },
			{ key: "publishYear", expression: publishYear },
			{ key: "entityCreatedAt", expression: entityCreatedAt },
		],
		fields: [
			{ key: "entityId", expression: mediaEntityColumnExpression("id") },
			{
				key: "entityName",
				expression: mediaEntityColumnExpression("name"),
			},
			{
				key: "entityImage",
				expression: mediaEntityColumnExpression("image"),
			},
			{
				key: "entitySchemaSlug",
				expression: entitySchemaExpression("slug"),
			},
			{
				key: "publishYear",
				expression: computedFieldExpression("publishYear"),
			},
			{ key: "totalUnits", expression: computedFieldExpression("totalUnits") },
			{
				key: "backlogAt",
				expression: eventJoinColumnExpression("backlog", "occurredAt"),
			},
			{
				key: "progressAt",
				expression: eventJoinColumnExpression("progress", "occurredAt"),
			},
			{
				key: "completeAt",
				expression: eventJoinColumnExpression("complete", "occurredAt"),
			},
			{
				key: "reviewAt",
				expression: eventJoinColumnExpression("review", "occurredAt"),
			},
			{
				key: "reviewRating",
				expression: eventJoinPropertyExpression("review", "rating"),
			},
			{
				key: "progressPercent",
				expression: eventJoinPropertyExpression("progress", "progressPercent"),
			},
		],
	};
};

type ExecuteQuery = (userId: string, request: QueryEngineRequest) => Promise<QueryEngineResponse>;

type MediaServiceDeps = { executeQuery: ExecuteQuery };

const defaultDeps: MediaServiceDeps = {
	executeQuery: (userId, request) => prepareAndExecute({ userId, request }),
};

const requireEntitiesResult = (result: QueryEngineResponse) => {
	if (result.mode !== "entities") {
		throw new Error("Expected entity-mode query engine response");
	}
	return result.data;
};

export const getContinueItems = async (userId: string, deps: MediaServiceDeps = defaultDeps) => {
	const progressAtRef = eventJoinColumnExpression("progress", "occurredAt");
	const completeAtRef = eventJoinColumnExpression("complete", "occurredAt");
	const backlogAtRef = eventJoinColumnExpression("backlog", "occurredAt");
	const droppedAtRef = eventJoinColumnExpression("dropped", "occurredAt");
	const onHoldAtRef = eventJoinColumnExpression("on_hold", "occurredAt");

	const filter = {
		type: "and" as const,
		predicates: [
			{ expression: progressAtRef, type: "isNotNull" as const },
			lifecycleComparisonPredicate(progressAtRef, backlogAtRef),
			lifecycleComparisonPredicate(progressAtRef, completeAtRef),
			lifecycleComparisonPredicate(progressAtRef, droppedAtRef),
			lifecycleComparisonPredicate(progressAtRef, onHoldAtRef),
		],
	};

	const request: EntityQueryEngineRequest = {
		...buildBaseRequest(),
		filter,
		sort: { direction: "desc", expression: progressAtRef },
		pagination: { page: 1, limit: SECTION_LIMITS.continue },
	};

	try {
		const result = requireEntitiesResult(await deps.executeQuery(userId, request));
		const items = result.items.flatMap((item) => {
			const mapped = toBuiltinMediaSourceItem(item);
			if (mapped?.progressAt) {
				// oxlint-disable-next-line no-unsafe-type-assertion
				return [mapped as ContinueSourceItem];
			}
			return [];
		});
		return serviceData(buildContinueSectionResponse(items));
	} catch (error) {
		if (error instanceof QueryEngineNotFoundError) {
			return serviceError("not_found", mediaOverviewMisconfiguredError);
		}
		if (error instanceof QueryEngineValidationError) {
			return serviceError("validation", mediaOverviewMisconfiguredError);
		}
		throw error;
	}
};

export const getUpNextItems = async (userId: string, deps: MediaServiceDeps = defaultDeps) => {
	const backlogAtRef = eventJoinColumnExpression("backlog", "occurredAt");
	const completeAtRef = eventJoinColumnExpression("complete", "occurredAt");
	const progressAtRef = eventJoinColumnExpression("progress", "occurredAt");
	const droppedAtRef = eventJoinColumnExpression("dropped", "occurredAt");
	const onHoldAtRef = eventJoinColumnExpression("on_hold", "occurredAt");

	const filter = {
		type: "and" as const,
		predicates: [
			{ expression: backlogAtRef, type: "isNotNull" as const },
			lifecycleComparisonPredicate(backlogAtRef, progressAtRef),
			lifecycleComparisonPredicate(backlogAtRef, completeAtRef),
			lifecycleComparisonPredicate(backlogAtRef, droppedAtRef),
			lifecycleComparisonPredicate(backlogAtRef, onHoldAtRef),
		],
	};

	const request: EntityQueryEngineRequest = {
		...buildBaseRequest(),
		filter,
		sort: { direction: "desc", expression: backlogAtRef },
		pagination: { page: 1, limit: SECTION_LIMITS.upNext },
	};

	try {
		const result = requireEntitiesResult(await deps.executeQuery(userId, request));
		const items = result.items.flatMap((item) => {
			const mapped = toBuiltinMediaSourceItem(item);
			if (mapped?.backlogAt) {
				// oxlint-disable-next-line no-unsafe-type-assertion
				return [mapped as UpNextSourceItem];
			}
			return [];
		});
		return serviceData(buildUpNextSectionResponse(items));
	} catch (error) {
		if (error instanceof QueryEngineNotFoundError) {
			return serviceError("not_found", mediaOverviewMisconfiguredError);
		}
		if (error instanceof QueryEngineValidationError) {
			return serviceError("validation", mediaOverviewMisconfiguredError);
		}
		throw error;
	}
};

export const getRateTheseItems = async (userId: string, deps: MediaServiceDeps = defaultDeps) => {
	const completeAtRef = eventJoinColumnExpression("complete", "occurredAt");
	const reviewAtRef = eventJoinColumnExpression("review", "occurredAt");
	const backlogAtRef = eventJoinColumnExpression("backlog", "occurredAt");
	const progressAtRef = eventJoinColumnExpression("progress", "occurredAt");
	const droppedAtRef = eventJoinColumnExpression("dropped", "occurredAt");
	const onHoldAtRef = eventJoinColumnExpression("on_hold", "occurredAt");

	const filter = {
		type: "and" as const,
		predicates: [
			{ expression: completeAtRef, type: "isNotNull" as const },
			lifecycleComparisonPredicate(completeAtRef, backlogAtRef),
			lifecycleComparisonPredicate(completeAtRef, progressAtRef),
			lifecycleComparisonPredicate(completeAtRef, droppedAtRef),
			lifecycleComparisonPredicate(completeAtRef, onHoldAtRef),
			lifecycleComparisonPredicate(completeAtRef, reviewAtRef),
		],
	};

	const request: EntityQueryEngineRequest = {
		...buildBaseRequest(),
		filter,
		pagination: { page: 1, limit: SECTION_LIMITS.rateThese },
		sort: { direction: "desc", expression: completeAtRef },
	};

	try {
		const result = requireEntitiesResult(await deps.executeQuery(userId, request));
		const items = result.items.flatMap((item) => {
			const mapped = toBuiltinMediaSourceItem(item);
			if (mapped?.completeAt) {
				// oxlint-disable-next-line no-unsafe-type-assertion
				return [mapped as RateTheseSourceItem];
			}
			return [];
		});
		return serviceData(buildRateTheseSectionResponse(items));
	} catch (error) {
		if (error instanceof QueryEngineNotFoundError) {
			return serviceError("not_found", mediaOverviewMisconfiguredError);
		}
		if (error instanceof QueryEngineValidationError) {
			return serviceError("validation", mediaOverviewMisconfiguredError);
		}
		throw error;
	}
};

const toRecentActivitySourceItem = (item: QueryEngineItem): RecentActivitySourceItem | null => {
	const eventId = getFieldValue(item, "eventId");
	const entityId = getFieldValue(item, "entityId");
	const entityName = getFieldValue(item, "entityName");
	const eventSchemaSlug = getFieldValue(item, "eventSchemaSlug");
	const entitySchemaSlug = getFieldValue(item, "entitySchemaSlug");

	if (
		typeof eventId !== "string" ||
		typeof entityId !== "string" ||
		typeof entityName !== "string" ||
		typeof eventSchemaSlug !== "string" ||
		typeof entitySchemaSlug !== "string"
	) {
		return null;
	}

	if (
		!builtinMediaEventSchemaSlugs.includes(
			// oxlint-disable-next-line no-unsafe-type-assertion
			eventSchemaSlug as (typeof builtinMediaEventSchemaSlugs)[number],
		) ||
		!isBuiltInMediaEntitySchemaSlug(entitySchemaSlug)
	) {
		return null;
	}

	const occurredAt = toNullableDate(getFieldValue(item, "eventOccurredAt"));
	if (!occurredAt) {
		return null;
	}

	return {
		entityId,
		occurredAt,
		id: eventId,
		rating: toNullableNumber(getFieldValue(item, "eventRating")),
		// oxlint-disable-next-line no-unsafe-type-assertion
		eventSchemaSlug: eventSchemaSlug as (typeof builtinMediaEventSchemaSlugs)[number],
		entity: {
			name: entityName,
			entitySchemaSlug,
			image: toNullableImage(getFieldValue(item, "entityImage")),
		},
	};
};

export const getRecentActivityItems = async (
	userId: string,
	deps: MediaServiceDeps = defaultDeps,
) => {
	const request: EventsQueryEngineRequest = {
		mode: "events",
		filter: null,
		eventJoins: [],
		computedFields: [],
		scope: [...builtinMediaEntitySchemaSlugs],
		eventSchemas: [...builtinMediaEventSchemaSlugs],
		pagination: { page: 1, limit: SECTION_LIMITS.activity },
		sort: { direction: "desc", expression: eventColumnExpression("occurredAt") },
		fields: [
			{ key: "eventId", expression: eventColumnExpression("id") },
			{ key: "eventOccurredAt", expression: eventColumnExpression("occurredAt") },
			{
				key: "eventSchemaSlug",
				expression: eventSchemaColumnExpression("slug"),
			},
			{
				key: "eventRating",
				expression: eventPropertyExpression("review", "rating"),
			},
			{ key: "entityId", expression: mediaEntityColumnExpression("id") },
			{ key: "entityName", expression: mediaEntityColumnExpression("name") },
			{ key: "entityImage", expression: mediaEntityColumnExpression("image") },
			{ key: "entitySchemaSlug", expression: entitySchemaExpression("slug") },
		],
	};

	try {
		const result = await deps.executeQuery(userId, request);
		if (result.mode !== "events") {
			throw new Error("Expected events-mode query engine response");
		}
		const items = result.data.items.flatMap((item) => {
			const mapped = toRecentActivitySourceItem(item);
			return mapped ? [mapped] : [];
		});
		return serviceData(buildRecentActivitySectionResponse(items));
	} catch (error) {
		if (error instanceof QueryEngineNotFoundError) {
			return serviceError("not_found", mediaOverviewMisconfiguredError);
		}
		if (error instanceof QueryEngineValidationError) {
			return serviceError("validation", mediaOverviewMisconfiguredError);
		}
		throw error;
	}
};

const getCurrentWeekRange = (now = dayjs().toDate()) => {
	const startAt = dayjs.utc(now).startOf("isoWeek");
	const endAt = startAt.add(7, "day");

	return { endAt: endAt.toISOString(), startAt: startAt.toISOString() };
};

export const getWeekActivity = async (userId: string, deps: MediaServiceDeps = defaultDeps) => {
	const { startAt, endAt } = getCurrentWeekRange();

	const request: TimeSeriesQueryEngineRequest = {
		filter: null,
		bucket: "day",
		computedFields: [],
		mode: "timeSeries",
		metric: { type: "count" },
		dateRange: { startAt, endAt },
		scope: [...builtinMediaEntitySchemaSlugs],
		eventSchemas: [...builtinMediaEventSchemaSlugs],
	};

	try {
		const result = await deps.executeQuery(userId, request);
		if (result.mode !== "timeSeries") {
			throw new Error("Expected timeSeries-mode query engine response");
		}
		const items = result.data.buckets.map((bucket) => ({
			date: dayjs.utc(bucket.date).toDate(),
			count: bucket.value,
		}));
		return serviceData(buildWeekActivitySectionResponse({ items }));
	} catch (error) {
		if (error instanceof QueryEngineNotFoundError) {
			return serviceError("not_found", mediaOverviewMisconfiguredError);
		}
		if (error instanceof QueryEngineValidationError) {
			return serviceError("validation", mediaOverviewMisconfiguredError);
		}
		throw error;
	}
};

const mediaLifecycleEventJoins: AggregateQueryEngineRequest["eventJoins"] = [
	{ key: "review", kind: "latestEvent", eventSchemaSlug: "review" },
	{ key: "backlog", kind: "latestEvent", eventSchemaSlug: "backlog" },
	{ key: "progress", kind: "latestEvent", eventSchemaSlug: "progress" },
	{ key: "complete", kind: "latestEvent", eventSchemaSlug: "complete" },
	{ key: "dropped", kind: "latestEvent", eventSchemaSlug: "dropped" },
	{ key: "on_hold", kind: "latestEvent", eventSchemaSlug: "on_hold" },
];

const backlogAtRef = eventJoinColumnExpression("backlog", "occurredAt");
const progressAtRef = eventJoinColumnExpression("progress", "occurredAt");
const completeAtRef = eventJoinColumnExpression("complete", "occurredAt");
const droppedAtRef = eventJoinColumnExpression("dropped", "occurredAt");
const onHoldAtRef = eventJoinColumnExpression("on_hold", "occurredAt");

const inBacklogPredicate = {
	type: "and" as const,
	predicates: [
		{ type: "isNotNull" as const, expression: backlogAtRef },
		lifecycleComparisonPredicate(backlogAtRef, progressAtRef),
		lifecycleComparisonPredicate(backlogAtRef, completeAtRef),
		lifecycleComparisonPredicate(backlogAtRef, droppedAtRef),
		lifecycleComparisonPredicate(backlogAtRef, onHoldAtRef),
	],
};

const inProgressPredicate = {
	type: "and" as const,
	predicates: [
		{ type: "isNotNull" as const, expression: progressAtRef },
		lifecycleComparisonPredicate(progressAtRef, backlogAtRef),
		lifecycleComparisonPredicate(progressAtRef, completeAtRef),
		lifecycleComparisonPredicate(progressAtRef, droppedAtRef),
		lifecycleComparisonPredicate(progressAtRef, onHoldAtRef),
	],
};

const completedPredicate = {
	type: "and" as const,
	predicates: [
		{ type: "isNotNull" as const, expression: completeAtRef },
		lifecycleComparisonPredicate(completeAtRef, backlogAtRef),
		lifecycleComparisonPredicate(completeAtRef, progressAtRef),
		lifecycleComparisonPredicate(completeAtRef, droppedAtRef),
		lifecycleComparisonPredicate(completeAtRef, onHoldAtRef),
	],
};

export const getLibraryStats = async (userId: string, deps: MediaServiceDeps = defaultDeps) => {
	const request: AggregateQueryEngineRequest = {
		filter: null,
		mode: "aggregate",
		computedFields: [],
		eventJoins: mediaLifecycleEventJoins,
		scope: [...builtinMediaEntitySchemaSlugs],
		relationshipJoins: [
			{
				required: true,
				key: "inLibrary",
				direction: "outgoing",
				kind: "latestRelationship",
				relationshipSchemaSlug: "in-library",
			},
		],
		aggregations: [
			{ key: "total", aggregation: { type: "count" } },
			{
				key: "inBacklog",
				aggregation: { type: "countWhere", predicate: inBacklogPredicate },
			},
			{
				key: "inProgress",
				aggregation: { type: "countWhere", predicate: inProgressPredicate },
			},
			{
				key: "completed",
				aggregation: { type: "countWhere", predicate: completedPredicate },
			},
			{
				key: "bySchema",
				aggregation: { type: "countBy", groupBy: entitySchemaExpression("slug") },
			},
			{
				key: "avgRating",
				aggregation: {
					type: "avg",
					expression: eventJoinPropertyExpression("review", "rating"),
				},
			},
		],
	};

	try {
		const result = await deps.executeQuery(userId, request);
		if (result.mode !== "aggregate") {
			throw new Error("Expected aggregate-mode query engine response");
		}

		const findValue = (key: string) => result.data.values.find((v) => v.key === key)?.value;

		const bySchemaRaw = findValue("bySchema");
		const total = toNullableNumber(findValue("total")) ?? 0;
		const avgRating = toNullableNumber(findValue("avgRating"));
		const inBacklog = toNullableNumber(findValue("inBacklog")) ?? 0;
		const completed = toNullableNumber(findValue("completed")) ?? 0;
		const inProgress = toNullableNumber(findValue("inProgress")) ?? 0;
		const entityTypeCounts =
			bySchemaRaw && typeof bySchemaRaw === "object"
				? // oxlint-disable-next-line no-unsafe-type-assertion
					(Object.fromEntries(
						Object.entries(bySchemaRaw).flatMap(([key, val]) => {
							const count = toNullableNumber(val);
							if (count === null || !isBuiltInMediaEntitySchemaSlug(key)) {
								return [];
							}
							return [[key, count]];
						}),
					) as Record<BuiltinMediaEntitySchemaSlug, number>)
				: // oxlint-disable-next-line no-unsafe-type-assertion
					({} as Record<BuiltinMediaEntitySchemaSlug, number>);

		return serviceData({
			total,
			inBacklog,
			completed,
			avgRating,
			inProgress,
			entityTypeCounts,
		});
	} catch (error) {
		if (error instanceof QueryEngineNotFoundError) {
			return serviceError("not_found", mediaOverviewMisconfiguredError);
		}
		if (error instanceof QueryEngineValidationError) {
			return serviceError("validation", mediaOverviewMisconfiguredError);
		}
		throw error;
	}
};
