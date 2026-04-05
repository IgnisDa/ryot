import { match } from "ts-pattern";
import type { AppEntityImage } from "#/features/entities/model";
import type {
	ApiGetResponseData,
	ApiPostRequestBody,
	ApiPostResponseData,
} from "#/lib/api/types";

export type SavedView = ApiGetResponseData<"/saved-views/{viewId}">;
export type ViewRuntimeRequest = ApiPostRequestBody<"/view-runtime/execute">;
export type ViewRuntimeResponse = ApiPostResponseData<"/view-runtime/execute">;
export type ViewLayout = ViewRuntimeRequest["layout"];
export type ViewRuntimeItem = ViewRuntimeResponse["items"][number];
export type SemanticRuntimeItem = Extract<
	ViewRuntimeItem,
	{ resolvedProperties: unknown }
>;
export type RuntimeProperty =
	SemanticRuntimeItem["resolvedProperties"][keyof SemanticRuntimeItem["resolvedProperties"]];

export const GRID_LIMIT = 12;
export const LIST_LIMIT = 15;
export const TABLE_LIMIT = 20;

export function createViewRuntimeRequest(input: {
	view: SavedView;
	layout: ViewLayout;
	page: number;
	limit: number;
}): ViewRuntimeRequest {
	const base = {
		layout: input.layout,
		sort: input.view.queryDefinition.sort,
		filters: input.view.queryDefinition.filters,
		pagination: { page: input.page, limit: input.limit },
		entitySchemaSlugs: input.view.queryDefinition.entitySchemaSlugs,
	};

	return match(input.layout)
		.with("grid", () => ({
			...base,
			layout: "grid" as const,
			displayConfiguration: input.view.displayConfiguration.grid,
		}))
		.with("list", () => ({
			...base,
			layout: "list" as const,
			displayConfiguration: input.view.displayConfiguration.list,
		}))
		.with("table", () => ({
			...base,
			layout: "table" as const,
			displayConfiguration: input.view.displayConfiguration.table,
		}))
		.exhaustive();
}

export function createDisabledViewRuntimeRequest(): ViewRuntimeRequest {
	return {
		filters: [],
		layout: "grid",
		entitySchemaSlugs: ["book"],
		pagination: { page: 1, limit: GRID_LIMIT },
		sort: { fields: ["@name"], direction: "asc" },
		displayConfiguration: {
			badgeProperty: null,
			subtitleProperty: null,
			titleProperty: ["@name"],
			imageProperty: ["@image"],
		},
	};
}

export function getPageLimit(layout: ViewLayout) {
	return match(layout)
		.with("grid", () => GRID_LIMIT)
		.with("list", () => LIST_LIMIT)
		.with("table", () => TABLE_LIMIT)
		.exhaustive();
}

export function isRuntimeProperty(value: unknown): value is RuntimeProperty {
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
