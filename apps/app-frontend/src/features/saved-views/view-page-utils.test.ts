import { describe, expect, it } from "bun:test";
import { createEntitySavedViewFixture } from "~/features/test-fixtures";
import { createQueryEngineRequest } from "./view-page-utils";

describe("createQueryEngineRequest", () => {
	it("does not request hidden entityImage for table layouts", () => {
		const view = createEntitySavedViewFixture({
			queryDefinition: { scope: ["show"] },
		});

		const result = createQueryEngineRequest({
			view,
			page: 1,
			limit: 20,
			layout: "table",
		});

		expect(result.fields?.some((field) => field.key === "entityImage")).toBe(
			false,
		);
	});

	it("preserves saved view relationships in runtime requests", () => {
		const view = createEntitySavedViewFixture({
			queryDefinition: {
				scope: ["show"],
				relationships: [{ relationshipSchemaSlug: "in-library" }],
			},
		});

		const result = createQueryEngineRequest({
			view,
			page: 2,
			limit: 12,
			layout: "grid",
		});

		expect(result.relationships).toEqual([
			{ relationshipSchemaSlug: "in-library" },
		]);
	});
});
