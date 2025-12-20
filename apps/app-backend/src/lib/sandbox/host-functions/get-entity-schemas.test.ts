import { describe, expect, it } from "bun:test";
import { serviceData, serviceError } from "~/lib/result";
import { apiFailure, apiSuccess } from "~/lib/sandbox/types";
import type { ListedEntitySchema } from "~/modules/entity-schemas/schemas";
import { createGetEntitySchemasHostFunction } from "./get-entity-schemas";

const listedEntitySchema: ListedEntitySchema = {
	icon: "book",
	name: "Books",
	slug: "books",
	id: "schema_1",
	isBuiltin: false,
	accentColor: "blue",
	searchProviders: [],
	trackerId: "tracker_1",
	propertiesSchema: { title: { type: "string" } },
};

describe("getEntitySchemas", () => {
	it("forwards userId and slugs for a valid string array", async () => {
		let capturedInput: { userId: string; slugs?: string[] } | undefined;
		const getEntitySchemas = createGetEntitySchemasHostFunction({
			listEntitySchemas: async (input) => {
				capturedInput = input;
				return serviceData([listedEntitySchema]);
			},
		});

		expect(
			getEntitySchemas({ userId: "user_1" }, ["books", "movies"]),
		).resolves.toEqual(apiSuccess([listedEntitySchema]));
		expect(capturedInput).toEqual({
			userId: "user_1",
			slugs: ["books", "movies"],
		});
	});

	it("returns validation failure for a non-string-array slugs argument", async () => {
		const getEntitySchemas = createGetEntitySchemasHostFunction({
			listEntitySchemas: async () => serviceData([]),
		});

		expect(getEntitySchemas({ userId: "user_1" }, "books")).resolves.toEqual(
			apiFailure("getEntitySchemas expects slugs to be a string array"),
		);
	});

	it("returns validation failure for a blank context userId", async () => {
		const getEntitySchemas = createGetEntitySchemasHostFunction({
			listEntitySchemas: async () => serviceData([]),
		});

		expect(getEntitySchemas({ userId: "   " }, ["books"])).resolves.toEqual(
			apiFailure("getEntitySchemas requires a non-empty userId in context"),
		);
	});

	it("returns service failures as api failures", async () => {
		const getEntitySchemas = createGetEntitySchemasHostFunction({
			listEntitySchemas: async () =>
				serviceError("not_found", "Entity schema not found"),
		});

		expect(
			getEntitySchemas({ userId: "user_1" }, ["missing"]),
		).resolves.toEqual(apiFailure("Entity schema not found"));
	});
});
