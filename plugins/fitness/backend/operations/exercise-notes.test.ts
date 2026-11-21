import { describe, expect } from "bun:test";

import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";
import { defineSandboxTestHost, runSandboxTestScript } from "@ryot-app/plugin-backend-sdk/testing";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { it } from "@voila.dev/effect-bun-test";

import {
	ExerciseNoteCreateInput,
	type ExerciseNoteUpdateInput,
} from "../../shared/exercise-note-operations";
import createDefinition, { manifest as createManifest } from "./exercise-note-create.sandbox";
import deleteDefinition, { manifest as deleteManifest } from "./exercise-note-delete.sandbox";
import updateDefinition, { manifest as updateManifest } from "./exercise-note-update.sandbox";
import { ExerciseNoteNotFoundError } from "./exercise-notes";
import { inMemoryRyotql, type StoredTables } from "./in-memory-ryotql.test-support";

const execution = { metadata: {}, sandboxScriptId: "script-test" };

const tables: StoredTables = {
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

const executeRyotql = inMemoryRyotql(tables);

const hosts = {
	delete: defineSandboxTestHost(deleteManifest, { executeRyotql }),
	update: defineSandboxTestHost(updateManifest, { executeRyotql }),
	create: defineSandboxTestHost(createManifest, { executeRyotql }),
};

const update = (input: ExerciseNoteUpdateInput) =>
	runSandboxTestScript(updateDefinition, input, hosts.update, execution);

const noteCreated = (properties: Record<string, unknown>) => ({
	output: { count: 1 },
	changes: {
		events: {
			changes: [
				{
					properties,
					kind: "create",
					eventSchemaSlug: "review",
					itemIdentity: "review:exercise-1",
					entity: { kind: "existing", entityId: "exercise-1" },
				},
			],
		},
	},
});

const noteUpdated = (properties: { readonly set: unknown; readonly remove: string[] }) => ({
	output: { count: 1 },
	changes: {
		events: {
			changes: [
				{
					kind: "update",
					itemIdentity: "update:note-1",
					item: { eventId: "note-1", patch: { properties } },
				},
			],
		},
	},
});

const foreignEventIds = [
	"missing",
	"set-1",
	"media-review",
	"collection-review",
	"foreign-note",
	"owner-mismatched-note",
];

describe("exercise note operations", () => {
	it.live(
		"creates one review on an exercise with only note properties",
		() =>
			Effect.gen(function* () {
				expect(
					yield* runSandboxTestScript(
						createDefinition,
						{ rating: 80, exerciseId: "exercise-1", text: "  Keep elbows tucked  " },
						hosts.create,
						execution,
					),
				).toEqual<unknown>(noteCreated({ rating: 80, text: "Keep elbows tucked" }));
				expect(
					yield* runSandboxTestScript(
						createDefinition,
						{ text: "No rating", exerciseId: "exercise-1" },
						hosts.create,
						execution,
					),
				).toEqual<unknown>(noteCreated({ text: "No rating" }));
			}),
		testTimeout,
	);

	it.live(
		"rejects creating a note on a non-exercise or missing entity",
		() =>
			Effect.gen(function* () {
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
			}),
		testTimeout,
	);

	it.live(
		"rejects updating or deleting anything but an exercise review",
		() =>
			Effect.gen(function* () {
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
			}),
		testTimeout,
	);

	it.live(
		"patches only note properties, removes a cleared rating, and keeps notes spoiler-free",
		() =>
			Effect.gen(function* () {
				expect(yield* update({ rating: 60, noteId: "note-1", text: " Heavier " })).toEqual<unknown>(
					noteUpdated({ remove: ["isSpoiler"], set: { rating: 60, text: "Heavier" } }),
				);
				expect(yield* update({ rating: null, text: "Cleared", noteId: "note-1" })).toEqual<unknown>(
					noteUpdated({ set: { text: "Cleared" }, remove: ["isSpoiler", "rating"] }),
				);
			}),
		testTimeout,
	);

	it.live(
		"deletes an exercise review by its id",
		() =>
			Effect.gen(function* () {
				expect(
					yield* runSandboxTestScript(
						deleteDefinition,
						{ noteId: "note-1" },
						hosts.delete,
						execution,
					),
				).toEqual<unknown>({
					output: { count: 1 },
					changes: {
						events: {
							changes: [{ kind: "delete", eventId: "note-1", itemIdentity: "delete:note-1" }],
						},
					},
				});
			}),
		testTimeout,
	);

	it.effect(
		"rejects blank and oversized note text",
		() =>
			Effect.gen(function* () {
				const decode = Schema.decodeUnknownEffect(ExerciseNoteCreateInput);
				yield* Effect.flip(decode({ text: "   ", exerciseId: "exercise-1" }));
				yield* Effect.flip(decode({ text: "a".repeat(2001), exerciseId: "exercise-1" }));
				yield* Effect.flip(decode({ rating: 101, text: "Note", exerciseId: "exercise-1" }));
				expect(
					(yield* decode({ exerciseId: "exercise-1", text: ` ${"a".repeat(2000)} ` })).text,
				).toHaveLength(2000);
			}),
		testTimeout,
	);
});
