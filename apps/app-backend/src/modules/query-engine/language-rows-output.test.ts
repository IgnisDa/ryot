import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import { RowsOutput } from "./language";

const decodeSync = Schema.decodeUnknownSync;

describe("RowsOutput", () => {
	it("decodes a minimal rows output with no fields", () => {
		const result = decodeSync(RowsOutput)({
			fields: [],
			type: "rows",
			pagination: { page: 1, limit: 10 },
			orderBy: [{ order: "asc", expr: { type: "literal", value: 1 } }],
		});
		expect(result.type).toBe("rows");
		expect(result.fields).toHaveLength(0);
	});

	it("decodes fields array with multiple entries", () => {
		const result = decodeSync(RowsOutput)({
			type: "rows",
			pagination: { page: 2, limit: 50 },
			orderBy: [{ order: "desc", expr: { type: "literal", value: 1 } }],
			fields: [
				{ key: "title", expr: { type: "literal", value: "x" } },
				{ key: "year", expr: { type: "literal", value: 2024 } },
			],
		});
		expect(result.fields).toHaveLength(2);
		expect(result.pagination.page).toBe(2);
		expect(result.pagination.limit).toBe(50);
	});

	it("throws when orderBy is empty", () => {
		expect(() =>
			decodeSync(RowsOutput)({
				fields: [],
				orderBy: [],
				type: "rows",
				pagination: { page: 1, limit: 10 },
			}),
		).toThrow();
	});

	it("throws when pagination page is zero", () => {
		expect(() =>
			decodeSync(RowsOutput)({
				fields: [],
				type: "rows",
				pagination: { page: 0, limit: 10 },
				orderBy: [{ order: "asc", expr: { type: "literal", value: 1 } }],
			}),
		).toThrow();
	});

	it("throws when pagination limit is zero", () => {
		expect(() =>
			decodeSync(RowsOutput)({
				fields: [],
				type: "rows",
				pagination: { page: 1, limit: 0 },
				orderBy: [{ order: "asc", expr: { type: "literal", value: 1 } }],
			}),
		).toThrow();
	});

	it("throws when fields are missing", () => {
		expect(() =>
			decodeSync(RowsOutput)({
				type: "rows",
				pagination: { page: 1, limit: 10 },
				orderBy: [{ order: "asc", expr: { type: "literal", value: 1 } }],
			}),
		).toThrow();
	});

	it("throws when pagination is missing", () => {
		expect(() =>
			decodeSync(RowsOutput)({
				fields: [],
				type: "rows",
				orderBy: [{ order: "asc", expr: { type: "literal", value: 1 } }],
			}),
		).toThrow();
	});

	it("decodes an entity include with relationship traversal", () => {
		const result = decodeSync(RowsOutput)({
			fields: [],
			type: "rows",
			pagination: { page: 1, limit: 10 },
			orderBy: [{ order: "asc", expr: { type: "literal", value: 1 } }],
			include: [
				{
					limit: 20,
					key: "modules",
					fields: [
						{
							key: "name",
							expr: { type: "ref", sourceAlias: "module", field: { type: "system", name: "name" } },
						},
					],
					orderBy: [
						{
							order: "asc",
							expr: { type: "ref", sourceAlias: "module", field: { type: "system", name: "name" } },
						},
					],
					source: {
						where: null,
						alias: "module",
						type: "entities",
						schemas: ["module"],
						via: {
							entityRef: "course",
							direction: "outgoing",
							alias: "courseModule",
							schema: "course-module",
						},
					},
				},
			],
		});

		expect(result.include).toHaveLength(1);
		expect(result.include?.[0]?.source.via?.schema).toBe("course-module");
	});

	it("decodes nested entity includes", () => {
		const result = decodeSync(RowsOutput)({
			fields: [],
			type: "rows",
			pagination: { page: 1, limit: 10 },
			orderBy: [{ order: "asc", expr: { type: "literal", value: 1 } }],
			include: [
				{
					limit: 20,
					fields: [],
					key: "modules",
					orderBy: [{ order: "asc", expr: { type: "literal", value: 1 } }],
					source: {
						where: null,
						alias: "module",
						type: "entities",
						schemas: ["module"],
						via: {
							entityRef: "course",
							alias: "courseModule",
							direction: "outgoing",
							schema: "course-module",
						},
					},
					include: [
						{
							limit: 20,
							fields: [],
							key: "lessons",
							orderBy: [{ order: "asc", expr: { type: "literal", value: 1 } }],
							source: {
								where: null,
								alias: "lesson",
								type: "entities",
								schemas: ["lesson"],
								via: {
									entityRef: "module",
									alias: "moduleLesson",
									direction: "outgoing",
									schema: "module-lesson",
								},
							},
						},
					],
				},
			],
		});

		expect(result.include?.[0]?.include).toHaveLength(1);
	});

	it("throws when an include is missing a limit", () => {
		expect(() =>
			decodeSync(RowsOutput)({
				fields: [],
				type: "rows",
				pagination: { page: 1, limit: 10 },
				orderBy: [{ order: "asc", expr: { type: "literal", value: 1 } }],
				include: [
					{
						fields: [],
						key: "modules",
						orderBy: [{ order: "asc", expr: { type: "literal", value: 1 } }],
						source: { type: "entities", alias: "module", schemas: ["module"], where: null },
					},
				],
			}),
		).toThrow();
	});
});
