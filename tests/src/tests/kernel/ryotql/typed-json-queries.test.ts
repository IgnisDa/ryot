import type { RowsResult } from "@ryot/contract/modules/ryotql/language";
import {
	and,
	ascending,
	castBoolean,
	castDate,
	castJson,
	castNumber,
	castText,
	coalesce,
	column,
	contains,
	descending,
	document,
	eq,
	field,
	gte,
	gt,
	inArray,
	isNotNull,
	isNull,
	jsonPath,
	literal,
	not,
	or,
	rows,
	table,
} from "@ryot/ryotql";
import { Effect } from "effect";

import {
	createAuthenticatedClient,
	createQueryEngineEntity,
	createQueryEnginePluginSchema,
	executeRyotQL,
} from "~/fixtures";
import { describe, expect, it } from "~/support/effect-test";

const requireRows = (resultRows: RowsResult | undefined, name: string) => {
	if (!resultRows) {
		throw new Error(`Expected '${name}' rows`);
	}
	return resultRows;
};

const createSchema = (client: Parameters<typeof createQueryEnginePluginSchema>[0], name: string) =>
	createQueryEnginePluginSchema(client, {
		schemaName: name,
		propertiesSchema: { fields: {}, unknownKeys: "passthrough" },
	});

describe("RyotQL typed JSON entity queries", () => {
	it.live("queries books, movies, and courses with deep JSON expressions", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const [book, movie, course] = yield* Effect.all([
				createSchema(client, "RyotQLBook"),
				createSchema(client, "RyotQLMovie"),
				createSchema(client, "RyotQLCourse"),
			]);
			yield* Effect.all([
				createQueryEngineEntity(client, {
					name: "Book Alpha",
					entitySchemaSlug: book.schemaId,
					properties: {
						author: "Author A",
						tags: ["featured", "paperback"],
						details: {
							score: 4.8,
							available: true,
							contributors: [{ name: "Editor A" }],
							publishedAt: "2024-03-10T12:00:00.000Z",
							metadata: { edition: 2, format: "hardcover" },
						},
					},
				}),
				createQueryEngineEntity(client, {
					name: "Book Beta",
					entitySchemaSlug: book.schemaId,
					properties: {
						author: "Author B",
						tags: ["featured", "paperback"],
						details: {
							score: 3.1,
							available: false,
							metadata: { edition: 2, format: "paperback" },
						},
					},
				}),
				createQueryEngineEntity(client, {
					name: "Movie Gamma",
					entitySchemaSlug: movie.schemaId,
					properties: { director: "Director G", details: { score: 4.6 } },
				}),
				createQueryEngineEntity(client, {
					name: "Course Advanced",
					entitySchemaSlug: course.schemaId,
					properties: {
						code: "100%_Ready",
						tags: ["advanced", "backend"],
						details: { durationMinutes: 90, startsAt: "2026-09-01T09:00:00.000Z" },
					},
				}),
				createQueryEngineEntity(client, {
					name: "Course Decoy",
					entitySchemaSlug: course.schemaId,
					properties: {
						code: "100XXReady",
						tags: ["advanced"],
						details: { durationMinutes: 120, startsAt: "2026-09-01T09:00:00.000Z" },
					},
				}),
			]);

			const entity = table("entity", "entity");
			const properties = column(entity, "properties");
			const schema = column(entity, "entitySchemaSlug");
			const score = castNumber(jsonPath(properties, "details", "score"));
			const result = yield* executeRyotQL(
				client,
				document({
					books: rows(entity, {
						orderBy: [descending(score)],
						fields: [
							field("name", column(entity, "name")),
							field("score", score),
							field("available", castBoolean(jsonPath(properties, "details", "available"))),
							field("publishedAt", castDate(jsonPath(properties, "details", "publishedAt"))),
							field("metadata", castJson(jsonPath(properties, "details", "metadata"))),
							field("contributor", jsonPath(properties, "details", "contributors", 0)),
						],
						where: and(
							eq(schema, literal(book.slug)),
							gte(score, literal(3)),
							contains(jsonPath(properties, "tags"), literal(["featured"])),
							contains(jsonPath(properties, "details", "metadata"), literal({ edition: 2 })),
							isNotNull(jsonPath(properties, "author")),
						),
					}),
					media: rows(entity, {
						orderBy: [ascending(column(entity, "name"))],
						where: inArray(schema, [literal(book.slug), literal(movie.slug)]),
						fields: [
							field("name", column(entity, "name")),
							field(
								"creator",
								coalesce(jsonPath(properties, "author"), jsonPath(properties, "director")),
							),
						],
					}),
					courses: rows(entity, {
						fields: [
							field("name", column(entity, "name")),
							field("duration", castNumber(jsonPath(properties, "details", "durationMinutes"))),
						],
						where: and(
							eq(schema, literal(course.slug)),
							gt(castNumber(jsonPath(properties, "details", "durationMinutes")), literal(60)),
							gte(
								castDate(jsonPath(properties, "details", "startsAt")),
								castDate(literal("2026-09-01T00:00:00.000Z")),
							),
							contains(castText(jsonPath(properties, "code")), literal("%_")),
							contains(jsonPath(properties, "tags"), literal(["advanced"])),
						),
					}),
					structuralBooks: rows(entity, {
						fields: [],
						where: and(
							eq(schema, literal(book.slug)),
							eq(
								jsonPath(properties, "details", "metadata"),
								literal({ edition: 2, format: "hardcover" }),
							),
						),
					}),
					allBooks: rows(entity, { fields: [], where: and(eq(schema, literal(book.slug)), and()) }),
					noBooks: rows(entity, { fields: [], where: and(eq(schema, literal(book.slug)), or()) }),
					unknown: rows(entity, {
						fields: [],
						where: eq(schema, literal(`unknown-${crypto.randomUUID()}`)),
					}),
				}),
			);

			const books = requireRows(result.data["books"], "books");
			expect(books.pageInfo.total).toBe(2);
			expect(books.items).toEqual([
				{
					score: { kind: "number", value: 4.8 },
					name: { kind: "text", value: "Book Alpha" },
					available: { kind: "boolean", value: true },
					contributor: { kind: "json", value: { name: "Editor A" } },
					publishedAt: { kind: "date", value: "2024-03-10T12:00:00.000Z" },
					metadata: { kind: "json", value: { edition: 2, format: "hardcover" } },
				},
				{
					score: { kind: "number", value: 3.1 },
					publishedAt: { kind: "null", value: null },
					name: { kind: "text", value: "Book Beta" },
					contributor: { kind: "null", value: null },
					available: { kind: "boolean", value: false },
					metadata: { kind: "json", value: { edition: 2, format: "paperback" } },
				},
			]);
			expect(
				requireRows(result.data["media"], "media").items.map((item) => [
					item["name"]?.value,
					item["creator"]?.value,
				]),
			).toEqual([
				["Book Alpha", "Author A"],
				["Book Beta", "Author B"],
				["Movie Gamma", "Director G"],
			]);
			expect(requireRows(result.data["courses"], "courses").items).toEqual([
				{
					name: { kind: "text", value: "Course Advanced" },
					duration: { kind: "number", value: 90 },
				},
			]);
			expect(requireRows(result.data["structuralBooks"], "structuralBooks").pageInfo.total).toBe(1);
			expect(requireRows(result.data["allBooks"], "allBooks").pageInfo.total).toBe(2);
			expect(requireRows(result.data["noBooks"], "noBooks").pageInfo.total).toBe(0);
			expect(requireRows(result.data["unknown"], "unknown").pageInfo.total).toBe(0);
		}),
	);

	it.live("returns null for missing, incompatible, and malformed JSON casts", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const schemaDefinition = yield* createSchema(client, "RyotQLSafeCasts");
			yield* Effect.all([
				createQueryEngineEntity(client, {
					name: "Cast Invalid",
					entitySchemaSlug: schemaDefinition.schemaId,
					properties: {
						text: 42,
						json: null,
						number: "1e400",
						boolean: "true",
						date: "not-a-date",
					},
				}),
				createQueryEngineEntity(client, {
					name: "Cast Valid",
					entitySchemaSlug: schemaDefinition.schemaId,
					properties: {
						number: 12.5,
						text: "ready",
						boolean: true,
						json: { nested: true },
						date: "2026-08-07T12:00:00.000Z",
					},
				}),
			]);

			const entity = table("entity", "entity");
			const properties = column(entity, "properties");
			const number = castNumber(jsonPath(properties, "number"));
			const result = yield* executeRyotQL(
				client,
				document({
					casts: rows(entity, {
						fields: [
							field("name", column(entity, "name")),
							field("text", castText(jsonPath(properties, "text"))),
							field("number", number),
							field("boolean", castBoolean(jsonPath(properties, "boolean"))),
							field("date", castDate(jsonPath(properties, "date"))),
							field("json", castJson(jsonPath(properties, "json"))),
							field("missing", castText(jsonPath(properties, "missing"))),
							field("outOfRange", castNumber(literal("1e400"))),
							field("nonFinite", castNumber(literal("NaN"))),
							field("infiniteDate", castDate(literal("infinity"))),
							field("constant", literal(true)),
						],
						where: and(
							eq(column(entity, "entitySchemaSlug"), literal(schemaDefinition.slug)),
							not(eq(number, literal(1))),
							or(isNull(number), isNotNull(number)),
						),
					}),
				}),
			);

			const casts = requireRows(result.data["casts"], "casts");
			expect(casts.items).toHaveLength(2);
			const byName = new Map(casts.items.map((item) => [item["name"]?.value, item]));
			expect(byName.get("Cast Invalid")).toEqual({
				text: { kind: "null", value: null },
				date: { kind: "null", value: null },
				json: { kind: "null", value: null },
				number: { kind: "null", value: null },
				missing: { kind: "null", value: null },
				boolean: { kind: "null", value: null },
				nonFinite: { kind: "null", value: null },
				outOfRange: { kind: "null", value: null },
				constant: { kind: "boolean", value: true },
				infiniteDate: { kind: "null", value: null },
				name: { kind: "text", value: "Cast Invalid" },
			});
			expect(byName.get("Cast Valid")).toEqual({
				text: { kind: "text", value: "ready" },
				missing: { kind: "null", value: null },
				number: { kind: "number", value: 12.5 },
				nonFinite: { kind: "null", value: null },
				outOfRange: { kind: "null", value: null },
				boolean: { kind: "boolean", value: true },
				constant: { kind: "boolean", value: true },
				name: { kind: "text", value: "Cast Valid" },
				infiniteDate: { kind: "null", value: null },
				json: { kind: "json", value: { nested: true } },
				date: { kind: "date", value: "2026-08-07T12:00:00.000Z" },
			});
		}),
	);
});
