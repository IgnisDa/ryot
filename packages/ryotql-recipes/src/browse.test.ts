import type { BrowseField } from "@ryot-app/contract/modules/filters/browse";
import { PluginId, RelationshipSchemaSlug } from "@ryot-app/contract/schema/brands";
import {
	ascending,
	column,
	conditional,
	count,
	descending,
	entitySchemaPredicate,
	eq,
	jsonPath,
	literal,
	or,
	table,
} from "@ryot-app/ryotql";
import { Result } from "effect";
import { describe, expect, it } from "vitest";

import {
	type BrowseSchema,
	browseTargets,
	compileSort,
	entitySchemaBrowseRecipe,
	nameSortTarget,
} from "./browse";

const subject = table("entity", "subject");
const entity = table("entity", "member");
const property = (from: ReturnType<typeof table>, name: string) =>
	jsonPath(column(from, "properties"), name);

const rating = (name: string): BrowseField => ({
	key: "rating",
	kind: "value",
	type: "number",
	label: "Rating",
	expression: property(subject, name),
	sort: { ascending: "Lowest rated", descending: "Highest rated" },
});

const schema = (
	slug: string,
	pluginId: null | string,
	fields: readonly BrowseField[],
): BrowseSchema => ({ slug, pluginId, browse: { fields } });

const local = (slug: string, pluginId: string) =>
	entitySchemaPredicate(entity, slug, { kind: "local", pluginId: PluginId.make(pluginId) });

const status = (choice: string): BrowseField => ({
	type: "enum",
	key: "status",
	kind: "value",
	label: "Status",
	expression: property(subject, "status"),
	choices: [
		{ value: "done", label: "Done" },
		{ value: choice, label: choice },
	],
});

const genres = (slug: string): BrowseField => ({
	key: "genres",
	label: "Genres",
	kind: "relationship",
	direction: "outgoing",
	relationship: { owner: { kind: "kernel" }, slug: RelationshipSchemaSlug.make(slug) },
});

describe("browse targets", () => {
	it("reads one schema's expression on the host entity without a schema condition", () => {
		const { sorts, filters } = browseTargets(
			[schema("movie", "media", [rating("score")])],
			entity,
			new Set(["member"]),
		);
		expect(filters).toEqual([
			{
				branches: [{ when: undefined, value: property(entity, "score") }],
				spec: { key: "rating", kind: "value", type: "number", label: "Rating" },
			},
		]);
		expect(sorts.map(({ key }) => key)).toEqual(["rating"]);
	});

	it("folds identical expressions and conditions differing ones by schema", () => {
		const { filters } = browseTargets(
			[
				schema("movie", "media", [rating("score")]),
				schema("show", "media", [rating("score")]),
				schema("book", "media", [rating("stars")]),
				schema("note", null, []),
			],
			entity,
			new Set(),
		);
		expect(filters[0]?.branches).toEqual([
			{
				value: property(entity, "score"),
				when: or(local("movie", "media"), local("show", "media")),
			},
			{ value: property(entity, "stars"), when: or(local("book", "media")) },
		]);
	});

	it("qualifies keys declared by different plugins and merges enum choices", () => {
		const { filters } = browseTargets(
			[
				schema("movie", "media", [status("planned")]),
				schema("show", "media", [status("caught_up")]),
				schema("exercise", "fitness", [status("planned")]),
			],
			entity,
			new Set(),
		);
		expect(filters.map(({ spec }) => spec)).toMatchObject([
			{
				key: "status:media",
				choices: [
					{ value: "done", label: "Done" },
					{ value: "planned", label: "planned" },
					{ value: "caught_up", label: "caught_up" },
				],
			},
			{ key: "status:fitness" },
		]);
	});

	it("follows each schema's own link for merged link fields", () => {
		const [target] = browseTargets(
			[
				schema("movie", null, [genres("movie-to-genre")]),
				schema("book", null, [genres("book-to-genre")]),
			],
			entity,
			new Set(),
		).filters;
		expect(
			target?.branches.map(({ link }) => link?.kind === "relationship" && link.relationship.slug),
		).toEqual(["movie-to-genre", "book-to-genre"]);
		expect(target?.branches.every(({ when }) => when !== undefined)).toBe(true);
	});

	it("renames correlated aliases clear of the host query", () => {
		const event = table("event", "event");
		const played: BrowseField = {
			kind: "sort",
			key: "plays",
			sort: { descending: "Most plays", ascending: "Fewest plays" },
			expression: count(event, { where: eq(column(event, "entityId"), column(subject, "id")) }),
		};
		const [target] = browseTargets(
			[schema("song", "music", [played])],
			entity,
			new Set(["browse0_event"]),
		).sorts;
		const renamed = table("event", "_browse0_event");
		expect(target?.branches[0]?.value).toEqual(
			count(renamed, { where: eq(column(renamed, "entityId"), column(entity, "id")) }),
		);
	});
});

describe("sort compilation", () => {
	const id = column(entity, "id");

	it("orders by the chosen direction then entity ID, reading null for undeclared schemas", () => {
		const movie = local("movie", "media");
		const sorts = [
			nameSortTarget(entity),
			{
				key: "rating",
				labels: { ascending: "Lowest", descending: "Highest" },
				branches: [{ when: movie, value: property(entity, "score") }],
			} as const,
		];
		expect(Result.getOrThrow(compileSort(sorts, "name-asc", id))).toEqual([
			ascending(column(entity, "name")),
			ascending(id),
		]);
		expect(Result.getOrThrow(compileSort(sorts, "rating-desc", id))).toEqual([
			descending(conditional(movie, property(entity, "score"), literal(null))),
			ascending(id),
		]);
		expect(Result.isFailure(compileSort(sorts, "rating", id))).toBe(true);
	});
});

describe("schema browse loading", () => {
	it("keeps requested schemas without a visible definition so their members stay excluded", () => {
		const recipe = entitySchemaBrowseRecipe({
			schemas: [
				{ slug: "movie", pluginId: "media" },
				{ slug: "removed", pluginId: "gone" },
			],
		});
		const movie = schema("movie", "media", [rating("rating")]);
		const loaded = Result.getOrThrow(
			recipe.decode({
				data: {
					schemas: {
						type: "rows",
						items: [movie],
						pageInfo: { limit: 2, hasMore: false, nextCursor: null },
					},
				},
			}),
		);
		expect(loaded).toEqual([movie, { browse: null, slug: "removed", pluginId: "gone" }]);
		expect(browseTargets(loaded, entity, new Set()).filters[0]?.branches).toEqual([
			{ value: property(entity, "rating"), when: or(local("movie", "media")) },
		]);
	});
});
