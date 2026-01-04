import { expect, it } from "vitest";

import { kernelDefinitionSource, kernelScripts } from "./kernel-source";

it("keeps source zero limited to generic kernel definitions", () => {
	const source = kernelDefinitionSource();
	expect(source.entitySchemas.map(({ slug }) => slug)).toEqual(["collection"]);
	expect(source.relationshipSchemas.map(({ slug }) => slug)).toEqual(["member-of"]);
	expect(source.savedViews.map(({ slug }) => slug)).toEqual(["collections"]);
	expect(source.signalSchemas.map(({ slug }) => slug)).toEqual(["integration.disabled"]);
	expect(kernelScripts.map(({ slug }) => slug)).toEqual(["automation.notification"]);
});
