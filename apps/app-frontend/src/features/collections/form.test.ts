import { describe, expect, it } from "bun:test";

import { createPropertySchemaRowFixture } from "~/features/test-fixtures";

import { toCreateCollectionPayload } from "./form";

const row = createPropertySchemaRowFixture;

describe("toCreateCollectionPayload", () => {
	it("omits membershipPropertiesSchema when no properties are provided", () => {
		const payload = toCreateCollectionPayload({
			properties: [],
			name: "Favorites",
		});

		expect(payload.membershipPropertiesSchema).toBeUndefined();
	});

	it("includes membershipPropertiesSchema built from property rows", () => {
		const payload = toCreateCollectionPayload({
			name: "Recommended to me",
			properties: [
				row({
					id: "friend",
					key: "friend",
					label: "Recommended by",
					description: "Recommended by",
				}),
				row({
					id: "rating",
					key: "rating",
					required: true,
					type: "integer",
					label: "Rating",
					description: "Rating",
				}),
			],
		});

		expect(payload.membershipPropertiesSchema).toEqual({
			fields: {
				friend: {
					type: "string",
					label: "Recommended by",
					description: "Recommended by",
				},
				rating: {
					type: "integer",
					label: "Rating",
					description: "Rating",
					validation: { required: true },
				},
			},
		});
	});
});
