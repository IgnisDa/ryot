import { match } from "ts-pattern";
import { createEntityColumnExpression } from "#/features/entities/model";
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
type CardDisplayConfiguration = SavedView["displayConfiguration"]["grid"];

export const GRID_LIMIT = 12;
export const LIST_LIMIT = 15;
export const TABLE_LIMIT = 20;

const nullExpression = {
	value: null,
	type: "literal",
} satisfies ViewExpression;

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

const buildRuntimeRequestBase = (input: {
	page: number;
	limit: number;
	view: SavedView;
}) => ({
	sort: input.view.queryDefinition.sort,
	filter: input.view.queryDefinition.filter ?? null,
	eventJoins: input.view.queryDefinition.eventJoins,
	pagination: { page: input.page, limit: input.limit },
	computedFields: input.view.queryDefinition.computedFields,
	entitySchemaSlugs: input.view.queryDefinition.entitySchemaSlugs,
});

const buildCardRuntimeFields = (configuration: CardDisplayConfiguration) => {
	return buildCardFields({
		image: configuration.imageProperty,
		title: configuration.titleProperty,
		badge: configuration.badgeProperty,
		subtitle: configuration.subtitleProperty,
	});
};

export function createViewRuntimeRequest(input: {
	page: number;
	limit: number;
	view: SavedView;
	layout: ViewLayout;
}): ViewRuntimeRequest {
	const base = buildRuntimeRequestBase(input);

	return match(input.layout)
		.with("grid", () => ({
			...base,
			fields: buildCardRuntimeFields(input.view.displayConfiguration.grid),
		}))
		.with("list", () => ({
			...base,
			fields: buildCardRuntimeFields(input.view.displayConfiguration.list),
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
			expression: createEntityColumnExpression("book", "name"),
		},
		fields: buildCardFields({
			badge: null,
			subtitle: null,
			title: createEntityColumnExpression("book", "name"),
			image: createEntityColumnExpression("book", "image"),
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
