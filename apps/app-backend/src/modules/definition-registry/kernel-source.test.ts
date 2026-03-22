import { assert, expect, it } from "vitest";

import { kernelDefinitionSource, kernelScripts } from "./kernel-source";

it("keeps source zero limited to generic kernel definitions", () => {
	const source = kernelDefinitionSource();
	expect(source.entitySchemas.map(({ slug }) => slug)).toEqual(["collection"]);
	expect(source.relationshipSchemas.map(({ slug }) => slug)).toEqual(["member-of"]);
	expect(source.savedViews.map(({ name }) => name)).toEqual(["All Collections"]);
	expect(source.savedViews.map(({ slug }) => slug)).toEqual(["collections"]);
	const savedView = source.savedViews[0];
	assert(savedView);
	expect(savedView.layouts.grid.queryDocument).not.toBe(savedView.layouts.list.queryDocument);
	expect(savedView.layouts.list.queryDocument).not.toBe(savedView.layouts.table.queryDocument);
	const gridQuery = savedView.layouts.grid.queryDocument.queries["collections"];
	const tableQuery = savedView.layouts.table.queryDocument.queries["collections"];
	assert(gridQuery?.output.type === "rows");
	assert(tableQuery?.output.type === "rows");
	expect(gridQuery.output.fields).toMatchObject([
		{ key: "entityId" },
		{ key: "title" },
		{ key: "overline" },
	]);
	expect(tableQuery.output.fields).toMatchObject([{ key: "entityId" }, { key: "column0" }]);
	expect(source.signalSchemas.map(({ slug }) => slug)).toEqual(["integration.disabled"]);
	expect(kernelScripts.map(({ slug }) => slug)).toEqual(["automation.notification"]);
});
