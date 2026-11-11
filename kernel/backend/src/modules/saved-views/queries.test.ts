import { describe, expect, it } from "bun:test";

import type { RyotQLDocument } from "@ryot-app/contract/modules/ryotql/authored";
import { entityBrowserFields } from "@ryot-app/contract/modules/saved-views/entity-browser-fields";
import { Result } from "effect";

import { storedValidationBranches } from "#modules/ryotql/stored-validation";

import { deriveSavedViewQueries } from "./queries";

const renderer = { kind: "kernel", name: "entity-browser" } as const;
const settings = {
	pageSize: 20,
	addAction: null,
	layouts: ["grid"],
	tableColumns: null,
	sourceName: "items",
	defaultLayout: "grid",
	summary: { image: null, subtitle: null },
	subject: { entityAlias: "subject", schemas: [{ slug: "root", owner: { kind: "kernel" } }] },
} as const;
const query = {
	from: { table: "entity", alias: "subject" },
	output: {
		orderBy: [],
		type: "rows",
		pagination: { limit: 20, maxLimit: 100 },
		fields: [{ key: "name", expr: { field: "name", type: "column", tableAlias: "subject" } }],
	},
} as const;
const document: RyotQLDocument = { queries: { items: query, librarySearch: query } };

describe("server-derived saved selections", () => {
	it("persists the fixed browser fields and separate primary and library counts idempotently", () => {
		const derived = Result.getOrThrow(deriveSavedViewQueries(renderer, settings, document));
		expect(Object.keys(derived.queries)).toEqual([
			"items",
			"librarySearch",
			"ids",
			"count",
			"librarySearchCount",
		]);
		const items = derived.queries["items"];
		expect(
			items?.output.type === "rows"
				? items.output.fields.flatMap((field) => ("key" in field ? [field.key] : []))
				: [],
		).toEqual([
			"name",
			entityBrowserFields.id,
			entityBrowserFields.name,
			entityBrowserFields.owner,
			entityBrowserFields.schema,
			entityBrowserFields.population,
			entityBrowserFields.translation,
		]);
		expect(Result.isSuccess(storedValidationBranches(derived, []))).toBe(true);
		expect(Result.getOrThrow(deriveSavedViewQueries(renderer, settings, derived, true))).toEqual(
			derived,
		);
	});

	it("rejects authored reserved fields and derived query names", () => {
		const reserved: RyotQLDocument = {
			queries: {
				items: {
					...query,
					output: {
						...query.output,
						fields: [{ key: entityBrowserFields.id, expr: { type: "literal", value: "spoofed" } }],
					},
				},
			},
		};
		expect(Result.isFailure(deriveSavedViewQueries(renderer, settings, reserved))).toBe(true);
		expect(
			Result.isFailure(
				deriveSavedViewQueries(renderer, settings, { queries: { items: query, count: query } }),
			),
		).toBe(true);
		expect(
			Result.isFailure(
				deriveSavedViewQueries(renderer, settings, {
					queries: { items: query, librarySearchCount: query },
				}),
			),
		).toBe(true);
	});

	it("checks the library search subject independently of the primary projection", () => {
		const derived = Result.getOrThrow(
			deriveSavedViewQueries(renderer, settings, {
				queries: {
					items: query,
					librarySearch: { ...query, from: { alias: "other", table: "entity" } },
				},
			}),
		);
		expect(Result.isFailure(storedValidationBranches(derived, []))).toBe(true);
	});
});
