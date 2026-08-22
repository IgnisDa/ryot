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
	expect(savedView.renderer).toEqual({ kind: "kernel", name: "entity-browser" });
	expect(savedView.settings).toMatchObject({
		sourceName: "savedView",
		layouts: ["grid", "list", "table"],
	});
	const query = savedView.dataSources?.queries["savedView"];
	assert(query?.output.type === "rows");
	expect(query.output.fields).toMatchObject([
		{ key: "entityId" },
		{ key: "column0" },
		{ key: "populationStatus" },
		{ key: "translationStatus" },
		{ key: "ownerPluginId" },
		{ key: "entitySchemaSlug" },
	]);
	expect(source.signalSchemas.map(({ slug }) => slug)).toEqual(["integration.disabled"]);
	expect(kernelScripts.map(({ slug }) => slug)).toEqual(["automation.notification"]);
});
