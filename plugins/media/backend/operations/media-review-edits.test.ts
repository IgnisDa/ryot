import { describe, expect } from "bun:test";

import type { RyotQLDocument } from "@ryot-app/contract/modules/ryotql/language";
import type { ChangeSet } from "@ryot-app/plugin-backend-sdk/core";
import { Effect, type Schema } from "@ryot-app/plugin-backend-sdk/effect";
import { OperationRejectedError } from "@ryot-app/plugin-backend-sdk/operation";
import { defineSandboxTestHost, runSandboxTestScript } from "@ryot-app/plugin-backend-sdk/testing";
import { bindTestRequest } from "@ryot-app/ryotql-recipes/test-utils";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { it } from "@voila.dev/effect-bun-test";

import { catalogMessage } from "../../shared/messages.generated";
import { execution } from "../../tests/backend/automations/automation-test-utils";
import { ryotqlDocumentNodes } from "../../tests/ryotql-test-utils";
import deleteDefinition from "./media-review-delete.sandbox";
import updateDefinition, { manifest } from "./media-review-update.sandbox";

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
	readonly visible?: boolean;
	readonly properties?: Record<string, Schema.Json>;
	readonly consumption?: { readonly entityId: string; readonly eventSchemaSlug: string };
}) => {
	const documents: RyotQLDocument[] = [];
	const row = {
		id: "review-1",
		eventSchemaSlug: "review",
		entitySchemaSlug: "anime",
		properties: input.properties ?? expected.properties,
	};
	const host = defineSandboxTestHost(manifest, {
		executeRyotql: (document) =>
			Effect.sync(() => {
				documents.push(bindTestRequest(document));
				return {
					data: {
						allowed: page(input.allowed ? [row] : []),
						visible: page(input.visible === false ? [] : [{ id: row.id }]),
						consumption: page(input.consumption ? [input.consumption] : []),
					},
				};
			}),
	});
	return { host, documents };
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

const updatedProperties = (result: { readonly changes?: ChangeSet }) => {
	const change = result.changes?.events?.changes[0];
	return change?.kind === "update" ? change.item.patch.properties : undefined;
};

const failureOf = <A, E>(effect: Effect.Effect<A, E>) =>
	Effect.gen(function* () {
		const result = yield* Effect.result(effect);
		expect(result).toMatchObject({ _tag: "Failure", failure: { _tag: "OperationRejectedError" } });
		return result._tag === "Failure" && result.failure instanceof OperationRejectedError
			? result.failure.reason
			: undefined;
	});

describe("media review edits", () => {
	it.live(
		"links, keeps and clears the occurrence a review is about",
		() =>
			Effect.gen(function* () {
				const { host, documents } = recordingHost({
					allowed: true,
					consumption: { entityId: "anime-1", eventSchemaSlug: "complete" },
				});
				const results = [
					yield* update({ rating: 85, consumptionEventId: "complete-1" }, host),
					yield* update({ rating: 85 }, host),
					yield* update({ rating: 85, consumptionEventId: null }, host),
				];
				expect(results.map(updatedProperties)).toEqual([
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
				for (const [consumption, reason] of [
					[undefined, catalogMessage("rejection.review.consumption-not-found")],
					[
						{ entityId: "anime-1", eventSchemaSlug: "backlog" },
						catalogMessage("rejection.review.consumption-not-reviewable"),
					],
					[
						{ entityId: "anime-2", eventSchemaSlug: "progress" },
						catalogMessage("rejection.review.consumption-other-entity"),
					],
				] as const) {
					const { host } = recordingHost({ consumption, allowed: true });
					expect(
						yield* failureOf(update({ rating: 85, consumptionEventId: "event-1" }, host)),
					).toEqual(reason);
				}
			}),
		testTimeout,
	);

	it.live(
		"rewrites text, rating, and spoiler state under the precondition",
		() =>
			Effect.gen(function* () {
				const { host } = recordingHost({ allowed: true });
				expect(yield* update({ rating: 85 }, host)).toEqual<unknown>({
					output: { count: 1 },
					changes: {
						events: {
							creates: [],
							changes: [
								{
									kind: "update",
									itemIdentity: "update:review-1",
									item: {
										eventId: "review-1",
										expected: { ...expected, kind: "fields" },
										patch: {
											properties: {
												remove: [],
												set: { rating: 85, isSpoiler: true, text: "Better on rewatch" },
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
		"clears the rating",
		() =>
			Effect.gen(function* () {
				const { host } = recordingHost({ allowed: true });
				expect(updatedProperties(yield* update({ rating: null }, host))).toEqual({
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
				const { host } = recordingHost({ allowed: true });
				expect(updatedProperties(yield* update({ rating: 0, text: null }, host))).toEqual({
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
				const { host } = recordingHost({ allowed: true, properties: { rating: 60 } });
				expect(updatedProperties(yield* update({ text: "  ", rating: 85 }, host))).toEqual({
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
				const { host } = recordingHost({ allowed: true });
				const result = yield* Effect.result(update({ text: "   ", rating: null }, host));
				expect(result).toMatchObject({ _tag: "Failure", failure: { _tag: "SchemaError" } });
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
				expect(yield* failureOf(update({ rating: 85 }, edit.host))).toEqual(
					catalogMessage("rejection.record.review-only-edit"),
				);
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
				).toEqual(catalogMessage("rejection.record.review-only-delete"));
			}),
		testTimeout,
	);

	it.live(
		"refuses a stored review carrying undeclared keys",
		() =>
			Effect.gen(function* () {
				const { host } = recordingHost({
					allowed: true,
					properties: { text: "Fine", mood: "happy" },
				});
				expect(yield* failureOf(update({ rating: 85 }, host))).toEqual(
					catalogMessage("rejection.record.uneditable"),
				);
			}),
		testTimeout,
	);

	it.live(
		"returns the delete of one visible review and nothing for an unseen one",
		() =>
			Effect.gen(function* () {
				const remove = (host: ReturnType<typeof recordingHost>["host"]) =>
					runSandboxTestScript(
						deleteDefinition,
						{ submittedAt, eventId: "review-1", submissionId: "submission" },
						host,
						execution,
					);
				expect(yield* remove(recordingHost({ allowed: true }).host)).toEqual<unknown>({
					output: { count: 1 },
					changes: {
						events: {
							creates: [],
							changes: [{ kind: "delete", eventId: "review-1", itemIdentity: "delete:review-1" }],
						},
					},
				});
				expect(yield* remove(recordingHost({ allowed: false, visible: false }).host)).toEqual({
					output: { count: 0 },
				});
			}),
		testTimeout,
	);
});
