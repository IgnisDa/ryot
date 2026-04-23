import { describe, expect, it } from "bun:test";
import { createSavedViewFixture } from "~/features/test-fixtures";
import { createQueryEngineRequest } from "./view-page-utils";

describe("createQueryEngineRequest", () => {
	it("preserves saved view relationships in runtime requests", () => {
		const view = createSavedViewFixture({
			queryDefinition: {
				entitySchemaSlugs: ["show"],
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
