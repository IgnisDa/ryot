import { match } from "ts-pattern";
import type {
	ApiGetResponseData,
	ApiPostRequestBody,
	ApiPostResponseData,
} from "#/lib/api/types";

export type RuntimeField = ViewRuntimeItem["fields"][number];
export type ViewLayout = keyof SavedView["displayConfiguration"];
export type ViewRuntimeItem = ViewRuntimeResponse["items"][number];
export type SavedView = ApiGetResponseData<"/saved-views/{viewId}">;
export type ViewRuntimeRequest = ApiPostRequestBody<"/view-runtime/execute">;
export type ViewRuntimeResponse = ApiPostResponseData<"/view-runtime/execute">;
type ViewExpression = NonNullable<
	ViewRuntimeRequest["fields"]
>[number]["expression"];

export const GRID_LIMIT = 12;
export const LIST_LIMIT = 15;
export const TABLE_LIMIT = 20;

const nullExpression = {
	value: null,
	type: "literal",
} satisfies ViewExpression;

const entityColumnExpression = (
	schemaSlug: string,
	column: string,
): ViewExpression => ({
	type: "reference",
	reference: { type: "entity-column", slug: schemaSlug, column },
});

const createRuntimeField = (key: string, expression: ViewExpression) => ({
	key,
	expression,
});

const buildCardFields = (input: {
	image: ViewExpression | null;
	title: ViewExpression | null;
	badge: ViewExpression | null;
	subtitle: ViewExpression | null;
}) => {
	return [
		createRuntimeField("image", input.image ?? nullExpression),
		createRuntimeField("title", input.title ?? nullExpression),
		createRuntimeField("subtitle", input.subtitle ?? nullExpression),
		createRuntimeField("badge", input.badge ?? nullExpression),
	];
};

export function createViewRuntimeRequest(input: {
	page: number;
	limit: number;
	view: SavedView;
	layout: ViewLayout;
}): ViewRuntimeRequest {
	const base = {
		filter: input.view.queryDefinition.filter ?? null,
		sort: input.view.queryDefinition.sort,
		eventJoins: input.view.queryDefinition.eventJoins,
		pagination: { page: input.page, limit: input.limit },
		computedFields: input.view.queryDefinition.computedFields,
		entitySchemaSlugs: input.view.queryDefinition.entitySchemaSlugs,
	};

	return match(input.layout)
		.with("grid", () => ({
			...base,
			fields: buildCardFields({
				image: input.view.displayConfiguration.grid.imageProperty,
				title: input.view.displayConfiguration.grid.titleProperty,
				badge: input.view.displayConfiguration.grid.badgeProperty,
				subtitle: input.view.displayConfiguration.grid.subtitleProperty,
			}),
		}))
		.with("list", () => ({
			...base,
			fields: buildCardFields({
				image: input.view.displayConfiguration.list.imageProperty,
				title: input.view.displayConfiguration.list.titleProperty,
				badge: input.view.displayConfiguration.list.badgeProperty,
				subtitle: input.view.displayConfiguration.list.subtitleProperty,
			}),
		}))
		.with("table", () => ({
			...base,
			fields: input.view.displayConfiguration.table.columns.map(
				(column, index) =>
					createRuntimeField(`column_${index}`, column.expression),
			),
		}))
		.exhaustive();
}

export function createDisabledViewRuntimeRequest(): ViewRuntimeRequest {
	return {
		filter: null,
		eventJoins: [],
		computedFields: [],
		entitySchemaSlugs: ["book"],
		pagination: { page: 1, limit: GRID_LIMIT },
		sort: {
			direction: "asc",
			expression: entityColumnExpression("book", "name"),
		},
		fields: buildCardFields({
			badge: null,
			subtitle: null,
			title: entityColumnExpression("book", "name"),
			image: entityColumnExpression("book", "image"),
		}),
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
	item: { fields?: RuntimeField[] },
	key: string,
): RuntimeField | undefined {
	return item.fields?.find((field) => field.key === key);
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
