import { assert, describe, expect, it } from "@effect/vitest";
import type { UpdateEventItem } from "@ryot-app/plugin-backend-sdk/core";
import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";
import type { RyotQLDocument } from "@ryot-app/plugin-backend-sdk/ryotql";
import { defineSandboxTestHost, runSandboxTestScript } from "@ryot-app/plugin-backend-sdk/testing";

import { ExerciseNoteCreateInput } from "../../shared/exercise-note-operations";
import createDefinition, { manifest as createManifest } from "./exercise-note-create.sandbox";
import deleteDefinition, { manifest as deleteManifest } from "./exercise-note-delete.sandbox";
import updateDefinition, { manifest as updateManifest } from "./exercise-note-update.sandbox";
import { ExerciseNoteNotFoundError } from "./exercise-notes";

const execution = { metadata: {}, sandboxScriptId: "script-test" };

type StoredRow = Readonly<Record<string, string | null>>;

const tables: Readonly<Record<string, readonly StoredRow[]>> = {
	entity: [
		{ id: "exercise-1", entitySchemaSlug: "exercise", entitySchemaPluginId: "fitness-owner" },
		{ id: "foreign-exercise", entitySchemaSlug: "exercise", entitySchemaPluginId: "foreign-owner" },
		{ id: "movie-1", entitySchemaSlug: "movie", entitySchemaPluginId: "media-owner" },
		{ id: "collection-1", entitySchemaPluginId: null, entitySchemaSlug: "collection" },
	],
	event: [
		{
			id: "note-1",
			entityId: "exercise-1",
			eventSchemaSlug: "review",
			eventSchemaPluginId: "fitness-owner",
		},
		{
			id: "foreign-note",
			eventSchemaSlug: "review",
			entityId: "foreign-exercise",
			eventSchemaPluginId: "foreign-owner",
		},
		{
			entityId: "exercise-1",
			eventSchemaSlug: "review",
			id: "owner-mismatched-note",
			eventSchemaPluginId: "foreign-owner",
		},
		{
			id: "set-1",
			entityId: "exercise-1",
			eventSchemaSlug: "workout-set",
			eventSchemaPluginId: "fitness-owner",
		},
		{
			id: "media-review",
			entityId: "movie-1",
			eventSchemaSlug: "review",
			eventSchemaPluginId: "media-owner",
		},
		{
			id: "collection-review",
			entityId: "collection-1",
			eventSchemaSlug: "review",
			eventSchemaPluginId: null,
		},
	],
};

type Rows = Readonly<Record<string, StoredRow>>;

const evaluate = (expression: unknown, rows: Rows): unknown => {
	assert(typeof expression === "object" && expression !== null && "type" in expression);
	if (expression.type === "literal" && "value" in expression) {
		return expression.value;
	}
	if (expression.type === "pluginId" && "reference" in expression) {
		assert(
			typeof expression.reference === "object" &&
				expression.reference !== null &&
				"kind" in expression.reference &&
				expression.reference.kind === "self",
		);
		return "fitness-owner";
	}
	if (expression.type === "column" && "tableAlias" in expression && "field" in expression) {
		assert(typeof expression.tableAlias === "string" && typeof expression.field === "string");
		return rows[expression.tableAlias]?.[expression.field];
	}
	if (expression.type === "and" && "predicates" in expression) {
		assert(Array.isArray(expression.predicates));
		return expression.predicates.every((predicate) => evaluate(predicate, rows) === true);
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
				[key]: { items, type: "rows", pageInfo: { limit: 2, hasMore: false, nextCursor: null } },
			},
		};
	});

const recordingHosts = () => {
	const creates: unknown[] = [];
	const deletes: unknown[] = [];
	const updates: UpdateEventItem[][] = [];
	return {
		creates,
		deletes,
		updates,
		delete: defineSandboxTestHost(deleteManifest, {
			executeRyotql,
			deleteEvents: (ids) =>
				Effect.sync(() => {
					deletes.push(ids);
					return { count: ids.length };
				}),
		}),
		create: defineSandboxTestHost(createManifest, {
			executeRyotql,
			createEvents: (items) =>
				Effect.sync(() => {
					creates.push(items);
					return { count: items.length };
				}),
		}),
		update: defineSandboxTestHost(updateManifest, {
			executeRyotql,
			updateEvents: (items) =>
				Effect.sync(() => {
					updates.push([...items]);
					return { count: items.length };
				}),
		}),
	};
};

const foreignEventIds = [
	"missing",
	"set-1",
	"media-review",
	"collection-review",
	"foreign-note",
	"owner-mismatched-note",
];

describe("exercise note operations", () => {
	it.live("creates one review on an exercise with only note properties", () =>
		Effect.gen(function* () {
			const hosts = recordingHosts();

			expect(
				yield* runSandboxTestScript(
					createDefinition,
					{ rating: 80, exerciseId: "exercise-1", text: "  Keep elbows tucked  " },
					hosts.create,
					execution,
				),
			).toEqual({ count: 1 });
			yield* runSandboxTestScript(
				createDefinition,
				{ text: "No rating", exerciseId: "exercise-1" },
				hosts.create,
				execution,
			);

			expect(hosts.creates).toEqual([
				[
					{
						entityId: "exercise-1",
						eventSchemaSlug: "review",
						properties: { rating: 80, text: "Keep elbows tucked" },
					},
				],
				[{ entityId: "exercise-1", eventSchemaSlug: "review", properties: { text: "No rating" } }],
			]);
		}),
	);

	it.live("rejects creating a note on a non-exercise or missing entity without writing", () =>
		Effect.gen(function* () {
			const hosts = recordingHosts();

			for (const exerciseId of ["movie-1", "collection-1", "missing", "foreign-exercise"]) {
				const failure = yield* Effect.flip(
					runSandboxTestScript(
						createDefinition,
						{ exerciseId, text: "Note" },
						hosts.create,
						execution,
					),
				);
				expect(failure).toBeInstanceOf(ExerciseNoteNotFoundError);
			}
			expect(hosts.creates).toEqual([]);
		}),
	);

	it.live("rejects updating or deleting anything but an exercise review without writing", () =>
		Effect.gen(function* () {
			const hosts = recordingHosts();

			for (const noteId of foreignEventIds) {
				const updateFailure = yield* Effect.flip(
					runSandboxTestScript(
						updateDefinition,
						{ noteId, rating: 20, text: "Changed" },
						hosts.update,
						execution,
					),
				);
				expect(updateFailure).toBeInstanceOf(ExerciseNoteNotFoundError);
				const deleteFailure = yield* Effect.flip(
					runSandboxTestScript(deleteDefinition, { noteId }, hosts.delete, execution),
				);
				expect(deleteFailure).toBeInstanceOf(ExerciseNoteNotFoundError);
			}
			expect(hosts.updates).toEqual([]);
			expect(hosts.deletes).toEqual([]);
		}),
	);

	it.live("patches only note properties and removes a cleared rating", () =>
		Effect.gen(function* () {
			const hosts = recordingHosts();

			yield* runSandboxTestScript(
				updateDefinition,
				{ rating: 60, noteId: "note-1", text: " Heavier " },
				hosts.update,
				execution,
			);
			yield* runSandboxTestScript(
				updateDefinition,
				{ rating: null, text: "Cleared", noteId: "note-1" },
				hosts.update,
				execution,
			);

			expect(hosts.updates).toEqual([
				[
					{
						eventId: "note-1",
						patch: { properties: { remove: [], set: { rating: 60, text: "Heavier" } } },
					},
				],
				[
					{
						eventId: "note-1",
						patch: { properties: { remove: ["rating"], set: { text: "Cleared" } } },
					},
				],
			]);
			for (const [item] of hosts.updates) {
				expect(Object.keys(item?.patch ?? {})).toEqual(["properties"]);
			}
		}),
	);

	it.live("deletes an exercise review by its id", () =>
		Effect.gen(function* () {
			const hosts = recordingHosts();

			expect(
				yield* runSandboxTestScript(
					deleteDefinition,
					{ noteId: "note-1" },
					hosts.delete,
					execution,
				),
			).toEqual({ count: 1 });
			expect(hosts.deletes).toEqual([["note-1"]]);
		}),
	);

	it("rejects blank and oversized note text", () => {
		const decode = Schema.decodeUnknownSync(ExerciseNoteCreateInput);
		expect(() => decode({ text: "   ", exerciseId: "exercise-1" })).toThrow();
		expect(() => decode({ text: "a".repeat(2001), exerciseId: "exercise-1" })).toThrow();
		expect(() => decode({ rating: 101, text: "Note", exerciseId: "exercise-1" })).toThrow();
		expect(decode({ exerciseId: "exercise-1", text: ` ${"a".repeat(2000)} ` }).text).toHaveLength(
			2000,
		);
	});
});
