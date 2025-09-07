import { describe, expect, it } from "bun:test";

import { createEntityColumnExpression, createEntityPropertyExpression } from "@ryot/ts-utils";

import type { QueryEngineEntityItem } from "../entity-detail/query-engine";
import type { EntitySavedView } from "./runtime";
import {
	SAVED_VIEW_PAGE_SIZE,
	SAVED_VIEW_RUNTIME_FIELD_KEYS,
	createSavedViewRuntimeFields,
	createSavedViewRuntimeRequest,
	extractSavedViewImageEntries,
	flattenSavedViewPages,
	formatSavedViewFieldValue,
	isEntitySavedView,
} from "./runtime";

const view = {
	id: "view-1",
	icon: "book",
	sortOrder: 1,
	slug: "library",
	name: "Library",
	trackerId: null,
	isBuiltin: false,
	isDisabled: false,
	accentColor: "#aa7733",
	createdAt: "2024-01-01T00:00:00Z",
	updatedAt: "2024-01-02T00:00:00Z",
	queryDefinition: {
		filter: null,
		eventJoins: [],
		scope: ["book"],
		mode: "entities",
		computedFields: [],
		relationshipJoins: [],
		sort: { direction: "asc", expression: createEntityPropertyExpression("book", "title") },
	},
	displayConfiguration: {
		entityIdProperty: createEntityColumnExpression("book", "id"),
		table: {
			columns: [
				{ expression: createEntityPropertyExpression("book", "title"), label: "Title" },
				{ expression: createEntityPropertyExpression("book", "status"), label: "Status" },
			],
		},
		grid: {
			eyebrowProperty: null,
			calloutProperty: null,
			primarySubtitleProperty: null,
			imageProperty: createEntityColumnExpression("book", "image"),
			titleProperty: createEntityPropertyExpression("book", "title"),
			secondarySubtitleProperty: createEntityPropertyExpression("book", "subtitle"),
		},
		list: {
			imageProperty: null,
			primarySubtitleProperty: null,
			secondarySubtitleProperty: null,
			eyebrowProperty: createEntityColumnExpression("book", "name"),
			titleProperty: createEntityPropertyExpression("book", "title"),
			calloutProperty: createEntityPropertyExpression("book", "status"),
		},
	},
} satisfies EntitySavedView;

type SavedView = Parameters<typeof isEntitySavedView>[0];

describe("saved view runtime request builder", () => {
	it("builds a grid request with declared fields only", () => {
		const result = createSavedViewRuntimeRequest({
			view,
			page: 2,
			layout: "grid",
		});

		expect(result.pagination).toEqual({ limit: SAVED_VIEW_PAGE_SIZE, page: 2 });
		expect(result.scope).toEqual(["book"]);
		expect(result.fields?.map((field) => field.key)).toEqual([
			SAVED_VIEW_RUNTIME_FIELD_KEYS.entityId,
			SAVED_VIEW_RUNTIME_FIELD_KEYS.image,
			SAVED_VIEW_RUNTIME_FIELD_KEYS.title,
			SAVED_VIEW_RUNTIME_FIELD_KEYS.secondarySubtitle,
		]);
		expect(result.fields?.some((field) => field.key === "entityName")).toBe(false);
	});

	it("builds a list request with declared fields only", () => {
		const result = createSavedViewRuntimeRequest({
			view,
			page: 3,
			layout: "list",
		});

		expect(result.pagination).toEqual({ limit: SAVED_VIEW_PAGE_SIZE, page: 3 });
		expect(result.scope).toEqual(["book"]);
		expect(result.fields?.map((field) => field.key)).toEqual([
			SAVED_VIEW_RUNTIME_FIELD_KEYS.entityId,
			SAVED_VIEW_RUNTIME_FIELD_KEYS.eyebrow,
			SAVED_VIEW_RUNTIME_FIELD_KEYS.title,
			SAVED_VIEW_RUNTIME_FIELD_KEYS.callout,
		]);
		expect(result.fields?.some((field) => field.key === "entityName")).toBe(false);
	});

	it("builds a table request with stable column keys", () => {
		const result = createSavedViewRuntimeRequest({
			view,
			page: 1,
			layout: "table",
		});

		expect(result.pagination).toEqual({ limit: SAVED_VIEW_PAGE_SIZE, page: 1 });
		expect(result.scope).toEqual(["book"]);
		expect(result.fields?.map((field) => field.key)).toEqual([
			SAVED_VIEW_RUNTIME_FIELD_KEYS.entityId,
			"column_0",
			"column_1",
		]);
		expect(result.fields?.some((field) => field.key === "entityName")).toBe(false);
	});

	it("produces distinct field sets per layout so switching resets accumulated results", () => {
		const gridFields = createSavedViewRuntimeFields({ layout: "grid", view }).map((f) => f.key);
		const listFields = createSavedViewRuntimeFields({ layout: "list", view }).map((f) => f.key);
		const tableFields = createSavedViewRuntimeFields({ layout: "table", view }).map((f) => f.key);

		expect(gridFields).not.toEqual(listFields);
		expect(gridFields).not.toEqual(tableFields);
		expect(listFields).not.toEqual(tableFields);
	});
});

describe("saved view value formatting", () => {
	it("formats text, number, boolean, date, image, and json values", () => {
		expect(formatSavedViewFieldValue({ kind: "text", value: "Dune" })).toEqual({
			kind: "text",
			value: "Dune",
		});
		expect(formatSavedViewFieldValue({ kind: "number", value: 12.5 })).toEqual({
			kind: "text",
			value: "12.5",
		});
		expect(formatSavedViewFieldValue({ kind: "boolean", value: true })).toEqual({
			kind: "text",
			value: "Yes",
		});
		expect(formatSavedViewFieldValue({ kind: "date", value: "2024-03-01T12:34:00" })).toEqual({
			kind: "text",
			value: "Mar 1, 2024 12:34 PM",
		});
		expect(
			formatSavedViewFieldValue({
				kind: "image",
				value: { type: "remote", url: "https://img.test/cover.png" },
			}),
		).toEqual({ kind: "image", image: { type: "remote", url: "https://img.test/cover.png" } });
		expect(formatSavedViewFieldValue({ kind: "json", value: { foo: "bar" } })).toEqual({
			kind: "text",
			value: '{"foo":"bar"}',
		});
		expect(formatSavedViewFieldValue({ kind: "null", value: null })).toEqual({ kind: "empty" });
	});
});

describe("saved view image and page utilities", () => {
	it("extracts image entries by row id and field key", () => {
		const entries = extractSavedViewImageEntries([
			{
				cover: { kind: "image", value: { type: "s3", key: "cover-1" } },
				[SAVED_VIEW_RUNTIME_FIELD_KEYS.entityId]: { kind: "text", value: "book-1" },
				image: { kind: "image", value: { type: "remote", url: "https://img.test/a.png" } },
			} satisfies QueryEngineEntityItem,
		]);

		expect(entries).toEqual([
			{ id: "book-1:cover", image: { type: "s3", key: "cover-1" } },
			{ id: "book-1:image", image: { type: "remote", url: "https://img.test/a.png" } },
		]);
	});

	it("flattens saved view pages", () => {
		expect(flattenSavedViewPages([{ data: { items: [1, 2] } }, { data: { items: [3] } }])).toEqual([
			1, 2, 3,
		]);
	});
});

describe("saved view narrowing", () => {
	it("identifies entity saved views", () => {
		expect(isEntitySavedView(view)).toBe(true);
		expect(
			isEntitySavedView({
				...view,
				queryDefinition: {
					filter: null,
					eventJoins: [],
					scope: ["book"],
					computedFields: [],
					relationshipJoins: [],
					sort: { direction: "asc", expression: createEntityPropertyExpression("book", "title") },
				} satisfies SavedView["queryDefinition"],
			}),
		).toBe(false);
	});
});
