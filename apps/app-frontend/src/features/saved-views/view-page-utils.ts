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

export const GRID_LIMIT = 12;
export const LIST_LIMIT = 15;
export const TABLE_LIMIT = 20;

const entityField = (schemaSlug: string, field: string) => {
	return `entity.${schemaSlug}.${field}`;
};

export function createViewRuntimeRequest(input: {
	page: number;
	limit: number;
	view: SavedView;
	layout: ViewLayout;
}): ViewRuntimeRequest {
	const base = {
		sort: input.view.queryDefinition.sort,
		filters: input.view.queryDefinition.filters,
		eventJoins: input.view.queryDefinition.eventJoins,
		pagination: { page: input.page, limit: input.limit },
		entitySchemaSlugs: input.view.queryDefinition.entitySchemaSlugs,
	};

	return match(input.layout)
		.with("grid", () => ({
			...base,
			fields: [
				{
					key: "image",
					references: input.view.displayConfiguration.grid.imageProperty ?? [],
				},
				{
					key: "title",
					references: input.view.displayConfiguration.grid.titleProperty ?? [],
				},
				{
					key: "subtitle",
					references:
						input.view.displayConfiguration.grid.subtitleProperty ?? [],
				},
				{
					key: "badge",
					references: input.view.displayConfiguration.grid.badgeProperty ?? [],
				},
			],
		}))
		.with("list", () => ({
			...base,
			fields: [
				{
					key: "image",
					references: input.view.displayConfiguration.list.imageProperty ?? [],
				},
				{
					key: "title",
					references: input.view.displayConfiguration.list.titleProperty ?? [],
				},
				{
					key: "subtitle",
					references:
						input.view.displayConfiguration.list.subtitleProperty ?? [],
				},
				{
					key: "badge",
					references: input.view.displayConfiguration.list.badgeProperty ?? [],
				},
			],
		}))
		.with("table", () => ({
			...base,
			fields: input.view.displayConfiguration.table.columns.map(
				(column, index) => ({
					key: `column_${index}`,
					references: column.property,
				}),
			),
		}))
		.exhaustive();
}

export function createDisabledViewRuntimeRequest(): ViewRuntimeRequest {
	return {
		filters: [],
		eventJoins: [],
		entitySchemaSlugs: ["book"],
		pagination: { page: 1, limit: GRID_LIMIT },
		sort: { fields: [entityField("book", "@name")], direction: "asc" },
		fields: [
			{ key: "image", references: [entityField("book", "@image")] },
			{ key: "title", references: [entityField("book", "@name")] },
			{ key: "subtitle", references: [] },
			{ key: "badge", references: [] },
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
