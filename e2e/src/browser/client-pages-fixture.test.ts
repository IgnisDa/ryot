import { collectionWorkflowRendererSource } from "~/fixtures/kernel";
import { describe, expect, it } from "~/support/effect-test";

describe("collection workflow renderer fixture", () => {
	it("qualifies grouped schemas and owns mutation refresh replay", () => {
		expect(collectionWorkflowRendererSource).toContain(
			'ownerPluginId: selectedField(column(entity, "entitySchemaPluginId")',
		);
		expect(collectionWorkflowRendererSource).toContain(
			'ownerPluginSlug === "fixture" && group.schemaSlug === "pokemon"',
		);
		expect(collectionWorkflowRendererSource).toContain(
			"useRyotQuery(collectionPageQuery, queryInput, { refreshOnMutation: false })",
		);
		expect(collectionWorkflowRendererSource).toContain("usePageRefresh(refresh)");
	});
});
