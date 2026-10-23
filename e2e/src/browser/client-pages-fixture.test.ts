import { collectionWorkflowRendererSource } from "~/fixtures/kernel";
import { describe, expect, it } from "~/support/effect-test";

describe("collection workflow renderer fixture", () => {
	it("qualifies grouped schemas by owner", () => {
		expect(collectionWorkflowRendererSource).toContain(
			'ownerPluginId: selectedField(column(entity, "entitySchemaPluginId")',
		);
		expect(collectionWorkflowRendererSource).toContain(
			'ownerPackageId === "ryot/fixture" && group.schemaSlug === "pokemon"',
		);
	});
});
