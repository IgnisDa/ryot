import type { RyotQLDocument } from "@ryot-app/contract/modules/ryotql/language";
import { SavedViewId } from "@ryot-app/contract/schema/brands";
import { column, document, field, rows, table } from "@ryot-app/ryotql";
import type { SavedViewRecord } from "@ryot-app/ryotql-recipes/saved-view-records";
import { describe, expect, it } from "vitest";

import {
	normalizeSavedViewSearch,
	savedViewQueryIdentity,
	withSavedViewCursor,
	withSavedViewSearch,
} from "./query";

const entity = table("entity", "entity");
const queryDocument = document({
	view: rows(entity, {
		limit: 2,
		fields: [
			field("entityId", column(entity, "id")),
			field("title", column(entity, "name")),
			field("status", column(entity, "status")),
		],
		where: {
			operator: "eq",
			type: "comparison",
			right: { type: "literal", value: "active" },
			left: column(entity, "status"),
		},
	}),
});
const cardLayout = {
	callout: null,
	queryDocument,
	overline: null,
	imageField: null,
	titleField: "title",
	primaryMetadata: null,
	secondaryMetadata: null,
	entityIdField: "entityId",
} satisfies SavedViewRecord["layouts"]["grid"];
const tableLayout = {
	queryDocument,
	imageField: null,
	entityIdField: "entityId",
	columns: [{ displayKind: "text", field: "title", label: "Title" }],
} satisfies SavedViewRecord["layouts"]["table"];
const record = { id: SavedViewId.make("view-1"), updatedAt: "2026-01-01T00:00:00.000Z" };

describe("saved-view query helpers", () => {
	it("normalizes saved-view search terms", () => {
		expect(normalizeSavedViewSearch("  alpha_beta-gamma  delta ")).toBe("alpha beta gamma delta");
		expect(normalizeSavedViewSearch(" _- \t")).toBe("");
	});

	it("searches the mapped card title field", () => {
		const searched = withSavedViewSearch(queryDocument, cardLayout, "alpha_beta");

		expect(searched.queries.view.where).toMatchObject({
			type: "and",
			predicates: [
				{ type: "comparison" },
				{
					type: "and",
					predicates: [
						{ type: "contains", left: column(entity, "name"), right: { value: "alpha" } },
						{ type: "contains", left: column(entity, "name"), right: { value: "beta" } },
					],
				},
			],
		});
	});

	it("searches the first mapped table column field", () => {
		const searched = withSavedViewSearch(queryDocument, tableLayout, "first");

		expect(searched.queries.view.where).toMatchObject({
			type: "and",
			predicates: [
				{ type: "comparison" },
				{
					type: "and",
					predicates: [
						{ type: "contains", left: column(entity, "name"), right: { value: "first" } },
					],
				},
			],
		});
	});

	it("preserves the original document when search cannot be mapped", () => {
		expect(withSavedViewSearch(queryDocument, cardLayout, " _- ")).toBe(queryDocument);
		expect(
			withSavedViewSearch(queryDocument, { ...cardLayout, titleField: "missing" }, "term"),
		).toBe(queryDocument);
	});

	it("removes and injects saved-view cursors without mutating the document", () => {
		const withCursor = withSavedViewCursor(queryDocument, "cursor-1");
		expect(withCursor.queries.view.output).toMatchObject({
			pagination: { after: "cursor-1", limit: 2 },
		});

		const searched = withSavedViewSearch(withCursor, cardLayout, "term");
		expect(searched.queries.view.output).toMatchObject({ pagination: { limit: 2 } });
		expect(searched.queries.view.output).not.toMatchObject({
			pagination: { after: expect.anything() },
		});
		expect(queryDocument.queries.view.output).toMatchObject({ pagination: { limit: 2 } });
	});

	it("changes query identity for record revisions and normalized searches", () => {
		const identity = savedViewQueryIdentity(record, " alpha_beta ");
		expect(identity).toBe(savedViewQueryIdentity(record, "alpha beta"));
		expect(identity).not.toBe(
			savedViewQueryIdentity({ ...record, id: SavedViewId.make("view-2") }, "alpha beta"),
		);
		expect(identity).not.toBe(
			savedViewQueryIdentity({ ...record, updatedAt: "2026-01-02T00:00:00.000Z" }, "alpha beta"),
		);
		expect(identity).not.toBe(savedViewQueryIdentity(record, "alpha gamma"));
	});

	it("returns unchanged documents that do not contain a sole rows query", () => {
		const empty = { queries: {} } satisfies RyotQLDocument;
		const aggregate = {
			queries: {
				view: {
					from: entity,
					output: {
						type: "aggregate",
						measures: [{ aggregation: { function: "count" }, key: "total" }],
					},
				},
			},
		} satisfies RyotQLDocument;

		expect(withSavedViewSearch(empty, cardLayout, "term")).toBe(empty);
		expect(withSavedViewCursor(empty, "cursor")).toBe(empty);
		expect(withSavedViewSearch(aggregate, cardLayout, "term")).toBe(aggregate);
		expect(withSavedViewCursor(aggregate, "cursor")).toBe(aggregate);
	});
});
