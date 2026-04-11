import { describe, expect, it } from "bun:test";
import { createEntitySchemaFixture } from "#/features/test-fixtures";
import { PropertyPathAutocomplete } from "./property-path-autocomplete";

type AutocompleteProps = {
	value?: string;
	disabled?: boolean;
	placeholder?: string;
	data?: { group: string; items: string[] }[];
};

function getAutocompleteProps(
	element: ReturnType<typeof PropertyPathAutocomplete>,
): AutocompleteProps {
	return (element as unknown as { props: AutocompleteProps }).props;
}

const animeSchema = createEntitySchemaFixture({
	slug: "anime",
	propertiesSchema: {
		fields: { year: { type: "integer" }, title: { type: "string" } },
	},
});

const mangaSchema = createEntitySchemaFixture({
	slug: "manga",
	propertiesSchema: { fields: { chapters: { type: "integer" } } },
});

describe("PropertyPathAutocomplete - disabled state", () => {
	it("is disabled with placeholder when schemas is empty", () => {
		const element = PropertyPathAutocomplete({
			schemas: [],
			excludeImage: true,
		});
		const ap = getAutocompleteProps(element);

		expect(ap.disabled).toBe(true);
		expect(ap.placeholder).toBe("Add entity schemas first");
	});

	it("is enabled when schemas are provided", () => {
		const element = PropertyPathAutocomplete({
			excludeImage: true,
			schemas: [animeSchema],
		});
		const ap = getAutocompleteProps(element);

		expect(ap.disabled).toBe(false);
	});

	it("respects external disabled prop even with schemas", () => {
		const element = PropertyPathAutocomplete({
			disabled: true,
			excludeImage: true,
			schemas: [animeSchema],
		});
		const ap = getAutocompleteProps(element);

		expect(ap.disabled).toBe(true);
	});
});

describe("PropertyPathAutocomplete - built-in group", () => {
	it("includes entity built-ins in each schema group", () => {
		const element = PropertyPathAutocomplete({
			excludeImage: true,
			schemas: [animeSchema],
		});
		const ap = getAutocompleteProps(element);

		const animeGroup = ap.data?.find((g) => g.group === "anime");
		expect(animeGroup?.items).toContain("entity.anime.@name");
		expect(animeGroup?.items).toContain("entity.anime.@createdAt");
		expect(animeGroup?.items).toContain("entity.anime.@updatedAt");
	});

	it("excludes entity @image when excludeImage is true", () => {
		const element = PropertyPathAutocomplete({
			excludeImage: true,
			schemas: [animeSchema],
		});
		const ap = getAutocompleteProps(element);

		const animeGroup = ap.data?.find((g) => g.group === "anime");
		expect(animeGroup?.items).not.toContain("entity.anime.@image");
	});

	it("includes entity @image when excludeImage is false", () => {
		const element = PropertyPathAutocomplete({
			excludeImage: false,
			schemas: [animeSchema],
		});
		const ap = getAutocompleteProps(element);

		const animeGroup = ap.data?.find((g) => g.group === "anime");
		expect(animeGroup?.items).toContain("entity.anime.@image");
	});

	it("shows no schema groups when schemas is empty", () => {
		const element = PropertyPathAutocomplete({
			schemas: [],
			excludeImage: true,
		});
		const ap = getAutocompleteProps(element);

		expect(ap.data).toEqual([]);
	});
});

describe("PropertyPathAutocomplete - schema-grouped options", () => {
	it("shows schema-qualified options grouped by slug", () => {
		const element = PropertyPathAutocomplete({
			excludeImage: true,
			schemas: [animeSchema],
		});
		const ap = getAutocompleteProps(element);

		const animeGroup = ap.data?.find((g) => g.group === "anime");
		expect(animeGroup?.items).toContain("entity.anime.year");
		expect(animeGroup?.items).toContain("entity.anime.title");
	});

	it("creates a separate group for each schema", () => {
		const element = PropertyPathAutocomplete({
			excludeImage: true,
			schemas: [animeSchema, mangaSchema],
		});
		const ap = getAutocompleteProps(element);

		const animeGroup = ap.data?.find((g) => g.group === "anime");
		const mangaGroup = ap.data?.find((g) => g.group === "manga");
		expect(animeGroup?.items).toContain("entity.anime.year");
		expect(mangaGroup?.items).toContain("entity.manga.chapters");
	});

	it("still includes built-ins for schemas with no properties", () => {
		const emptySchema = createEntitySchemaFixture({
			slug: "empty",
			propertiesSchema: { fields: {} },
		});
		const element = PropertyPathAutocomplete({
			excludeImage: true,
			schemas: [emptySchema],
		});
		const ap = getAutocompleteProps(element);

		const emptyGroup = ap.data?.find((g) => g.group === "empty");
		expect(emptyGroup?.items).toContain("entity.empty.@name");
	});
});

describe("PropertyPathAutocomplete - value passthrough", () => {
	it("forwards value prop to the autocomplete", () => {
		const element = PropertyPathAutocomplete({
			excludeImage: true,
			value: "entity.anime.year",
			schemas: [animeSchema],
		});
		const ap = getAutocompleteProps(element);

		expect(ap.value).toBe("entity.anime.year");
	});

	it("uses empty string as default value when none given", () => {
		const element = PropertyPathAutocomplete({
			excludeImage: true,
			schemas: [animeSchema],
		});
		const ap = getAutocompleteProps(element);

		expect(ap.value).toBe("");
	});
});
