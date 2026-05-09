import type { paths } from "@ryot/generated/openapi/app-backend";
import { dayjs } from "@ryot/ts-utils/dayjs";
import { getQueryEngineField } from "@ryot/ts-utils/query-engine";
import { match } from "ts-pattern";

import type { EntityImage } from "@/lib/entity-image";
import { toEntityImage } from "@/lib/entity-image";

import type {
	QueryEngineEntitiesRequestBody,
	QueryEngineEntityItem,
} from "../entity-detail/query-engine";

type SavedView =
	paths["/saved-views/{viewSlug}"]["get"]["responses"][200]["content"]["application/json"]["data"];

export type EntitySavedView = Omit<SavedView, "queryDefinition"> & {
	queryDefinition: Extract<SavedView["queryDefinition"], { mode: "entities" }>;
};

export type SavedViewLayout = keyof Pick<
	SavedView["displayConfiguration"],
	"grid" | "list" | "table"
>;

export const SAVED_VIEW_PAGE_SIZE = 20;

export const SAVED_VIEW_RUNTIME_FIELD_KEYS = {
	image: "image",
	title: "title",
	callout: "callout",
	eyebrow: "eyebrow",
	entityId: "entityId",
	primarySubtitle: "primarySubtitle",
	secondarySubtitle: "secondarySubtitle",
} as const;

export function isEntitySavedView(view: SavedView): view is EntitySavedView {
	return match(view.queryDefinition)
		.with({ mode: "entities" }, () => true)
		.otherwise(() => false);
}

type RuntimeField = NonNullable<QueryEngineEntitiesRequestBody["fields"]>[number];
type ViewExpression = SavedView["displayConfiguration"]["entityIdProperty"];

type SavedViewFormattedValue =
	| { kind: "empty" }
	| { kind: "text"; value: string }
	| { kind: "image"; image: EntityImage };

const createRuntimeField = (key: string, expression: ViewExpression): RuntimeField => ({
	key,
	expression,
});

const createOptionalRuntimeField = (
	key: string,
	expression: ViewExpression | null,
): RuntimeField[] => {
	return expression ? [createRuntimeField(key, expression)] : [];
};

const createRuntimeRequestBase = (input: { page: number; view: EntitySavedView }) => ({
	mode: "entities" as const,
	sort: input.view.queryDefinition.sort,
	scope: input.view.queryDefinition.scope,
	filter: input.view.queryDefinition.filter ?? null,
	eventJoins: input.view.queryDefinition.eventJoins,
	computedFields: input.view.queryDefinition.computedFields,
	pagination: { limit: SAVED_VIEW_PAGE_SIZE, page: input.page },
	relationshipJoins: input.view.queryDefinition.relationshipJoins,
});

function createCardRuntimeFields(input: {
	entityIdProperty: ViewExpression;
	configuration: EntitySavedView["displayConfiguration"]["grid"];
}) {
	return [
		createRuntimeField(SAVED_VIEW_RUNTIME_FIELD_KEYS.entityId, input.entityIdProperty),
		...createOptionalRuntimeField(
			SAVED_VIEW_RUNTIME_FIELD_KEYS.eyebrow,
			input.configuration.eyebrowProperty,
		),
		...createOptionalRuntimeField(
			SAVED_VIEW_RUNTIME_FIELD_KEYS.image,
			input.configuration.imageProperty,
		),
		createRuntimeField(SAVED_VIEW_RUNTIME_FIELD_KEYS.title, input.configuration.titleProperty),
		...createOptionalRuntimeField(
			SAVED_VIEW_RUNTIME_FIELD_KEYS.primarySubtitle,
			input.configuration.primarySubtitleProperty,
		),
		...createOptionalRuntimeField(
			SAVED_VIEW_RUNTIME_FIELD_KEYS.secondarySubtitle,
			input.configuration.secondarySubtitleProperty,
		),
		...createOptionalRuntimeField(
			SAVED_VIEW_RUNTIME_FIELD_KEYS.callout,
			input.configuration.calloutProperty,
		),
	];
}

function createTableRuntimeFields(input: {
	entityIdProperty: ViewExpression;
	columns: EntitySavedView["displayConfiguration"]["table"]["columns"];
}) {
	return [
		createRuntimeField(SAVED_VIEW_RUNTIME_FIELD_KEYS.entityId, input.entityIdProperty),
		...input.columns.map((column, index) =>
			createRuntimeField(`column_${index}`, column.expression),
		),
	];
}

export function createSavedViewRuntimeFields(input: {
	layout: SavedViewLayout;
	view: EntitySavedView;
}) {
	return match(input.layout)
		.with("grid", () =>
			createCardRuntimeFields({
				configuration: input.view.displayConfiguration.grid,
				entityIdProperty: input.view.displayConfiguration.entityIdProperty,
			}),
		)
		.with("list", () =>
			createCardRuntimeFields({
				configuration: input.view.displayConfiguration.list,
				entityIdProperty: input.view.displayConfiguration.entityIdProperty,
			}),
		)
		.with("table", () =>
			createTableRuntimeFields({
				columns: input.view.displayConfiguration.table.columns,
				entityIdProperty: input.view.displayConfiguration.entityIdProperty,
			}),
		)
		.exhaustive();
}

export function createSavedViewRuntimeRequest(input: {
	page: number;
	view: EntitySavedView;
	layout: SavedViewLayout;
}): QueryEngineEntitiesRequestBody {
	return {
		...createRuntimeRequestBase(input),
		fields: createSavedViewRuntimeFields({ layout: input.layout, view: input.view }),
	};
}

function formatJsonPreview(value: unknown) {
	try {
		const text = JSON.stringify(value);
		if (!text) {
			return "";
		}
		return text.length > 120 ? `${text.slice(0, 117)}...` : text;
	} catch {
		return "";
	}
}

function formatNumber(value: number) {
	if (Number.isInteger(value)) {
		return value.toString();
	}
	return value
		.toFixed(2)
		.replace(/\.0+$/, "")
		.replace(/(\.\d*[1-9])0+$/, "$1");
}

function formatDateValue(value: unknown) {
	const parsed = typeof value === "string" || value instanceof Date ? dayjs(value) : null;
	if (!parsed?.isValid()) {
		return typeof value === "string" || typeof value === "number" ? `${value}` : "";
	}
	return parsed.format("MMM D, YYYY h:mm A");
}

export function formatSavedViewFieldValue(
	field: QueryEngineEntityItem[string] | undefined,
): SavedViewFormattedValue {
	if (!field || field.kind === "null") {
		return { kind: "empty" };
	}

	if (field.kind === "image") {
		const image = toEntityImage(field.value);
		return image ? { kind: "image", image } : { kind: "empty" };
	}

	if (field.kind === "date") {
		return { kind: "text", value: formatDateValue(field.value) };
	}

	if (field.kind === "boolean") {
		return { kind: "text", value: field.value ? "Yes" : "No" };
	}

	if (field.kind === "number") {
		return {
			kind: "text",
			value: typeof field.value === "number" ? formatNumber(field.value) : "",
		};
	}

	if (field.kind === "json") {
		return { kind: "text", value: formatJsonPreview(field.value) };
	}

	if (typeof field.value === "string") {
		return { kind: "text", value: field.value };
	}

	if (typeof field.value === "number") {
		return { kind: "text", value: formatNumber(field.value) };
	}

	if (typeof field.value === "boolean") {
		return { kind: "text", value: field.value ? "Yes" : "No" };
	}

	if (field.value instanceof Date) {
		return { kind: "text", value: formatDateValue(field.value) };
	}

	return { kind: "text", value: formatJsonPreview(field.value) };
}

export function extractSavedViewImageEntries(rows: QueryEngineEntityItem[]) {
	return rows.flatMap((row) => {
		const entityId = getQueryEngineField(row, SAVED_VIEW_RUNTIME_FIELD_KEYS.entityId)?.value;
		if (typeof entityId !== "string") {
			return [];
		}

		return Object.entries(row).flatMap(([key, field]) => {
			if (field.kind !== "image") {
				return [];
			}
			const image = toEntityImage(field.value);
			return image ? [{ id: `${entityId}:${key}`, image }] : [];
		});
	});
}

export function flattenSavedViewPages<T>(pages: Array<{ data: { items: T[] } }>) {
	return pages.flatMap((page) => page.data.items);
}

export function getEntityId(row: QueryEngineEntityItem): string | null {
	const value = getQueryEngineField(row, SAVED_VIEW_RUNTIME_FIELD_KEYS.entityId)?.value;
	return typeof value === "string" && value.trim().length > 0 ? value : null;
}
