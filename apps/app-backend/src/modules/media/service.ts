import { dayjs } from "@ryot/ts-utils";
import {
	builtinMediaEntitySchemaSlugSet,
	builtinMediaEntitySchemaSlugs,
} from "~/lib/media/constants";
import { serviceData, serviceError } from "~/lib/result";
import {
	QueryEngineNotFoundError,
	QueryEngineValidationError,
} from "~/lib/views/errors";
import {
	prepareAndExecute,
	type QueryEngineRequest,
	type QueryEngineResponseData,
} from "~/modules/query-engine";
import {
	listRecentActivityEventsForUser,
	listWeekActivityEventsForUser,
} from "./repository";
import {
	type BuiltInMediaOverviewSourceItem,
	buildContinueSectionResponse,
	buildRateTheseSectionResponse,
	buildRecentActivitySectionResponse,
	buildUpNextSectionResponse,
	buildWeekActivitySectionResponse,
	type ContinueSourceItem,
	type RateTheseSourceItem,
	type UpNextSourceItem,
} from "./response-builder";

const mediaOverviewMisconfiguredError =
	"Built-in media overview configuration is invalid";

const SECTION_LIMITS = { upNext: 6, continue: 6, rateThese: 6, activity: 12 };

const literalExpression = (value: unknown) => ({
	value,
	type: "literal" as const,
});

const computedFieldExpression = (key: string) => ({
	type: "reference" as const,
	reference: { key, type: "computed-field" as const },
});

const entityColumnExpression = (slug: string, column: "createdAt") => ({
	type: "reference" as const,
	reference: { slug, path: [column], type: "entity" as const },
});

const entityPropertyExpression = (slug: string, property: string) => ({
	type: "reference" as const,
	reference: { slug, path: ["properties", property], type: "entity" as const },
});

const eventJoinColumnExpression = (joinKey: string, column: "createdAt") => ({
	type: "reference" as const,
	reference: { joinKey, path: [column], type: "event" as const },
});

const eventJoinPropertyExpression = (joinKey: string, property: string) => ({
	type: "reference" as const,
	reference: {
		joinKey,
		type: "event" as const,
		path: ["properties", property],
	},
});

const coalesceExpression = (
	...values: Array<
		| ReturnType<typeof literalExpression>
		| ReturnType<typeof entityColumnExpression>
		| ReturnType<typeof computedFieldExpression>
		| ReturnType<typeof entityPropertyExpression>
		| ReturnType<typeof eventJoinColumnExpression>
		| ReturnType<typeof eventJoinPropertyExpression>
	>
) => ({ values, type: "coalesce" as const });

const getFieldValue = (
	item: QueryEngineResponseData["items"][number],
	key: string,
) => item.fields.find((field) => field.key === key)?.value;

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

const toBuiltinMediaSourceItem = (
	item: QueryEngineResponseData["items"][number],
): BuiltInMediaOverviewSourceItem | null => {
	if (!isBuiltInMediaEntitySchemaSlug(item.entitySchemaSlug)) {
		return null;
	}

	return {
		id: item.id,
		title: item.name,
		image: item.image,
		entitySchemaSlug: item.entitySchemaSlug,
		reviewAt: toNullableDate(getFieldValue(item, "reviewAt")),
		backlogAt: toNullableDate(getFieldValue(item, "backlogAt")),
		progressAt: toNullableDate(getFieldValue(item, "progressAt")),
		completeAt: toNullableDate(getFieldValue(item, "completeAt")),
		completedOn: toNullableDate(getFieldValue(item, "completedOn")),
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
		value as BuiltInMediaOverviewSourceItem["entitySchemaSlug"],
	);
}

const buildBaseRequest = (): Omit<
	QueryEngineRequest,
	"filter" | "pagination" | "sort"
> => {
	const entityCreatedAt = coalesceExpression(
		entityColumnExpression("book", "createdAt"),
		entityColumnExpression("show", "createdAt"),
		entityColumnExpression("movie", "createdAt"),
		entityColumnExpression("comic-book", "createdAt"),
		entityColumnExpression("anime", "createdAt"),
		entityColumnExpression("manga", "createdAt"),
		entityColumnExpression("audiobook", "createdAt"),
		entityColumnExpression("podcast", "createdAt"),
		entityColumnExpression("music", "createdAt"),
	);
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
		entitySchemaSlugs: [...builtinMediaEntitySchemaSlugs],
		eventJoins: [
			{ key: "review", kind: "latestEvent", eventSchemaSlug: "review" },
			{ key: "backlog", kind: "latestEvent", eventSchemaSlug: "backlog" },
			{ key: "progress", kind: "latestEvent", eventSchemaSlug: "progress" },
			{ key: "complete", kind: "latestEvent", eventSchemaSlug: "complete" },
		],
		computedFields: [
			{ key: "totalUnits", expression: totalUnits },
			{ key: "publishYear", expression: publishYear },
			{ key: "entityCreatedAt", expression: entityCreatedAt },
		],
		fields: [
			{
				key: "publishYear",
				expression: computedFieldExpression("publishYear"),
			},
			{ key: "totalUnits", expression: computedFieldExpression("totalUnits") },
			{
				key: "backlogAt",
				expression: eventJoinColumnExpression("backlog", "createdAt"),
			},
			{
				key: "progressAt",
				expression: eventJoinColumnExpression("progress", "createdAt"),
			},
			{
				key: "completeAt",
				expression: eventJoinColumnExpression("complete", "createdAt"),
			},
			{
				key: "completedOn",
				expression: eventJoinPropertyExpression("complete", "completedOn"),
			},
			{
				key: "reviewAt",
				expression: eventJoinColumnExpression("review", "createdAt"),
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

type ExecuteSectionQuery = (
	userId: string,
	request: QueryEngineRequest,
) => Promise<QueryEngineResponseData>;

type MediaServiceDeps = {
	executeSectionQuery: ExecuteSectionQuery;
	listWeekActivityEventsForUser?: typeof listWeekActivityEventsForUser;
	listRecentActivityEventsForUser?: typeof listRecentActivityEventsForUser;
};

const defaultDeps: MediaServiceDeps = {
	listWeekActivityEventsForUser,
	listRecentActivityEventsForUser,
	executeSectionQuery: (userId, request) =>
		prepareAndExecute({ userId, request }),
};

const getDateKey = (date: Date) => dayjs.utc(date).format("YYYY-MM-DD");

const getCurrentWeekRange = (now = dayjs().toDate()) => {
	const startAt = dayjs.utc(now).startOf("isoWeek");
	const endAt = startAt.add(7, "day");

	return { startAt: startAt.toDate(), endAt: endAt.toDate() };
};

export const getContinueItems = async (
	userId: string,
	deps: MediaServiceDeps = defaultDeps,
) => {
	const progressAtRef = eventJoinColumnExpression("progress", "createdAt");
	const completeAtRef = eventJoinColumnExpression("complete", "createdAt");

	const filter = {
		type: "and" as const,
		predicates: [
			{
				expression: progressAtRef,
				type: "isNotNull" as const,
			},
			{
				type: "or" as const,
				predicates: [
					{
						type: "isNull" as const,
						expression: completeAtRef,
					},
					{
						left: progressAtRef,
						right: completeAtRef,
						operator: "gt" as const,
						type: "comparison" as const,
					},
				],
			},
		],
	};

	const request: QueryEngineRequest = {
		...buildBaseRequest(),
		filter,
		sort: { direction: "desc", expression: progressAtRef },
		pagination: { page: 1, limit: SECTION_LIMITS.continue },
	};

	try {
		const result = await deps.executeSectionQuery(userId, request);
		const items = result.items.flatMap((item) => {
			const mapped = toBuiltinMediaSourceItem(item);
			if (mapped?.progressAt) {
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

export const getUpNextItems = async (
	userId: string,
	deps: MediaServiceDeps = defaultDeps,
) => {
	const backlogAtRef = eventJoinColumnExpression("backlog", "createdAt");
	const progressAtRef = eventJoinColumnExpression("progress", "createdAt");

	const filter = {
		type: "and" as const,
		predicates: [
			{ type: "isNull" as const, expression: progressAtRef },
			{ expression: backlogAtRef, type: "isNotNull" as const },
		],
	};

	const request: QueryEngineRequest = {
		...buildBaseRequest(),
		filter,
		sort: { direction: "desc", expression: backlogAtRef },
		pagination: { page: 1, limit: SECTION_LIMITS.upNext },
	};

	try {
		const result = await deps.executeSectionQuery(userId, request);
		const items = result.items.flatMap((item) => {
			const mapped = toBuiltinMediaSourceItem(item);
			if (mapped?.backlogAt) {
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

export const getRateTheseItems = async (
	userId: string,
	deps: MediaServiceDeps = defaultDeps,
) => {
	const completeAtRef = eventJoinColumnExpression("complete", "createdAt");
	const reviewAtRef = eventJoinColumnExpression("review", "createdAt");
	const completedOnRef = eventJoinPropertyExpression("complete", "completedOn");

	const filter = {
		type: "and" as const,
		predicates: [
			{ expression: completeAtRef, type: "isNotNull" as const },
			{
				type: "or" as const,
				predicates: [
					{ type: "isNull" as const, expression: reviewAtRef },
					{
						right: reviewAtRef,
						left: completedOnRef,
						operator: "gt" as const,
						type: "comparison" as const,
					},
				],
			},
		],
	};

	const completedOnOrCompleteAt = coalesceExpression(
		completedOnRef,
		completeAtRef,
	);

	const request: QueryEngineRequest = {
		...buildBaseRequest(),
		filter,
		pagination: { page: 1, limit: SECTION_LIMITS.rateThese },
		sort: { direction: "desc", expression: completedOnOrCompleteAt },
	};

	try {
		const result = await deps.executeSectionQuery(userId, request);
		const items = result.items.flatMap((item) => {
			const mapped = toBuiltinMediaSourceItem(item);
			if (mapped?.completeAt) {
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

export const getRecentActivityItems = async (
	userId: string,
	deps: MediaServiceDeps = defaultDeps,
) => {
	const listRecentActivity =
		deps.listRecentActivityEventsForUser ?? listRecentActivityEventsForUser;
	const items = await listRecentActivity({
		userId,
		limit: SECTION_LIMITS.activity,
	});

	return serviceData(buildRecentActivitySectionResponse(items));
};

export const getWeekActivity = async (
	userId: string,
	deps: MediaServiceDeps = defaultDeps,
) => {
	const { startAt, endAt } = getCurrentWeekRange();
	const listWeekActivity =
		deps.listWeekActivityEventsForUser ?? listWeekActivityEventsForUser;
	const events = await listWeekActivity({ endAt, userId, startAt });
	const countByDayKey = new Map<string, number>();

	for (const event of events) {
		const key = getDateKey(event.occurredAt);
		countByDayKey.set(key, (countByDayKey.get(key) ?? 0) + 1);
	}

	const items = Array.from({ length: 7 }, (_, index) => {
		const date = dayjs.utc(startAt).add(index, "day").toDate();
		return { date, count: countByDayKey.get(getDateKey(date)) ?? 0 };
	});

	return serviceData(buildWeekActivitySectionResponse({ items }));
};

const isBacklogItem = (item: BuiltInMediaOverviewSourceItem): boolean => {
	return (
		item.backlogAt !== null &&
		item.progressAt === null &&
		item.completeAt === null
	);
};

const isInProgressItem = (item: BuiltInMediaOverviewSourceItem): boolean => {
	if (item.progressAt === null) {
		return false;
	}
	if (item.completeAt === null) {
		return true;
	}
	return dayjs(item.progressAt).isAfter(item.completeAt);
};

const isCompletedItem = (item: BuiltInMediaOverviewSourceItem): boolean => {
	if (item.completeAt === null) {
		return false;
	}
	if (item.progressAt === null) {
		return true;
	}
	return dayjs(item.completeAt).isAfter(item.progressAt);
};

export const getLibraryStats = async (
	userId: string,
	deps: MediaServiceDeps = defaultDeps,
) => {
	// NOTE: Limit of 10000 entities. If user has more tracked entities,
	// stats will be incomplete. Consider pagination or database-level
	// aggregation if this becomes a constraint.
	const request: QueryEngineRequest = {
		...buildBaseRequest(),
		filter: null,
		pagination: { page: 1, limit: 10000 },
		sort: {
			direction: "desc",
			expression: computedFieldExpression("entityCreatedAt"),
		},
	};

	try {
		const result = await deps.executeSectionQuery(userId, request);
		const items = result.items.flatMap((item) => {
			const mapped = toBuiltinMediaSourceItem(item);
			if (mapped) {
				return [mapped];
			}
			return [];
		});

		const entityTypeCounts = new Map<string, number>();
		let inBacklog = 0;
		let completed = 0;
		let ratingSum = 0;
		let inProgress = 0;
		let ratingCount = 0;

		for (const item of items) {
			entityTypeCounts.set(
				item.entitySchemaSlug,
				(entityTypeCounts.get(item.entitySchemaSlug) ?? 0) + 1,
			);

			if (isBacklogItem(item)) {
				inBacklog++;
			}
			if (isInProgressItem(item)) {
				inProgress++;
			}
			if (isCompletedItem(item)) {
				completed++;
			}
			if (item.reviewRating !== null) {
				ratingCount++;
				ratingSum += item.reviewRating;
			}
		}

		const total = items.length;
		const avgRating = ratingCount > 0 ? ratingSum / ratingCount : null;

		return serviceData({
			total,
			inBacklog,
			completed,
			avgRating,
			inProgress,
			entityTypeCounts: Object.fromEntries(entityTypeCounts),
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
