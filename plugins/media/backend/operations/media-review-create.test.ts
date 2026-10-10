import { describe, expect, it } from "@effect/vitest";
import { EventId } from "@ryot-app/contract/schema/brands";
import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import { defineSandboxTestHost, runSandboxTestScript } from "@ryot-app/plugin-backend-sdk/testing";

import { execution } from "../../tests/backend/automations/automation-test-utils";
import { ryotqlDocumentNodes } from "../../tests/ryotql-test-utils";
import definition, { manifest } from "./media-review-create.sandbox";

const targetRows = (items: readonly { readonly id: string }[]) => ({
	data: {
		target: { items, type: "rows", pageInfo: { limit: 1, hasMore: false, nextCursor: null } },
	},
});

describe("create media review", () => {
	it.live("writes trimmed text, rating and spoiler state to one review event", () =>
		Effect.gen(function* () {
			const creates: unknown[] = [];
			const documents: unknown[] = [];
			const host = defineSandboxTestHost(manifest, {
				executeRyotql: (document) =>
					Effect.sync(() => {
						documents.push(document);
						return targetRows([{ id: "media-1" }]);
					}),
				createEvents: (items) =>
					Effect.sync(() => {
						creates.push(items);
						return {
							count: 1,
							outcomes: [
								{ index: 0, status: "written" as const, eventId: EventId.make("review-1") },
							],
						};
					}),
			});
			expect(
				yield* runSandboxTestScript(
					definition,
					{ rating: 82.5, isSpoiler: true, entityId: "media-1", text: "  Great ending  " },
					host,
					execution,
				),
			).toEqual({ count: 1 });
			expect(creates).toEqual([
				[
					{
						entityId: "media-1",
						eventSchemaSlug: "review",
						properties: { rating: 82.5, isSpoiler: true, text: "Great ending" },
					},
				],
			]);
			const nodes = ryotqlDocumentNodes(documents);
			expect(nodes).toContainEqual({ type: "pluginId", reference: { kind: "self" } });
			expect(nodes).toContainEqual({ type: "literal", value: "media-1" });
			expect(nodes).toContainEqual({ type: "literal", value: "person" });
			expect(nodes).toContainEqual({ type: "literal", value: "movie-group" });
			expect(nodes).not.toContainEqual({ value: "genre", type: "literal" });
			expect(nodes).not.toContainEqual({ type: "literal", value: "media-library" });
		}),
	);

	it.live("omits the rating when none was supplied", () =>
		Effect.gen(function* () {
			const creates: unknown[] = [];
			const host = defineSandboxTestHost(manifest, {
				executeRyotql: () => Effect.succeed(targetRows([{ id: "creator-1" }])),
				createEvents: (items) =>
					Effect.sync(() => {
						creates.push(items);
						return {
							count: 1,
							outcomes: [
								{ index: 0, status: "written" as const, eventId: EventId.make("review-1") },
							],
						};
					}),
			});
			yield* runSandboxTestScript(
				definition,
				{ isSpoiler: false, text: "Good work", entityId: "creator-1" },
				host,
				execution,
			);
			expect(creates).toEqual([
				[
					{
						entityId: "creator-1",
						eventSchemaSlug: "review",
						properties: { isSpoiler: false, text: "Good work" },
					},
				],
			]);
		}),
	);

	it.live("does not write when no visible plugin-owned review target exists", () =>
		Effect.gen(function* () {
			const writes: unknown[] = [];
			const host = defineSandboxTestHost(manifest, {
				executeRyotql: () => Effect.succeed(targetRows([])),
				createEvents: (items) =>
					Effect.sync(() => {
						writes.push(items);
						return { count: 0, outcomes: [] };
					}),
			});
			const result = yield* Effect.result(
				runSandboxTestScript(
					definition,
					{ text: "Review", isSpoiler: false, entityId: "missing" },
					host,
					execution,
				),
			);
			expect(result._tag).toBe("Failure");
			expect(writes).toEqual([]);
		}),
	);
});
