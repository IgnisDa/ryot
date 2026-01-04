import {
	builtinMediaEntitySchemaSlugSet,
	builtinMediaEntitySchemaSlugs,
} from "~/lib/media/constants";
import { type ServiceResult, serviceData, serviceError } from "~/lib/result";
import { viewDefinitionModule } from "~/lib/views/definition";
import {
	QueryEngineNotFoundError,
	QueryEngineValidationError,
} from "~/lib/views/errors";
import type {
	QueryEngineRequest,
	QueryEngineResponseData,
} from "~/modules/query-engine/schemas";
import {
	type BuiltInMediaOverviewSourceItem,
	buildBuiltInMediaOverviewResponse,
	type ContinueSourceItem,
	type RateTheseSourceItem,
	type UpNextSourceItem,
} from "./response-builder";
import type { BuiltInMediaOverviewResponse } from "./schemas";

type MediaOverviewError = "not_found" | "validation";

const mediaOverviewMisconfiguredError =
	"Built-in media overview configuration is invalid";

const SECTION_LIMITS = { upNext: 6, continue: 6, rateThese: 6 };

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
	reference: { slug, column, type: "entity-column" as const },
});

const entityPropertyExpression = (slug: string, property: string) => ({
	type: "reference" as const,
	reference: { slug, property, type: "schema-property" as const },
});

const eventJoinColumnExpression = (joinKey: string, column: "createdAt") => ({
	type: "reference" as const,
	reference: { column, joinKey, type: "event-join-column" as const },
});

const eventJoinPropertyExpression = (joinKey: string, property: string) => ({
	type: "reference" as const,
	reference: { property, joinKey, type: "event-join-property" as const },
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
		return Number.isNaN(value.getTime()) ? null : value;
	}
	if (typeof value === "string") {
		const parsed = new Date(value);
		return Number.isNaN(parsed.getTime()) ? null : parsed;
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
		entityColumnExpression("anime", "createdAt"),
		entityColumnExpression("manga", "createdAt"),
	);
	const publishYear = coalesceExpression(
		entityPropertyExpression("book", "publishYear"),
		entityPropertyExpression("anime", "publishYear"),
		entityPropertyExpression("manga", "publishYear"),
	);
	const totalUnits = coalesceExpression(
		entityPropertyExpression("book", "pages"),
		entityPropertyExpression("anime", "episodes"),
		entityPropertyExpression("manga", "chapters"),
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
};

const defaultDeps: MediaServiceDeps = {
	executeSectionQuery: async (userId, request) => {
		const preparedView = await viewDefinitionModule.prepare({
			userId,
			source: { request, kind: "runtime" },
		});
		return preparedView.execute();
	},
};

const getContinueItems = async (
	userId: string,
	deps: MediaServiceDeps = defaultDeps,
): Promise<ContinueSourceItem[]> => {
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

	const result = await deps.executeSectionQuery(userId, request);
	return result.items.flatMap((item) => {
		const mapped = toBuiltinMediaSourceItem(item);
		if (mapped?.progressAt) {
			return [mapped as ContinueSourceItem];
		}
		return [];
	});
};

const getUpNextItems = async (
	userId: string,
	deps: MediaServiceDeps = defaultDeps,
): Promise<UpNextSourceItem[]> => {
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

	const result = await deps.executeSectionQuery(userId, request);
	return result.items.flatMap((item) => {
		const mapped = toBuiltinMediaSourceItem(item);
		if (mapped?.backlogAt) {
			return [mapped as UpNextSourceItem];
		}
		return [];
	});
};

const getRateTheseItems = async (
	userId: string,
	deps: MediaServiceDeps = defaultDeps,
): Promise<RateTheseSourceItem[]> => {
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

	const result = await deps.executeSectionQuery(userId, request);
	return result.items.flatMap((item) => {
		const mapped = toBuiltinMediaSourceItem(item);
		if (mapped?.completeAt) {
			return [mapped as RateTheseSourceItem];
		}
		return [];
	});
};

export const getBuiltInMediaOverview = async (
	input: { userId: string },
	deps: MediaServiceDeps = defaultDeps,
): Promise<ServiceResult<BuiltInMediaOverviewResponse, MediaOverviewError>> => {
	try {
		const [continueItems, upNextItems, rateTheseItems] = await Promise.all([
			getContinueItems(input.userId, deps),
			getUpNextItems(input.userId, deps),
			getRateTheseItems(input.userId, deps),
		]);

		return serviceData(
			buildBuiltInMediaOverviewResponse({
				upNextItems,
				continueItems,
				rateTheseItems,
			}),
		);
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
