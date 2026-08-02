import type { EntityDefinition } from "@ryot/contract/modules/definitions/schemas";
import { EntitySchemaSlug, SandboxProviderId } from "@ryot/contract/schema/brands";
import { describe, expect, it } from "vitest";

import { parseAddParam, selectAddableDefinitions } from "./flow-state";

const definition = (slug: string, name: string, providers: number): EntityDefinition => ({
	name,
	icon: "star",
	eventSchemas: [],
	propertiesSchema: { fields: {} },
	slug: EntitySchemaSlug.make(slug),
	providers: Array.from({ length: providers }, (_, index) => ({
		name: `Provider ${index}`,
		providerId: SandboxProviderId.make(`${slug}-provider-${index}`),
	})),
});

describe("provider-add flow state", () => {
	it("parses the add param across closed, picker, and search shapes", () => {
		expect(parseAddParam(undefined)).toEqual({ kind: "closed" });
		expect(parseAddParam("1")).toEqual({ kind: "schema-picker" });
		expect(parseAddParam("")).toEqual({ kind: "schema-picker" });
		expect(parseAddParam("   ")).toEqual({ kind: "schema-picker" });
		expect(parseAddParam(" movie ")).toEqual({ kind: "search", entitySchemaSlug: "movie" });
		expect(parseAddParam(["book", "movie"])).toEqual({
			kind: "search",
			entitySchemaSlug: "book",
		});
		expect(parseAddParam(["1"])).toEqual({ kind: "schema-picker" });
		expect(parseAddParam([])).toEqual({ kind: "closed" });
	});

	it("keeps only provider-backed definitions, sorted by name", () => {
		const definitions = [
			definition("show", "Show", 1),
			definition("note", "Note", 0),
			definition("book", "Book", 2),
		];

		expect(selectAddableDefinitions(definitions).map((current) => current.slug)).toEqual([
			"book",
			"show",
		]);
		expect(definitions.map((current) => current.slug)).toEqual(["show", "note", "book"]);
	});
});
