import {
	createEntityColumnExpression,
	createEntitySchemaExpression,
	getQueryEngineField,
} from "@ryot/ts-utils";
import { match } from "ts-pattern";
import { createEntityIdentityFields } from "~/features/entities/model";
import type {
	ApiGetResponseData,
	ApiPostRequestBody,
	ApiPostResponseData,
} from "~/lib/api/types";

type SavedView = ApiGetResponseData<"/saved-views/{viewSlug}">;
type QueryEngineRequest = ApiPostRequestBody<"/query-engine/execute">;
type QueryEngineResponse = ApiPostResponseData<"/query-engine/execute">;
type RuntimeItem = QueryEngineResponse["items"][number];
type RuntimeField = RuntimeItem[number];
type RuntimeRequestField = NonNullable<QueryEngineRequest["fields"]>[number];
type ViewExpression = RuntimeRequestField["expression"];
type CardDisplayConfiguration = SavedView["displayConfiguration"]["grid"];
type ViewLayout = keyof SavedView["displayConfiguration"];

export const GRID_LIMIT = 12;
export const LIST_LIMIT = 15;
export const TABLE_LIMIT = 20;

const nullExpression = {
	value: null,
	type: "literal",
} satisfies ViewExpression;

const createRuntimeField = (
	key: string,
	expression: ViewExpression,
): RuntimeRequestField => ({
	key,
	expression,
});

const entitySchemaSlugField = createRuntimeField(
	"entitySchemaSlug",
	createEntitySchemaExpression("slug"),
);

const buildCardFields = (input: {
	image: ViewExpression | null;
	title: ViewExpression | null;
	callout: ViewExpression | null;
	primarySubtitle: ViewExpression | null;
	secondarySubtitle: ViewExpression | null;
}) => {
	return [
		createRuntimeField("image", input.image ?? nullExpression),
		createRuntimeField("title", input.title ?? nullExpression),
		createRuntimeField(
			"primarySubtitle",
			input.primarySubtitle ?? nullExpression,
		),
		createRuntimeField(
			"secondarySubtitle",
			input.secondarySubtitle ?? nullExpression,
		),
		createRuntimeField("callout", input.callout ?? nullExpression),
	];
};

const buildRuntimeRequestBase = (input: {
	page: number;
	limit: number;
	view: SavedView;
}) => ({
	sort: input.view.queryDefinition.sort,
	filter: input.view.queryDefinition.filter ?? null,
	eventJoins: input.view.queryDefinition.eventJoins,
	pagination: { page: input.page, limit: input.limit },
	relationships: input.view.queryDefinition.relationships,
	computedFields: input.view.queryDefinition.computedFields,
	scope: input.view.queryDefinition.scope,
});

const buildCardRuntimeFields = (configuration: CardDisplayConfiguration) => {
	return buildCardFields({
		image: configuration.imageProperty,
		title: configuration.titleProperty,
		callout: configuration.calloutProperty,
		primarySubtitle: configuration.primarySubtitleProperty,
		secondarySubtitle: configuration.secondarySubtitleProperty,
	});
};

export function createQueryEngineRequest(input: {
	page: number;
	limit: number;
	view: SavedView;
	layout: ViewLayout;
}): QueryEngineRequest {
	const base = buildRuntimeRequestBase(input);

	return match(input.layout)
		.with("grid", () => ({
			...base,
			fields: [
				...createEntityIdentityFields(input.view.queryDefinition.scope),
				...buildCardRuntimeFields(input.view.displayConfiguration.grid),
				entitySchemaSlugField,
			],
		}))
		.with("list", () => ({
			...base,
			fields: [
				...createEntityIdentityFields(input.view.queryDefinition.scope),
				...buildCardRuntimeFields(input.view.displayConfiguration.list),
				entitySchemaSlugField,
			],
		}))
		.with("table", () => ({
			...base,
			fields: [
				...createEntityIdentityFields(input.view.queryDefinition.scope, {
					includeImage: false,
				}),
				...input.view.displayConfiguration.table.columns.map((column, index) =>
					createRuntimeField(`column_${index}`, column.expression),
				),
			],
		}))
		.exhaustive();
}

export function createDisabledQueryEngineRequest(): QueryEngineRequest {
	return {
		filter: null,
		eventJoins: [],
		relationships: [],
		computedFields: [],
		scope: ["book"],
		pagination: { page: 1, limit: GRID_LIMIT },
		sort: {
			direction: "asc",
			expression: createEntityColumnExpression("book", "name"),
		},
		fields: [
			...createEntityIdentityFields(["book"]),
			...buildCardFields({
				callout: null,
				primarySubtitle: null,
				secondarySubtitle: null,
				title: createEntityColumnExpression("book", "name"),
				image: createEntityColumnExpression("book", "image"),
			}),
			entitySchemaSlugField,
		],
	};
}

export function getPageLimit(layout: ViewLayout) {
	return match(layout)
		.with("grid", () => GRID_LIMIT)
		.with("list", () => LIST_LIMIT)
		.with("table", () => TABLE_LIMIT)
		.exhaustive();
}

export function getRuntimeField(
	item: { fields?: RuntimeField[] } | RuntimeField[],
	key: string,
): RuntimeField | undefined {
	return getQueryEngineField(Array.isArray(item) ? item : item.fields, key);
}

export function isRuntimeField(value: unknown): value is RuntimeField {
	return (
		!!value && typeof value === "object" && "kind" in value && "value" in value
	);
}

export function formatRuntimeValue(value: unknown) {
	if (value === null || value === undefined || value === "") {
		return "-";
	}
	if (value instanceof Date) {
		return value.toLocaleDateString();
	}
	if (typeof value === "object") {
		return JSON.stringify(value);
	}
	if (typeof value === "boolean") {
		return value ? "Yes" : "No";
	}
	return String(value);
}
