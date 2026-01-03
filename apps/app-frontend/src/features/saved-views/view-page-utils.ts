import { match } from "ts-pattern";
import type { AppEntityImage } from "#/features/entities/model";
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

export function createViewRuntimeRequest(input: {
	page: number;
	limit: number;
	view: SavedView;
	layout: ViewLayout;
}): ViewRuntimeRequest {
	const base = {
		sort: input.view.queryDefinition.sort,
		eventJoins: input.view.queryDefinition.eventJoins,
		pagination: { page: input.page, limit: input.limit },
		computedFields: input.view.queryDefinition.computedFields,
		entitySchemaSlugs: input.view.queryDefinition.entitySchemaSlugs,
		...(input.view.queryDefinition.filter
			? { filter: input.view.queryDefinition.filter }
			: {}),
	};

	return match(input.layout)
		.with("grid", () => ({
			...base,
			fields: [
				{
					key: "image",
					expression:
						input.view.displayConfiguration.grid.imageProperty ??
						nullExpression,
				},
				{
					key: "title",
					expression:
						input.view.displayConfiguration.grid.titleProperty ??
						nullExpression,
				},
				{
					key: "subtitle",
					expression:
						input.view.displayConfiguration.grid.subtitleProperty ??
						nullExpression,
				},
				{
					key: "badge",
					expression:
						input.view.displayConfiguration.grid.badgeProperty ??
						nullExpression,
				},
			],
		}))
		.with("list", () => ({
			...base,
			fields: [
				{
					key: "image",
					expression:
						input.view.displayConfiguration.list.imageProperty ??
						nullExpression,
				},
				{
					key: "title",
					expression:
						input.view.displayConfiguration.list.titleProperty ??
						nullExpression,
				},
				{
					key: "subtitle",
					expression:
						input.view.displayConfiguration.list.subtitleProperty ??
						nullExpression,
				},
				{
					key: "badge",
					expression:
						input.view.displayConfiguration.list.badgeProperty ??
						nullExpression,
				},
			],
		}))
		.with("table", () => ({
			...base,
			fields: input.view.displayConfiguration.table.columns.map(
				(column, index) => ({
					key: `column_${index}`,
					expression: column.expression,
				}),
			),
		}))
		.exhaustive();
}

export function createDisabledViewRuntimeRequest(): ViewRuntimeRequest {
	return {
		eventJoins: [],
		computedFields: [],
		entitySchemaSlugs: ["book"],
		pagination: { page: 1, limit: GRID_LIMIT },
		sort: {
			direction: "asc",
			expression: entityColumnExpression("book", "name"),
		},
		fields: [
			{ key: "image", expression: entityColumnExpression("book", "image") },
			{ key: "title", expression: entityColumnExpression("book", "name") },
			{ key: "subtitle", expression: nullExpression },
			{ key: "badge", expression: nullExpression },
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

export function toImageValue(value: unknown): AppEntityImage {
	if (!value || typeof value !== "object") {
		return null;
	}

	const parsed = value as { kind?: string; key?: string; url?: string };
	if (parsed.kind === "remote" && parsed.url) {
		return { kind: "remote", url: parsed.url };
	}
	if (parsed.kind === "s3" && parsed.key) {
		return { kind: "s3", key: parsed.key };
	}

	return null;
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
