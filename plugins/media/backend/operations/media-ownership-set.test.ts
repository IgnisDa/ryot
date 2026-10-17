import { describe, expect, it } from "@effect/vitest";
import { RyotQLDocument } from "@ryot-app/contract/modules/ryotql/language";
import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";
import { defineSandboxTestHost, runSandboxTestScript } from "@ryot-app/plugin-backend-sdk/testing";

import { MediaOwnershipSetInput } from "../../shared/media-ownership-operations";
import { execution } from "../../tests/backend/automations/automation-test-utils";
import { ryotqlDocumentNodes } from "../../tests/ryotql-test-utils";
import definition, { manifest } from "./media-ownership-set.sandbox";

const pageInfo = { limit: 50, hasMore: false, nextCursor: null };

const ownershipHost = (targetIds: readonly string[], changes: unknown[], documents: unknown[]) =>
	defineSandboxTestHost(manifest, {
		changeUserRelationships: (batches) =>
			Effect.sync(() => {
				changes.push(batches);
				return [{ deleted: 0, created: targetIds.length }];
			}),
		executeRyotql: (document) =>
			Effect.gen(function* () {
				documents.push(document);
				const query = yield* Schema.decodeEffect(RyotQLDocument)(document).pipe(Effect.orDie);
				return "mediaLibrary" in query.queries
					? {
							data: {
								mediaLibrary: { pageInfo, type: "rows", items: [{ entityId: "library-1" }] },
							},
						}
					: {
							data: {
								targets: {
									pageInfo,
									type: "rows",
									items: targetIds.map((entityId) => ({ entityId })),
								},
							},
						};
			}),
	});

describe("media ownership operation", () => {
	for (const [input, properties] of [
		[
			{ owned: true, ownedOn: "2024-03-04" },
			{ owned: true, ownedOn: "2024-03-04" },
		],
		[
			{ owned: true, ownedOn: null },
			{ owned: true, ownedOn: null },
		],
		[{ owned: false }, { owned: false, ownedOn: null }],
	] as const) {
		it.live(`merges ${JSON.stringify(input)} into library membership and aligns misses`, () =>
			Effect.gen(function* () {
				const changes: unknown[] = [];
				const documents: unknown[] = [];

				expect(
					yield* runSandboxTestScript(
						definition,
						{ ...input, entityIds: ["entity-a", "missing", "entity-a"] },
						ownershipHost(["entity-a"], changes, documents),
						execution,
					),
				).toEqual({
					results: [
						{ ...properties, status: "found", entityId: "entity-a" },
						{ status: "notFound", entityId: "missing" },
						{ ...properties, status: "found", entityId: "entity-a" },
					],
				});
				expect(changes).toEqual([
					[
						{
							deletes: [],
							creates: [
								{
									properties,
									propertiesMode: "merge",
									sourceEntityId: "entity-a",
									targetEntityId: "library-1",
									relationshipSchemaSlug: "in-media-library",
								},
							],
						},
					],
				]);
				expect(documents).toHaveLength(2);
			}),
		);
	}

	it.live("limits targets to media schemas and skips writes when none are visible", () =>
		Effect.gen(function* () {
			const changes: unknown[] = [];
			const documents: unknown[] = [];

			expect(
				yield* runSandboxTestScript(
					definition,
					{ owned: false, entityIds: ["person-1"] },
					ownershipHost([], changes, documents),
					execution,
				),
			).toEqual({ results: [{ status: "notFound", entityId: "person-1" }] });
			expect(changes).toEqual([]);
			const targetDocument = documents.find(
				(document) => !ryotqlDocumentNodes(document).includes("media-library"),
			);
			const nodes = ryotqlDocumentNodes(targetDocument);
			expect(nodes).toContain("movie");
			expect(nodes).not.toContain("person");
			expect(nodes).not.toContain("show-episode");
		}),
	);

	it("bounds operation batches and requires ISO ownership dates", () => {
		const decode = Schema.decodeUnknownSync(MediaOwnershipSetInput);
		expect(() => decode({ owned: false, entityIds: [] })).toThrow();
		expect(() =>
			decode({
				owned: false,
				entityIds: Array.from({ length: 51 }, (_, index) => `entity-${index}`),
			}),
		).toThrow();
		expect(() => decode({ owned: true, ownedOn: "03/04/2024", entityIds: ["entity-a"] })).toThrow();
	});
});
