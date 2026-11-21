import { describe, expect } from "bun:test";

import type {
	RyotQLDocument as ImportedRyotQLDocument,
	RyotQLDocument,
} from "@ryot-app/contract/modules/ryotql/language";
import type { ChangeSet } from "@ryot-app/plugin-backend-sdk/core";
import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";
import { OperationRejectedError } from "@ryot-app/plugin-backend-sdk/operation";
import { defineSandboxTestHost, runSandboxTestScript } from "@ryot-app/plugin-backend-sdk/testing";
import type { LocalMessage } from "@ryot-app/plugin-kit/messages";
import { bindTestRequest } from "@ryot-app/ryotql-recipes/test-utils";
import { assert } from "@ryot-app/testing/assert";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { it } from "@voila.dev/effect-bun-test";

import {
	MediaActivityDeleteInput,
	type MediaActivityPatch,
	MediaActivityUpdateInput,
	type MediaEventSnapshot,
} from "../../shared/media-activity-operations";
import { catalogMessage } from "../../shared/messages.generated";
import { execution } from "../../tests/backend/automations/automation-test-utils";
import { ryotqlDocumentNodes } from "../../tests/ryotql-test-utils";
import deleteDefinition from "./media-activity-delete.sandbox";
import updateDefinition, { manifest as updateManifest } from "./media-activity-update.sandbox";

type StoredEvent = {
	readonly id: string;
	readonly eventSchemaSlug: string;
	readonly entitySchemaSlug: string;
	readonly properties: Record<string, Schema.Json>;
};

const submittedAt = "2026-03-10T09:00:00.000Z";

const expected = {
	entityId: "movie-1",
	sessionEntityId: null,
	occurredAt: "2026-03-01T12:00:00.000Z",
	properties: { consumedOn: ["Netflix"] },
	absentProperties: ["startedOn", "dateUnknown", "timeSpent"],
};

const page = (items: readonly unknown[]) => ({
	items,
	type: "rows",
	pageInfo: { limit: 100, hasMore: false, nextCursor: null },
});

const isLiteral = (node: unknown): node is { readonly value: string; readonly type: "literal" } =>
	typeof node === "object" && node !== null && "type" in node && node.type === "literal";
const requestedIds = (document: ImportedRyotQLDocument) =>
	ryotqlDocumentNodes(document.queries["visible"])
		.filter(isLiteral)
		.map(({ value }) => value);

/**
 * Resolves `visible` as every known id and `allowed` as the known ids of media activity schemas;
 * the real allow-list predicate is asserted separately through the document it sends.
 */
const recordingHost = (input: {
	readonly scopeRevision?: number;
	readonly events: readonly StoredEvent[];
	readonly disallowed?: readonly string[];
	readonly namingReviews?: readonly string[];
	readonly episodeParents?: Readonly<Record<string, string>>;
}) => {
	const documents: RyotQLDocument[] = [];
	const host = defineSandboxTestHost(updateManifest, {
		executeRyotql: (document) =>
			Effect.sync(() => {
				documents.push(bindTestRequest(document));
				if (bindTestRequest(document).queries["parents"] !== undefined) {
					const parent = ryotqlDocumentNodes(bindTestRequest(document).queries["parents"])
						.filter(isLiteral)
						.map(({ value }) => input.episodeParents?.[value])
						.find((id) => id !== undefined);
					return {
						data: {
							parents: page(
								parent === undefined ? [] : [{ seasonNumber: 1, parentEntityId: parent }],
							),
						},
					};
				}
				if (bindTestRequest(document).queries["scope"] !== undefined) {
					return {
						data: {
							scope: page(
								input.scopeRevision === undefined ? [] : [{ revision: input.scopeRevision }],
							),
						},
					};
				}
				if (bindTestRequest(document).queries["reviews"] !== undefined) {
					return { data: { reviews: page((input.namingReviews ?? []).map((id) => ({ id }))) } };
				}
				const ids = requestedIds(bindTestRequest(document));
				const known = input.events.filter(({ id }) => ids.includes(id));
				return {
					data: {
						visible: page(known.map(({ id }) => ({ id }))),
						allowed: page(known.filter(({ id }) => !input.disallowed?.includes(id))),
					},
				};
			}),
	});
	return { host, documents };
};

const eventChanges = (result: { readonly changes?: ChangeSet }) =>
	result.changes?.events?.changes ?? [];

const updateItem = (result: { readonly changes?: ChangeSet }, index = 0) => {
	const change = eventChanges(result)[index];
	assert(change?.kind === "update");
	return change.item;
};

const deletedIds = (result: { readonly changes?: ChangeSet }) =>
	eventChanges(result).flatMap((change) => (change.kind === "delete" ? [change.eventId] : []));

const movieCompletion: StoredEvent = {
	id: "event-1",
	entitySchemaSlug: "movie",
	eventSchemaSlug: "complete",
	properties: { consumedOn: ["Netflix"] },
};

const update = (
	patch: MediaActivityPatch,
	host: ReturnType<typeof recordingHost>["host"],
	snapshot: typeof MediaEventSnapshot.Encoded = expected,
) =>
	runSandboxTestScript(
		updateDefinition,
		{ patch, submittedAt, expected: snapshot, eventId: "event-1", submissionId: "submission" },
		host,
		execution,
	);

const remove = (
	input: { readonly submissionId?: string; readonly eventIds: readonly string[] },
	host: ReturnType<typeof recordingHost>["host"],
) =>
	runSandboxTestScript(
		deleteDefinition,
		{ submittedAt, submissionId: "submission", ...input },
		host,
		execution,
	);

const rejection = <A, E>(effect: Effect.Effect<A, E>) =>
	Effect.gen(function* () {
		const result = yield* Effect.result(effect);
		expect(result).toMatchObject({ _tag: "Failure", failure: { _tag: "OperationRejectedError" } });
		return result._tag === "Failure" && result.failure instanceof OperationRejectedError
			? result.failure.reason
			: undefined;
	});

const eventIds = (count: number) =>
	Array.from({ length: count }, (_, index) => `event-${String(index).padStart(3, "0")}`);

const movieCompletions = (ids: readonly string[]) => ids.map((id) => ({ ...movieCompletion, id }));

const episodeCompletion: StoredEvent = {
	id: "event-1",
	properties: {},
	eventSchemaSlug: "complete",
	entitySchemaSlug: "show-episode",
};

const episodeSnapshot = { ...expected, entityId: "episode-1", sessionEntityId: "show-1" };

describe("media activity update", () => {
	it.live.each(["show-episode", "podcast-episode"] as const)(
		"moves a %s record to another episode of the same parent",
		(entitySchemaSlug) =>
			Effect.gen(function* () {
				const { host } = recordingHost({
					events: [{ ...episodeCompletion, entitySchemaSlug }],
					episodeParents: { "episode-1": "parent-1", "episode-2": "parent-1" },
				});
				expect(
					updateItem(yield* update({ episodeEntityId: "episode-2" }, host, episodeSnapshot)).patch,
				).toEqual<unknown>({ entityId: "episode-2" });
			}),
		testTimeout,
	);

	it.live(
		"clears the episode link of reviews naming a record in the same write as it moves",
		() =>
			Effect.gen(function* () {
				const { host } = recordingHost({
					scopeRevision: 7,
					events: [episodeCompletion],
					namingReviews: ["review-1", "review-2"],
					episodeParents: { "episode-1": "show-1", "episode-2": "show-1" },
				});
				const result = yield* update({ episodeEntityId: "episode-2" }, host, episodeSnapshot);
				expect(result.output).toEqual({ count: 1 });
				expect(result.changes?.events?.baselines).toEqual<unknown>([
					{ revision: 7, entityId: "episode-1" },
				]);
				expect(eventChanges(result).map((change) => change.itemIdentity)).toEqual([
					"update:event-1",
					"update:review-1",
					"update:review-2",
				]);
				expect(updateItem(result, 0).expected).toEqual<unknown>({
					...episodeSnapshot,
					kind: "fields",
				});
				expect(updateItem(result, 1)).toEqual<unknown>({
					eventId: "review-1",
					patch: { properties: { set: {}, remove: ["consumptionEventId"] } },
				});
				expect(updateItem(result, 2)).toEqual<unknown>({
					eventId: "review-2",
					patch: { properties: { set: {}, remove: ["consumptionEventId"] } },
				});
			}),
		testTimeout,
	);

	it.live(
		"leaves reviews linked when the record stays on its episode",
		() =>
			Effect.gen(function* () {
				const { host } = recordingHost({
					events: [episodeCompletion],
					namingReviews: ["review-1"],
					episodeParents: { "episode-1": "show-1" },
				});
				const result = yield* update(
					{ timeSpent: 20, episodeEntityId: "episode-1" },
					host,
					episodeSnapshot,
				);
				expect(eventChanges(result)).toHaveLength(1);
				expect(result.changes?.events?.baselines).toBeUndefined();
			}),
		testTimeout,
	);

	it.live(
		"moves a show record to an episode of another season of the same show",
		() =>
			Effect.gen(function* () {
				const { host } = recordingHost({
					events: [{ ...episodeCompletion, eventSchemaSlug: "progress" }],
					episodeParents: { "episode-1": "show-1", "special-1": "show-1" },
				});
				expect(
					updateItem(
						yield* update(
							{ progressPercent: 40, episodeEntityId: "special-1" },
							host,
							episodeSnapshot,
						),
					).patch,
				).toEqual<unknown>({
					entityId: "special-1",
					properties: { remove: [], set: { progressPercent: 40 } },
				});
			}),
		testTimeout,
	);

	it.live(
		"treats a move to the current episode as no change",
		() =>
			Effect.gen(function* () {
				const { host } = recordingHost({
					events: [episodeCompletion],
					episodeParents: { "episode-1": "show-1" },
				});
				expect(
					updateItem(
						yield* update({ timeSpent: 20, episodeEntityId: "episode-1" }, host, episodeSnapshot),
					).patch,
				).toEqual({ properties: { remove: [], set: { timeSpent: 20 } } });
			}),
		testTimeout,
	);

	it.live(
		"rejects a move to an episode of another parent",
		() =>
			Effect.gen(function* () {
				const { host } = recordingHost({
					events: [episodeCompletion],
					episodeParents: { "episode-1": "show-1", "episode-9": "show-2" },
				});
				expect(
					yield* rejection(update({ episodeEntityId: "episode-9" }, host, episodeSnapshot)),
				).toEqual(
					catalogMessage("rejection.activity.episode-move-other-parent", { parent: "show" }),
				);
			}),
		testTimeout,
	);

	it.live(
		"rejects a move to an episode that is not visible or of another kind",
		() =>
			Effect.gen(function* () {
				const { host } = recordingHost({
					events: [episodeCompletion],
					episodeParents: { "episode-1": "show-1" },
				});
				expect(
					yield* rejection(update({ episodeEntityId: "hidden-1" }, host, episodeSnapshot)),
				).toEqual(catalogMessage("rejection.activity.episode-unavailable"));
			}),
		testTimeout,
	);

	it.live.each([
		{ event: movieCompletion, name: "a movie completion" },
		{ name: "an anime completion", event: { ...movieCompletion, entitySchemaSlug: "anime" } },
	])(
		"rejects an episode move on $name",
		({ event }) =>
			Effect.gen(function* () {
				const { host } = recordingHost({
					events: [event],
					episodeParents: { "episode-1": "show-1", "episode-2": "show-1" },
				});
				yield* rejection(update({ episodeEntityId: "episode-2" }, host, episodeSnapshot));
			}),
		testTimeout,
	);

	it.effect(
		"edits an independent item without changing its retained source facts",
		() =>
			Effect.gen(function* () {
				const { host } = recordingHost({
					events: [
						{
							id: "event-1",
							entitySchemaSlug: "manga",
							eventSchemaSlug: "item-complete",
							properties: {
								sourceRun: "original",
								position: { position: 12.5, unit: "chapters" },
								consumptionBasis: { unit: "chapters", property: "chapters" },
							},
						},
					],
				});
				expect(
					updateItem(yield* update({ position: { position: 3.5, unit: "volumes" } }, host)).patch,
				).toEqual({
					properties: { remove: [], set: { position: { position: 3.5, unit: "volumes" } } },
				});
			}),
		testTimeout,
	);
	it.live(
		"patches dates, source, and time spent under the full precondition",
		() =>
			Effect.gen(function* () {
				const { host } = recordingHost({ events: [movieCompletion] });
				expect(
					yield* update(
						{
							timeSpent: 95,
							consumedOn: null,
							when: {
								kind: "date",
								startedOn: "2026-03-04T12:00:00.000Z",
								finishedOn: "2026-03-05T12:00:00.000Z",
							},
						},
						host,
					),
				).toEqual<unknown>({
					output: { count: 1 },
					changes: {
						events: {
							changes: [
								{
									kind: "update",
									itemIdentity: "update:event-1",
									item: {
										eventId: "event-1",
										expected: { ...expected, kind: "fields" },
										patch: {
											occurredAt: "2026-03-05T12:00:00.000Z",
											properties: {
												remove: ["calendarDate", "dateUnknown", "consumedOn"],
												set: { timeSpent: 95, startedOn: "2026-03-04T12:00:00.000Z" },
											},
										},
									},
								},
							],
						},
					},
				});
			}),
		testTimeout,
	);

	it.live(
		"marks the date unknown without moving the recorded time",
		() =>
			Effect.gen(function* () {
				const { host } = recordingHost({ events: [movieCompletion] });
				expect(updateItem(yield* update({ when: { kind: "unknown" } }, host)).patch).toEqual({
					properties: { set: { dateUnknown: true }, remove: ["calendarDate", "startedOn"] },
				});
			}),
		testTimeout,
	);

	it.live(
		"writes a cumulative position on positional media",
		() =>
			Effect.gen(function* () {
				const { host } = recordingHost({
					events: [
						{
							id: "event-1",
							properties: {},
							entitySchemaSlug: "manga",
							eventSchemaSlug: "progress",
						},
					],
				});
				expect(
					updateItem(
						yield* update({ position: { volume: 2, position: 12.5, unit: "chapters" } }, host),
					).patch,
				).toEqual({
					properties: {
						remove: [],
						set: { position: { volume: 2, position: 12.5, unit: "chapters" } },
					},
				});
			}),
		testTimeout,
	);

	it.live.each([
		{ name: "list-state", event: { entitySchemaSlug: "anime", eventSchemaSlug: "list-state" } },
		{
			name: "add-to-media-library",
			event: { entitySchemaSlug: "movie", eventSchemaSlug: "add-to-media-library" },
		},
		{ name: "a review", event: { entitySchemaSlug: "movie", eventSchemaSlug: "review" } },
		{
			name: "a non-media entity",
			event: { eventSchemaSlug: "review", entitySchemaSlug: "collection" },
		},
	])(
		"refuses to edit $name",
		({ event }) =>
			Effect.gen(function* () {
				const { host } = recordingHost({
					disallowed: ["event-1"],
					events: [{ ...event, id: "event-1", properties: {} }],
				});
				expect(yield* rejection(update({ consumedOn: ["Plex"] }, host))).toEqual(
					catalogMessage("rejection.record.activity-only-edit"),
				);
			}),
		testTimeout,
	);

	it.live(
		"allows only plugin-owned lifecycle events on media and episode schemas",
		() =>
			Effect.gen(function* () {
				const { host, documents } = recordingHost({ events: [movieCompletion] });
				yield* update({ consumedOn: ["Plex"] }, host);
				const nodes = ryotqlDocumentNodes(documents[0]?.queries["allowed"]);
				for (const slug of ["complete", "progress", "dropped", "on_hold", "backlog"]) {
					expect(nodes).toContainEqual({ value: slug, type: "literal" });
				}
				for (const slug of ["show-episode", "podcast-episode", "movie", "anime"]) {
					expect(nodes).toContainEqual({ value: slug, type: "literal" });
				}
				for (const slug of [
					"list-state",
					"add-to-media-library",
					"review",
					"collection",
					"genre",
				]) {
					expect(nodes).not.toContainEqual({ value: slug, type: "literal" });
				}
				expect(nodes).toContainEqual({ type: "pluginId", reference: { kind: "self" } });
				expect(nodes).not.toContainEqual({ type: "pluginId", reference: { kind: "kernel" } });
			}),
		testTimeout,
	);

	it("rejects unknown keys and identity patches under the sandbox's strict decoding", () => {
		const decode = Schema.decodeUnknownResult(MediaActivityUpdateInput, {
			onExcessProperty: "error",
		});
		const valid = {
			expected,
			submittedAt,
			eventId: "event-1",
			submissionId: "submission",
			patch: { consumedOn: ["Plex"] },
		};
		expect(decode(valid)._tag).toBe("Success");
		for (const invalid of [
			{ ...valid, entityId: "movie-2" },
			{ ...valid, patch: { entityId: "movie-2", consumedOn: ["Plex"] } },
			{ ...valid, patch: { consumedOn: ["Plex"], sessionEntityId: "show-2" } },
			{ ...valid, patch: {} },
			{ ...valid, expected: { ...expected, kind: "fields" } },
		]) {
			expect(decode(invalid)._tag).toBe("Failure");
		}
		expect(
			Schema.decodeResult(MediaActivityDeleteInput, { onExcessProperty: "error" })({
				submittedAt,
				submissionId: "submission",
				eventIds: ["event-1", "event-1"],
			})._tag,
		).toBe("Failure");
	});

	it.live.each([
		{
			name: "a source on backlog",
			patch: { consumedOn: ["Kindle"] },
			event: { entitySchemaSlug: "book", eventSchemaSlug: "backlog" },
			reason: catalogMessage("rejection.activity.field-locked", { field: "consumedOn" }),
		},
		{
			patch: { progressPercent: 40 },
			name: "progress on a show's on hold",
			event: { entitySchemaSlug: "show", eventSchemaSlug: "on_hold" },
			reason: catalogMessage("rejection.activity.field-locked", { field: "progress" }),
		},
		{
			patch: { progressPercent: 40 },
			name: "a percent on positional media",
			reason: catalogMessage("rejection.progress.position-only"),
			event: { entitySchemaSlug: "anime", eventSchemaSlug: "progress" },
		},
		{
			name: "a position on percent media",
			patch: { position: { position: 3, unit: "episodes" } },
			reason: catalogMessage("rejection.progress.percent-only"),
			event: { entitySchemaSlug: "book", eventSchemaSlug: "progress" },
		},
		{
			name: "an episode position on manga progress",
			patch: { position: { position: 3, unit: "episodes" } },
			reason: catalogMessage("rejection.position.unsupported"),
			event: { entitySchemaSlug: "manga", eventSchemaSlug: "progress" },
		},
		{
			name: "a fractional anime episode",
			patch: { position: { position: 3.5, unit: "episodes" } },
			reason: catalogMessage("rejection.position.episode-not-whole"),
			event: { entitySchemaSlug: "anime", eventSchemaSlug: "progress" },
		},
	] satisfies readonly {
		readonly name: string;
		readonly reason: LocalMessage;
		readonly patch: MediaActivityPatch;
		readonly event: Omit<StoredEvent, "id" | "properties">;
	}[])(
		"refuses $name as a typed rejection",
		({ event, patch, reason }) =>
			Effect.gen(function* () {
				const { host } = recordingHost({ events: [{ ...event, id: "event-1", properties: {} }] });
				expect(yield* rejection(update(patch, host))).toEqual(reason);
			}),
		testTimeout,
	);

	it.live(
		"accepts dates and progress fields each schema declares",
		() =>
			Effect.gen(function* () {
				for (const [event, patch] of [
					[
						{ entitySchemaSlug: "movie", eventSchemaSlug: "progress" },
						{
							when: {
								kind: "date",
								calendarDate: "2026-03-05",
								startedOn: "2026-03-04T00:00:00.000Z",
								finishedOn: "2026-03-05T00:00:00.000Z",
							},
						},
					],
					[
						{ entitySchemaSlug: "movie", eventSchemaSlug: "progress" },
						{ when: { kind: "unknown" } },
					],
					[{ entitySchemaSlug: "book", eventSchemaSlug: "dropped" }, { when: { kind: "unknown" } }],
					[{ eventSchemaSlug: "progress", entitySchemaSlug: "show-episode" }, { timeSpent: 20 }],
					[{ entitySchemaSlug: "book", eventSchemaSlug: "dropped" }, { progressPercent: 40 }],
					[{ entitySchemaSlug: "show", eventSchemaSlug: "on_hold" }, { timeSpent: 20 }],
					[
						{ eventSchemaSlug: "progress", entitySchemaSlug: "podcast-episode" },
						{ progressPercent: null },
					],
					[
						{ entitySchemaSlug: "book", eventSchemaSlug: "backlog" },
						{ when: { kind: "date", finishedOn: "2026-03-05T12:00:00.000Z" } },
					],
				] satisfies readonly [Omit<StoredEvent, "id" | "properties">, MediaActivityPatch][]) {
					const { host } = recordingHost({ events: [{ ...event, id: "event-1", properties: {} }] });
					expect(eventChanges(yield* update(patch, host))).toHaveLength(1);
				}
			}),
		testTimeout,
	);

	it.live(
		"refuses a stored record carrying keys its schema no longer declares",
		() =>
			Effect.gen(function* () {
				const { host } = recordingHost({
					events: [{ ...movieCompletion, properties: { legacyRating: 3 } }],
				});
				expect(yield* rejection(update({ consumedOn: ["Plex"] }, host))).toEqual(
					catalogMessage("rejection.record.uneditable"),
				);
			}),
		testTimeout,
	);

	it.live(
		"refuses a record that no longer resolves",
		() =>
			Effect.gen(function* () {
				const { host } = recordingHost({ events: [] });
				yield* rejection(update({ consumedOn: ["Plex"] }, host));
			}),
		testTimeout,
	);
});

describe("media activity delete", () => {
	it.live(
		"reads every chunk of ids, then deletes them all in one change set",
		() =>
			Effect.gen(function* () {
				const ids = eventIds(250);
				const { host, documents } = recordingHost({ events: movieCompletions(ids) });
				const result = yield* remove({ eventIds: ids }, host);
				expect(result.output).toEqual({ count: 250 });
				expect(deletedIds(result)).toEqual<unknown>(ids);
				expect(eventChanges(result).map((change) => change.itemIdentity)).toEqual(
					ids.map((id) => `delete:${id}`),
				);
				expect(documents).toHaveLength(3);
			}),
		testTimeout,
	);

	it.live(
		"refuses the whole request when any chunk holds a disallowed record",
		() =>
			Effect.gen(function* () {
				const ids = eventIds(150);
				const { host } = recordingHost({
					disallowed: ["event-140"],
					events: movieCompletions(ids),
				});
				expect(yield* rejection(remove({ eventIds: ids }, host))).toEqual(
					catalogMessage("rejection.record.activity-only-delete"),
				);
			}),
		testTimeout,
	);

	it.live(
		"deletes only the records that resolve",
		() =>
			Effect.gen(function* () {
				const { host } = recordingHost({ events: [movieCompletion] });
				const result = yield* remove({ eventIds: ["event-1", "gone"] }, host);
				expect(result.output).toEqual({ count: 1 });
				expect(deletedIds(result)).toEqual<unknown>(["event-1"]);
				const nothing = yield* remove({ eventIds: ["gone"] }, host);
				expect(nothing).toEqual({ output: { count: 0 } });
			}),
		testTimeout,
	);

	it.live(
		"deletes only the requested episode completion, never its parent's",
		() =>
			Effect.gen(function* () {
				const { host } = recordingHost({
					events: [
						{
							properties: {},
							id: "episode-complete",
							eventSchemaSlug: "complete",
							entitySchemaSlug: "show-episode",
						},
						{
							properties: {},
							id: "parent-complete",
							entitySchemaSlug: "show",
							eventSchemaSlug: "complete",
						},
					],
				});
				expect(
					deletedIds(yield* remove({ eventIds: ["episode-complete"] }, host)),
				).toEqual<unknown>(["episode-complete"]);
			}),
		testTimeout,
	);

	it.live(
		"carries the precondition of a single-record delete and refuses it for a batch",
		() =>
			Effect.gen(function* () {
				const { host } = recordingHost({ events: [movieCompletion] });
				const withPrecondition = yield* runSandboxTestScript(
					deleteDefinition,
					{ expected, submittedAt, eventIds: ["event-1"], submissionId: "submission" },
					host,
					execution,
				);
				expect(eventChanges(withPrecondition)).toEqual<unknown>([
					{
						kind: "delete",
						eventId: "event-1",
						itemIdentity: "delete:event-1",
						expected: { ...expected, kind: "fields" },
					},
				]);
				const batch = yield* Effect.result(
					runSandboxTestScript(
						deleteDefinition,
						{ expected, submittedAt, submissionId: "submission", eventIds: ["event-1", "event-2"] },
						host,
						execution,
					),
				);
				expect(batch).toMatchObject({ _tag: "Failure", failure: { _tag: "SchemaError" } });
			}),
		testTimeout,
	);

	it.live(
		"leaves a record that vanished under a precondition to the commit's conflict check",
		() =>
			Effect.gen(function* () {
				const { host } = recordingHost({ events: [] });
				const result = yield* runSandboxTestScript(
					deleteDefinition,
					{ expected, submittedAt, eventIds: ["event-1"], submissionId: "submission" },
					host,
					execution,
				);
				expect(result).toMatchObject({
					output: { count: 0 },
					changes: {
						events: {
							changes: [
								{
									kind: "delete",
									eventId: "event-1",
									expected: { kind: "fields", entityId: expected.entityId },
								},
							],
						},
					},
				});
			}),
		testTimeout,
	);
});
