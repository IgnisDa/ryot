import { describe, expect, it } from "bun:test";

import { createEntityPropertyExpression } from "@ryot/ts-utils";

import { createSavedViewTableColumns } from "./table-utils";

describe("saved view table columns", () => {
	it("preserves configured labels and order", () => {
		const columns = createSavedViewTableColumns([
			{ expression: createEntityPropertyExpression("book", "title"), label: "Title" },
			{ expression: createEntityPropertyExpression("book", "status"), label: "Status" },
		]);

		expect(columns.map((column) => column.fieldKey)).toEqual(["column_0", "column_1"]);
		expect(columns.map((column) => column.label)).toEqual(["Title", "Status"]);
		expect(columns.every((column) => column.width > 0)).toBe(true);
	});
});
