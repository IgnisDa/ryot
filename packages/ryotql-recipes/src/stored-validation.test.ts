import { describe, expect, it } from "bun:test";

import type { Predicate, RyotQLDocument } from "@ryot-app/contract/modules/ryotql/authored";
import { assert } from "@ryot-app/testing/assert";
import { Result } from "effect";

import { publicationBrowserSource } from "./publication-browse";
import { storedValidationBranches } from "./stored-validation";

const source = {
	from: { table: "entity", alias: "subject" },
	output: {
		orderBy: [],
		type: "rows",
		pagination: { limit: 10, maxLimit: 100 },
		fields: [{ key: "name", expr: { field: "name", type: "column", tableAlias: "subject" } }],
	},
} as const;
const mode = {
	type: "enum",
	label: "Mode",
	defaultValue: "good",
	description: "Validation mode",
	choices: {
		kind: "static",
		values: [
			{ value: "good", label: "Good" },
			{ value: "bad", label: "Bad" },
		],
	},
} as const;
const nameField = {
	key: "name",
	type: "text",
	kind: "value",
	field: "name",
	label: "Name",
} as const;

describe("stored authored validation", () => {
	it("validates publication browser controls across the full document", () => {
		const browser = publicationBrowserSource([{ slug: "root", pluginId: null }]);
		const result = storedValidationBranches(
			browser.dataSources,
			[
				{
					slug: "root",
					browse: null,
					pluginId: null,
					packageId: null,
					pluginScope: null,
					isEffective: true,
				},
			],
			{ type: "publication" },
		);
		assert(Result.isSuccess(result));
		for (const branch of result.success) {
			expect(Object.keys(branch.queries)).toEqual(["source", "ids", "count"]);
		}
	});

	it("rejects an invalid expression in a non-default choice", () => {
		const document: RyotQLDocument = {
			parameters: { fields: { mode } },
			queries: {
				items: {
					...source,
					where: {
						type: "and",
						predicates: Array.from({ length: 80 }, (): Predicate => ({
							type: "choice",
							parameter: "mode",
							cases: {
								good: { type: "and", predicates: [] },
								bad: {
									type: "isNull",
									expr: { type: "column", field: "absent", tableAlias: "subject" },
								},
							},
						})),
					},
				},
			},
		};
		const result = storedValidationBranches(document, []);
		assert(Result.isFailure(result));
		expect(result.failure.message).toContain("absent");
	});

	it("checks an unset optional branch rather than trusting saved arguments", () => {
		const document: RyotQLDocument = {
			parameters: {
				fields: { search: { type: "string", label: "Search", description: "Optional search" } },
			},
			queries: {
				items: {
					...source,
					where: {
						type: "whenSet",
						parameter: "search",
						predicate: {
							operator: "eq",
							type: "comparison",
							right: { name: "search", type: "parameter" },
							left: { type: "column", field: "absent", tableAlias: "subject" },
						},
					},
				},
			},
		};
		expect(Result.isFailure(storedValidationBranches(document, []))).toBe(true);
	});

	it("checks choice ordering even when the default order is valid", () => {
		const document: RyotQLDocument = {
			parameters: { fields: { mode } },
			queries: {
				items: {
					...source,
					output: {
						...source.output,
						orderBy: {
							type: "choice",
							parameter: "mode",
							cases: {
								good: [],
								bad: [
									{
										direction: "asc",
										expr: { type: "column", field: "absent", tableAlias: "subject" },
									},
								],
							},
						},
					},
				},
			},
		};
		expect(Result.isFailure(storedValidationBranches(document, []))).toBe(true);
	});

	it("resolves count controls against the explicit full rows projection", () => {
		const document: RyotQLDocument = {
			controls: { filter: { kind: "outputs", query: "members", fields: [nameField] } },
			queries: {
				members: source,
				count: {
					...source,
					where: { type: "filter" },
					output: {
						limit: 1,
						maxLimit: 1,
						type: "aggregate",
						measures: [{ key: "count", aggregation: { function: "count" } }],
					},
				},
			},
		};
		expect(Result.isSuccess(storedValidationBranches(document, []))).toBe(true);
		const count = document.queries["count"];
		assert(count);
		expect(
			Result.isFailure(
				storedValidationBranches(
					{
						...document,
						queries: {
							...document.queries,
							count: { ...count, from: { table: "event", alias: "subject" } },
						},
					},
					[],
				),
			),
		).toBe(true);
	});

	it("rejects duplicate keys and unavailable projection names in composite controls", () => {
		const document: RyotQLDocument = {
			queries: { items: source },
			controls: {
				filter: {
					kind: "composite",
					targets: [
						{ kind: "outputs", fields: [nameField] },
						{ kind: "outputs", fields: [nameField] },
					],
				},
			},
		};
		expect(Result.isFailure(storedValidationBranches(document, []))).toBe(true);
		expect(
			Result.isFailure(
				storedValidationBranches(
					{
						...document,
						controls: { filter: { kind: "outputs", query: "missing", fields: [nameField] } },
					},
					[],
				),
			),
		).toBe(true);
	});

	it("validates boolean and text-list controls using their available operators", () => {
		for (const type of ["boolean", "text-list"] as const) {
			const document: RyotQLDocument = {
				controls: {
					filter: {
						query: "items",
						kind: "outputs",
						fields: [{ type, key: "flag", kind: "value", field: "flag", label: "Flag" }],
					},
				},
				queries: {
					items: {
						...source,
						output: {
							...source.output,
							fields: [
								{
									key: "flag",
									expr: {
										path: ["flag"],
										type: "jsonPath",
										expr: { type: "column", field: "properties", tableAlias: "subject" },
									},
								},
							],
						},
					},
				},
			};
			expect(Result.isSuccess(storedValidationBranches(document, []))).toBe(true);
			const invalid: RyotQLDocument = {
				...document,
				queries: {
					items: {
						...source,
						output: {
							...source.output,
							fields: [
								{ key: "flag", expr: { type: "column", field: "absent", tableAlias: "subject" } },
							],
						},
					},
				},
			};
			expect(Result.isFailure(storedValidationBranches(invalid, []))).toBe(true);
		}
	});

	it("bounds branch expansion", () => {
		const fields = Object.fromEntries(Array.from({ length: 9 }, (_, index) => [`p${index}`, mode]));
		const predicates = Object.keys(fields).map((parameter) => ({
			parameter,
			type: "choice" as const,
			cases: {
				bad: { predicates: [], type: "and" as const },
				good: { predicates: [], type: "and" as const },
			},
		}));
		expect(
			Result.isFailure(
				storedValidationBranches(
					{
						parameters: { fields },
						queries: { items: { ...source, where: { predicates, type: "and" } } },
					},
					[],
				),
			),
		).toBe(true);
	});

	it("exposes only the symbolic source entity columns", () => {
		const items = {
			...source,
			from: { alias: "subject", parameter: "source", type: "sourceEntity" },
			output: {
				...source.output,
				fields: [{ key: "id", expr: { type: "column", field: "entityId", tableAlias: "subject" } }],
			},
		} as const;
		const document: RyotQLDocument = {
			queries: { items },
			parameters: {
				fields: {
					source: {
						type: "string",
						label: "Source",
						validation: { required: true },
						description: "Stored selection",
						reference: { kind: "entity-source" },
					},
				},
			},
		};
		expect(Result.isSuccess(storedValidationBranches(document, []))).toBe(true);
		expect(
			Result.isFailure(
				storedValidationBranches(
					{ ...document, queries: { items: { ...items, output: source.output } } },
					[],
				),
			),
		).toBe(true);
	});
});
