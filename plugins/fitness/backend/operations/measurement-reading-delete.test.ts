import { assert, describe, expect, it } from "@effect/vitest";
import { Effect } from "@ryot-app/sandbox-sdk/effect";
import type { RyotQLDocument } from "@ryot-app/sandbox-sdk/ryotql";
import { defineSandboxTestHost, runSandboxTestScript } from "@ryot-app/sandbox-sdk/testing";

import deleteDefinition, {
	manifest,
	MeasurementReadingNotFoundError,
} from "./measurement-reading-delete.sandbox";

const execution = { metadata: {}, sandboxScriptId: "script-test" };

type StoredRow = Readonly<Record<string, string>>;
type Rows = Readonly<Record<string, StoredRow>>;

const tables: Readonly<Record<string, readonly StoredRow[]>> = {
	entity: [
		{ id: "weight", entitySchemaSlug: "measurement-metric" },
		{ id: "exercise-1", entitySchemaSlug: "exercise" },
	],
	event: [
		{ id: "reading-1", entityId: "weight", eventSchemaSlug: "measurement-reading" },
		{ id: "reading-2", entityId: "weight", eventSchemaSlug: "measurement-reading" },
		{ id: "note-1", entityId: "exercise-1", eventSchemaSlug: "review" },
		{ id: "fake-reading", entityId: "exercise-1", eventSchemaSlug: "measurement-reading" },
	],
};

const evaluate = (expression: unknown, rows: Rows): unknown => {
	assert(typeof expression === "object" && expression !== null && "type" in expression);
	if (expression.type === "literal" && "value" in expression) {
		return expression.value;
	}
	if (expression.type === "column" && "tableAlias" in expression && "field" in expression) {
		assert(typeof expression.tableAlias === "string" && typeof expression.field === "string");
		return rows[expression.tableAlias]?.[expression.field];
	}
	if (expression.type === "and" && "predicates" in expression) {
		assert(Array.isArray(expression.predicates));
		return expression.predicates.every((predicate) => evaluate(predicate, rows) === true);
	}
	if (expression.type === "in" && "expr" in expression && "values" in expression) {
		assert(Array.isArray(expression.values));
		const value = evaluate(expression.expr, rows);
		return expression.values.some((candidate) => evaluate(candidate, rows) === value);
	}
	if (
		expression.type === "comparison" &&
		"operator" in expression &&
		expression.operator === "eq" &&
		"left" in expression &&
		"right" in expression
	) {
		return evaluate(expression.left, rows) === evaluate(expression.right, rows);
	}
	throw new Error("Unsupported RyotQL expression");
};

const executeRyotql = (document: RyotQLDocument) =>
	Effect.sync(() => {
		const [[key, query] = []] = Object.entries(document.queries);
		assert(key !== undefined && query?.output.type === "rows");
		let rows: Rows[] = (tables[query.from.table] ?? []).map((row) => ({ [query.from.alias]: row }));
		for (const joined of query.joins ?? []) {
			assert(joined.type === "inner");
			rows = rows.flatMap((row) =>
				(tables[joined.table.table] ?? [])
					.map((candidate) => Object.assign({ [joined.table.alias]: candidate }, row))
					.filter((candidate) => evaluate(joined.on, candidate) === true),
			);
		}
		const items = rows
			.filter((row) => query.where === undefined || evaluate(query.where, row) === true)
			.map((row) => ({ id: row[query.from.alias]?.id }));
		return {
			data: {
				[key]: { items, type: "rows", pageInfo: { limit: 100, hasMore: false, nextCursor: null } },
			},
		};
	});

const recordingHost = (deletes: (readonly string[])[]) =>
	defineSandboxTestHost(manifest, {
		executeRyotql,
		deleteEvents: (ids) =>
			Effect.sync(() => {
				deletes.push(ids);
				return { count: ids.length };
			}),
	});

describe("measurement reading delete operation", () => {
	it.live("deletes every reading in the request once", () =>
		Effect.gen(function* () {
			const deletes: (readonly string[])[] = [];

			expect(
				yield* runSandboxTestScript(
					deleteDefinition,
					{ readingIds: ["reading-1", "reading-2", "reading-1"] },
					recordingHost(deletes),
					execution,
				),
			).toEqual({ count: 2 });
			expect(deletes).toEqual([["reading-1", "reading-2"]]);
		}),
	);

	it.live("rejects any id that is not a measurement reading without deleting", () =>
		Effect.gen(function* () {
			const deletes: (readonly string[])[] = [];
			const host = recordingHost(deletes);

			for (const readingIds of [
				["reading-1", "missing"],
				["reading-1", "note-1"],
				["fake-reading"],
			]) {
				const failure = yield* Effect.flip(
					runSandboxTestScript(deleteDefinition, { readingIds }, host, execution),
				);
				expect(failure).toBeInstanceOf(MeasurementReadingNotFoundError);
			}
			yield* Effect.flip(
				runSandboxTestScript(deleteDefinition, { readingIds: [] }, host, execution),
			);

			expect(deletes).toEqual([]);
		}),
	);
});
