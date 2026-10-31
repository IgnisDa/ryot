import { describe, expect, it } from "@effect/vitest";
import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import { defineSandboxTestHost, runSandboxTestScript } from "@ryot-app/plugin-backend-sdk/testing";

import { mediaActivityEntitySchemaSlugs } from "../../shared/media-activity-fields";
import { execution } from "../../tests/backend/automations/automation-test-utils";
import { ryotqlDocumentNodes } from "../../tests/ryotql-test-utils";
import definition, { manifest } from "./media-history-correction-retry.sandbox";

const targetRows = (items: readonly { readonly id: string }[]) => ({
	data: {
		target: { items, type: "rows", pageInfo: { limit: 1, hasMore: false, nextCursor: null } },
	},
});

describe("retry media history correction", () => {
	it.live("requests scoped correction work for the selected media root", () =>
		Effect.gen(function* () {
			const documents: unknown[] = [];
			const requests: unknown[] = [];
			const host = defineSandboxTestHost(manifest, {
				executeRyotql: (document) =>
					Effect.sync(() => {
						documents.push(document);
						return targetRows([{ id: "movie-1" }]);
					}),
				requestUserWork: (request, reference) =>
					Effect.sync(() => {
						requests.push({ request, reference });
						return { workId: "work-1" };
					}),
			});

			expect(
				yield* runSandboxTestScript(
					definition,
					{ entityId: "movie-1", submissionId: "submission-1" },
					host,
					execution,
				),
			).toEqual({ workId: "work-1" });
			expect(requests).toHaveLength(1);
			expect(requests[0]).toMatchObject({
				reference: { referenceKind: "script", scriptSlug: "media-history-correction" },
				request: {
					scope: "movie-1",
					key: "movie-1:retry:submission-1",
					input: {
						force: true,
						liveSourceIds: [],
						entityId: "movie-1",
						requestKey: "submission-1",
						workKey: "movie-1:retry:submission-1",
					},
				},
			});

			const nodes = ryotqlDocumentNodes(documents);
			expect(nodes).toContainEqual({ type: "pluginId", reference: { kind: "self" } });
			for (const slug of mediaActivityEntitySchemaSlugs) {
				if (slug === "show-episode" || slug === "podcast-episode") {
					expect(nodes).not.toContainEqual({ value: slug, type: "literal" });
				} else {
					expect(nodes).toContainEqual({ value: slug, type: "literal" });
				}
			}
		}),
	);

	it.live.each([
		{ entityId: "foreign-1", name: "a foreign entity" },
		{ entityId: "episode-1", name: "an unavailable episode" },
	])("rejects $name without requesting work", ({ entityId }) =>
		Effect.gen(function* () {
			const requests: unknown[] = [];
			const host = defineSandboxTestHost(manifest, {
				executeRyotql: () => Effect.succeed(targetRows([])),
				requestUserWork: (request) =>
					Effect.sync(() => {
						requests.push(request);
						return { workId: "work-1" };
					}),
			});
			const result = yield* Effect.result(
				runSandboxTestScript(
					definition,
					{ entityId, submissionId: "submission-1" },
					host,
					execution,
				),
			);

			expect(result).toMatchObject({
				_tag: "Failure",
				failure: { _tag: "OperationRejectedError" },
			});
			expect(requests).toEqual([]);
		}),
	);
});
