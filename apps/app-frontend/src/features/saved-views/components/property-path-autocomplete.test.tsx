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
	propertiesSchema: { year: { type: "integer" }, title: { type: "string" } },
});

const mangaSchema = createEntitySchemaFixture({
	slug: "manga",
	propertiesSchema: { chapters: { type: "integer" } },
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
	it("includes @name, @createdAt, @updatedAt in Built-in group", () => {
		const element = PropertyPathAutocomplete({
			excludeImage: true,
			schemas: [animeSchema],
		});
		const ap = getAutocompleteProps(element);

		const builtinGroup = ap.data?.find((g) => g.group === "Built-in");
		expect(builtinGroup?.items).toContain("@name");
		expect(builtinGroup?.items).toContain("@createdAt");
		expect(builtinGroup?.items).toContain("@updatedAt");
	});

	it("excludes @image when excludeImage is true", () => {
		const element = PropertyPathAutocomplete({
			excludeImage: true,
			schemas: [animeSchema],
		});
		const ap = getAutocompleteProps(element);

		const builtinGroup = ap.data?.find((g) => g.group === "Built-in");
		expect(builtinGroup?.items).not.toContain("@image");
	});

	it("includes @image when excludeImage is false", () => {
		const element = PropertyPathAutocomplete({
			excludeImage: false,
			schemas: [animeSchema],
		});
		const ap = getAutocompleteProps(element);

		const builtinGroup = ap.data?.find((g) => g.group === "Built-in");
		expect(builtinGroup?.items).toContain("@image");
	});

	it("still shows Built-in group even when schemas is empty", () => {
		const element = PropertyPathAutocomplete({
			schemas: [],
			excludeImage: true,
		});
		const ap = getAutocompleteProps(element);

		const builtinGroup = ap.data?.find((g) => g.group === "Built-in");
		expect(builtinGroup).toBeDefined();
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
		expect(animeGroup?.items).toContain("anime.year");
		expect(animeGroup?.items).toContain("anime.title");
	});

	it("creates a separate group for each schema", () => {
		const element = PropertyPathAutocomplete({
			excludeImage: true,
			schemas: [animeSchema, mangaSchema],
		});
		const ap = getAutocompleteProps(element);

		const animeGroup = ap.data?.find((g) => g.group === "anime");
		const mangaGroup = ap.data?.find((g) => g.group === "manga");
		expect(animeGroup?.items).toContain("anime.year");
		expect(mangaGroup?.items).toContain("manga.chapters");
	});

	it("omits groups for schemas with no properties", () => {
		const emptySchema = createEntitySchemaFixture({
			slug: "empty",
			propertiesSchema: {},
		});
		const element = PropertyPathAutocomplete({
			excludeImage: true,
			schemas: [emptySchema],
		});
		const ap = getAutocompleteProps(element);

		const emptyGroup = ap.data?.find((g) => g.group === "empty");
		expect(emptyGroup).toBeUndefined();
	});
});

describe("PropertyPathAutocomplete - value passthrough", () => {
	it("forwards value prop to the autocomplete", () => {
		const element = PropertyPathAutocomplete({
			excludeImage: true,
			value: "anime.year",
			schemas: [animeSchema],
		});
		const ap = getAutocompleteProps(element);

		expect(ap.value).toBe("anime.year");
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
