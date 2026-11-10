import { describe, expect } from "bun:test";

import type {
	DomainSandboxHostMethodMap,
	UpdateEventItem,
} from "@ryot-app/plugin-backend-sdk/core";
import { Effect, type Schema } from "@ryot-app/plugin-backend-sdk/effect";
import type { RyotQLDocument } from "@ryot-app/plugin-backend-sdk/ryotql";
import { defineSandboxTestHost, runSandboxTestScript } from "@ryot-app/plugin-backend-sdk/testing";
import type { SandboxHostError } from "@ryot-app/plugin-backend-sdk/wire";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { it } from "@voila.dev/effect-bun-test";

import { execution } from "../../tests/backend/automations/automation-test-utils";
import { ryotqlDocumentNodes } from "../../tests/ryotql-test-utils";
import { STALE_RECORD_MESSAGE } from "./media-activity-edits";
import deleteDefinition from "./media-review-delete.sandbox";
import updateDefinition, { manifest } from "./media-review-update.sandbox";

type DeleteOptions = NonNullable<Parameters<DomainSandboxHostMethodMap["deleteEvents"]>[1]>;

const submittedAt = "2026-03-10T09:00:00.000Z";

const expected = {
	entityId: "anime-1",
	absentProperties: [],
	sessionEntityId: null,
	occurredAt: "2026-03-01T12:00:00.000Z",
	properties: { rating: 60, text: "Fine", isSpoiler: false },
};

const page = (items: readonly unknown[]) => ({
	items,
	type: "rows",
	pageInfo: { limit: 100, hasMore: false, nextCursor: null },
});

const recordingHost = (input: {
	readonly allowed: boolean;
	readonly properties?: Record<string, Schema.Json>;
	readonly consumption?: { readonly entityId: string; readonly eventSchemaSlug: string };
	readonly updateEvents?: () => Effect.Effect<{ readonly count: number }, SandboxHostError>;
}) => {
	const documents: RyotQLDocument[] = [];
	const updates: { readonly items: readonly UpdateEventItem[] }[] = [];
	const deletes: {
		readonly ids: readonly string[];
		readonly options: undefined | DeleteOptions;
	}[] = [];
	const row = {
		id: "review-1",
		eventSchemaSlug: "review",
		entitySchemaSlug: "anime",
		properties: input.properties ?? expected.properties,
	};
	const host = defineSandboxTestHost(manifest, {
		deleteEvents: (ids, options) =>
			Effect.sync(() => {
				deletes.push({ ids, options });
				return { count: 1 };
			}),
		updateEvents: (items) =>
			Effect.suspend(() => {
				updates.push({ items });
				return input.updateEvents?.() ?? Effect.succeed({ count: 1 });
			}),
		executeRyotql: (document) =>
			Effect.sync(() => {
				documents.push(document);
				return {
					data: {
						visible: page([{ id: row.id }]),
						allowed: page(input.allowed ? [row] : []),
						consumption: page(input.consumption ? [input.consumption] : []),
					},
				};
			}),
	});
	return { host, updates, deletes, documents };
};

const update = (
	{
		expectedProperties,
		...input
	}: {
		readonly text?: null | string;
		readonly rating: null | number;
		readonly consumptionEventId?: null | string;
		readonly expectedProperties?: Record<string, Schema.Json>;
	},
	host: ReturnType<typeof recordingHost>["host"],
) =>
	runSandboxTestScript(
		updateDefinition,
		{
			submittedAt,
			isSpoiler: true,
			eventId: "review-1",
			submissionId: "submission",
			text: "  Better on rewatch  ",
			expected: { ...expected, properties: expectedProperties ?? expected.properties },
			...input,
		},
		host,
		execution,
	);

const failureOf = <A, E>(effect: Effect.Effect<A, E>) =>
	Effect.gen(function* () {
		const result = yield* Effect.result(effect);
		expect(result).toMatchObject({ _tag: "Failure", failure: { _tag: "OperationRejectedError" } });
		return result._tag === "Failure" && result.failure instanceof Error
			? result.failure.message
			: undefined;
	});

describe("media review edits", () => {
	it.live(
		"links, keeps and clears the occurrence a review is about",
		() =>
			Effect.gen(function* () {
				const { host, updates, documents } = recordingHost({
					allowed: true,
					consumption: { entityId: "anime-1", eventSchemaSlug: "complete" },
				});
				yield* update({ rating: 85, consumptionEventId: "complete-1" }, host);
				yield* update({ rating: 85 }, host);
				yield* update({ rating: 85, consumptionEventId: null }, host);
				expect(updates.map(({ items }) => items[0]?.patch.properties)).toEqual([
					{
						remove: [],
						set: {
							rating: 85,
							isSpoiler: true,
							text: "Better on rewatch",
							consumptionEventId: "complete-1",
						},
					},
					{ remove: [], set: { rating: 85, isSpoiler: true, text: "Better on rewatch" } },
					{
						remove: ["consumptionEventId"],
						set: { rating: 85, isSpoiler: true, text: "Better on rewatch" },
					},
				]);
				const nodes = ryotqlDocumentNodes(
					documents.flatMap((document) => document.queries["consumption"] ?? []),
				);
				expect(nodes).toContainEqual({ type: "literal", value: "complete-1" });
				expect(nodes).toContainEqual({ type: "pluginId", reference: { kind: "self" } });
			}),
		testTimeout,
	);

	it.live(
		"does not revalidate an unchanged occurrence link",
		() =>
			Effect.gen(function* () {
				const { host, documents } = recordingHost({ allowed: true });
				yield* update(
					{
						rating: 85,
						consumptionEventId: "gone-1",
						expectedProperties: { ...expected.properties, consumptionEventId: "gone-1" },
					},
					host,
				);
				expect(documents.some((document) => document.queries["consumption"] !== undefined)).toBe(
					false,
				);
			}),
		testTimeout,
	);

	it.live(
		"refuses occurrences that are missing, of another kind or of another entity",
		() =>
			Effect.gen(function* () {
				for (const [consumption, message] of [
					[undefined, "The record this review is about no longer exists."],
					[
						{ entityId: "anime-1", eventSchemaSlug: "backlog" },
						"A review can only be about a completion, progress or status record.",
					],
					[
						{ entityId: "anime-2", eventSchemaSlug: "progress" },
						"A review can only be about a record of what it reviews.",
					],
				] as const) {
					const { host, updates } = recordingHost({ consumption, allowed: true });
					expect(
						yield* failureOf(update({ rating: 85, consumptionEventId: "event-1" }, host)),
					).toBe(message);
					expect(updates).toEqual([]);
				}
			}),
		testTimeout,
	);

	it.live(
		"rewrites text, rating, and spoiler state under the precondition and write key",
		() =>
			Effect.gen(function* () {
				const { host, updates } = recordingHost({ allowed: true });
				expect(yield* update({ rating: 85 }, host)).toEqual({ count: 1 });
				expect(updates).toEqual<unknown>([
					{
						items: [
							{
								eventId: "review-1",
								expected: { ...expected, kind: "fields" },
								patch: {
									properties: {
										remove: [],
										set: { rating: 85, isSpoiler: true, text: "Better on rewatch" },
									},
								},
							},
						],
					},
				]);
			}),
		testTimeout,
	);

	it.live(
		"clears the rating",
		() =>
			Effect.gen(function* () {
				const { host, updates } = recordingHost({ allowed: true });
				yield* update({ rating: null }, host);
				expect(updates[0]?.items[0]?.patch.properties).toEqual({
					remove: ["rating"],
					set: { isSpoiler: true, text: "Better on rewatch" },
				});
			}),
		testTimeout,
	);

	it.live(
		"clears text and its spoiler flag while keeping a zero rating",
		() =>
			Effect.gen(function* () {
				const { host, updates } = recordingHost({ allowed: true });
				yield* update({ rating: 0, text: null }, host);
				expect(updates[0]?.items[0]?.patch.properties).toEqual({
					set: { rating: 0 },
					remove: ["text", "isSpoiler"],
				});
			}),
		testTimeout,
	);

	it.live(
		"edits an imported rating-only record without inventing text",
		() =>
			Effect.gen(function* () {
				const { host, updates } = recordingHost({ allowed: true, properties: { rating: 60 } });
				yield* update({ text: "  ", rating: 85 }, host);
				expect(updates[0]?.items[0]?.patch.properties).toEqual({
					set: { rating: 85 },
					remove: ["text", "isSpoiler"],
				});
			}),
		testTimeout,
	);

	it.live(
		"rejects clearing both rating and text before reaching the host",
		() =>
			Effect.gen(function* () {
				const { host, updates } = recordingHost({ allowed: true });
				const result = yield* Effect.result(update({ text: "   ", rating: null }, host));
				expect(result).toMatchObject({ _tag: "Failure", failure: { _tag: "SchemaError" } });
				expect(updates).toEqual([]);
			}),
		testTimeout,
	);

	it.live(
		"allows only plugin-owned reviews on media library members",
		() =>
			Effect.gen(function* () {
				const { host, documents } = recordingHost({ allowed: true });
				yield* update({ rating: 85 }, host);
				const nodes = ryotqlDocumentNodes(documents[0]?.queries["allowed"]);
				expect(nodes).toContainEqual({ type: "literal", value: "review" });
				for (const slug of ["person", "movie-group", "show-season", "podcast-episode"]) {
					expect(nodes).toContainEqual({ value: slug, type: "literal" });
				}
				for (const slug of ["complete", "progress", "list-state", "collection", "media-library"]) {
					expect(nodes).not.toContainEqual({ value: slug, type: "literal" });
				}
				expect(nodes).not.toContainEqual({ type: "pluginId", reference: { kind: "kernel" } });
			}),
		testTimeout,
	);

	it.live(
		"refuses lifecycle and kernel collection events through the review operations",
		() =>
			Effect.gen(function* () {
				const edit = recordingHost({ allowed: false });
				expect(yield* failureOf(update({ rating: 85 }, edit.host))).toBe(
					"Only reviews can be edited here.",
				);
				expect(edit.updates).toEqual([]);
				const removal = recordingHost({ allowed: false });
				expect(
					yield* failureOf(
						runSandboxTestScript(
							deleteDefinition,
							{ submittedAt, eventId: "review-1", submissionId: "submission" },
							removal.host,
							execution,
						),
					),
				).toBe("Only reviews can be deleted here.");
				expect(removal.deletes).toEqual([]);
			}),
		testTimeout,
	);

	it.live(
		"refuses a stored review carrying undeclared keys",
		() =>
			Effect.gen(function* () {
				const { host, updates } = recordingHost({
					allowed: true,
					properties: { text: "Fine", mood: "happy" },
				});
				expect(yield* failureOf(update({ rating: 85 }, host))).toBe("This record can't be edited.");
				expect(updates).toEqual([]);
			}),
		testTimeout,
	);

	it.live(
		"reports a review changed elsewhere as stale",
		() =>
			Effect.gen(function* () {
				const { host } = recordingHost({
					allowed: true,
					updateEvents: () =>
						Effect.fail({
							message: "event-stale",
							data: { code: "event-stale", eventId: "review-1" },
						}),
				});
				expect(yield* failureOf(update({ rating: 85 }, host))).toBe(STALE_RECORD_MESSAGE);
			}),
		testTimeout,
	);

	it.live(
		"deletes one review with its write key",
		() =>
			Effect.gen(function* () {
				const { host, deletes } = recordingHost({ allowed: true });
				expect(
					yield* runSandboxTestScript(
						deleteDefinition,
						{ submittedAt, eventId: "review-1", submissionId: "submission" },
						host,
						execution,
					),
				).toEqual({ count: 1 });
				expect(deletes).toEqual([{ ids: ["review-1"], options: undefined }]);
			}),
		testTimeout,
	);
});
