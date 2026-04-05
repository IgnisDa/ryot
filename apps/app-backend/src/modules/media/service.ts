import {
	builtinMediaEntitySchemaSlugSet,
	builtinMediaEntitySchemaSlugs,
} from "~/lib/media/constants";
import { type ServiceResult, serviceData, serviceError } from "~/lib/result";
import { viewDefinitionModule } from "~/lib/views/definition";
import {
	ViewRuntimeNotFoundError,
	ViewRuntimeValidationError,
} from "~/lib/views/errors";
import type {
	ViewRuntimeRequest,
	ViewRuntimeResponseData,
} from "~/modules/view-runtime/schemas";
import {
	type BuiltInMediaOverviewSourceItem,
	buildBuiltInMediaOverviewResponse,
} from "./response-builder";
import type { BuiltInMediaOverviewResponse } from "./schemas";

type MediaOverviewError = "not_found" | "validation";

type BuiltInMediaOverviewServiceDeps = {
	loadOverviewItems: typeof loadOverviewItems;
};

type LoadOverviewItemsDeps = {
	executeOverviewPage: typeof executeOverviewPage;
};

type NullableDate = Date | null;

const overviewRuntimeLimit = 5000;
const mediaOverviewMisconfiguredError =
	"Built-in media overview configuration is invalid";

const serviceDeps: BuiltInMediaOverviewServiceDeps = {
	loadOverviewItems,
};

const loadOverviewItemsDeps: LoadOverviewItemsDeps = {
	executeOverviewPage,
};

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
	item: ViewRuntimeResponseData["items"][number],
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

const toNullableDate = (value: unknown): NullableDate => {
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
	item: ViewRuntimeResponseData["items"][number],
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
		totalUnits: toNullableNumber(getFieldValue(item, "totalUnits")),
		completedOn: toNullableDate(getFieldValue(item, "completedOn")),
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

const createOverviewRuntimeRequest = (page: number): ViewRuntimeRequest => {
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
		filter: null,
		pagination: { page, limit: overviewRuntimeLimit },
		entitySchemaSlugs: [...builtinMediaEntitySchemaSlugs],
		sort: {
			direction: "desc",
			expression: computedFieldExpression("entityCreatedAt"),
		},
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

async function executeOverviewPage(input: { page: number; userId: string }) {
	const preparedView = await viewDefinitionModule.prepare({
		userId: input.userId,
		source: {
			kind: "runtime",
			request: createOverviewRuntimeRequest(input.page),
		},
	});

	return preparedView.execute();
}

export async function loadOverviewItems(
	input: { userId: string },
	deps: LoadOverviewItemsDeps = loadOverviewItemsDeps,
) {
	const items: BuiltInMediaOverviewSourceItem[] = [];
	let page = 1;

	try {
		for (;;) {
			const result = await deps.executeOverviewPage({
				page,
				userId: input.userId,
			});
			items.push(
				...result.items.flatMap((item) => {
					const mapped = toBuiltinMediaSourceItem(item);
					return mapped ? [mapped] : [];
				}),
			);

			if (!result.meta.pagination.hasNextPage) {
				break;
			}

			page += 1;
		}
	} catch (error) {
		if (error instanceof ViewRuntimeNotFoundError) {
			return serviceError("not_found", mediaOverviewMisconfiguredError);
		}
		if (error instanceof ViewRuntimeValidationError) {
			return serviceError("validation", mediaOverviewMisconfiguredError);
		}

		throw error;
	}

	return serviceData(items);
}

export const getBuiltInMediaOverview = async (
	input: { userId: string },
	deps: BuiltInMediaOverviewServiceDeps = serviceDeps,
): Promise<ServiceResult<BuiltInMediaOverviewResponse, MediaOverviewError>> => {
	const overviewItems = await deps.loadOverviewItems({ userId: input.userId });
	if (!("data" in overviewItems)) {
		return overviewItems;
	}

	return serviceData(buildBuiltInMediaOverviewResponse(overviewItems.data));
};
