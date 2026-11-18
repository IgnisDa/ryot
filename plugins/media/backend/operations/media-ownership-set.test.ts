import { describe, expect } from "bun:test";

import { RyotQLDocument } from "@ryot-app/contract/modules/ryotql/language";
import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";
import { defineSandboxTestHost, runSandboxTestScript } from "@ryot-app/plugin-backend-sdk/testing";
import { bindTestRequest } from "@ryot-app/ryotql-recipes/test-utils";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { it } from "@voila.dev/effect-bun-test";

import { MediaOwnershipSetInput } from "../../shared/media-ownership-operations";
import { execution } from "../../tests/backend/automations/automation-test-utils";
import { ryotqlDocumentNodes } from "../../tests/ryotql-test-utils";
import definition, { manifest } from "./media-ownership-set.sandbox";

const pageInfo = { limit: 50, hasMore: false, nextCursor: null };

const ownershipHost = (targetIds: readonly string[], documents: unknown[]) =>
	defineSandboxTestHost(manifest, {
		executeRyotql: (document) =>
			Effect.gen(function* () {
				documents.push(bindTestRequest(document));
				const query = yield* Schema.decodeEffect(RyotQLDocument)(bindTestRequest(document)).pipe(
					Effect.orDie,
				);
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
		it.live(
			`merges ${JSON.stringify(input)} into library membership and aligns misses`,
			() =>
				Effect.gen(function* () {
					const documents: unknown[] = [];

					expect(
						yield* runSandboxTestScript(
							definition,
							{ ...input, entityIds: ["entity-a", "missing", "entity-a"] },
							ownershipHost(["entity-a"], documents),
							execution,
						),
					).toEqual<unknown>({
						output: {
							results: [
								{ ...properties, status: "found", entityId: "entity-a" },
								{ status: "notFound", entityId: "missing" },
								{ ...properties, status: "found", entityId: "entity-a" },
							],
						},
						changes: {
							relationships: {
								upserts: [
									{
										properties,
										propertiesMode: "merge",
										relationshipSchemaSlug: "in-media-library",
										source: { kind: "existing", entityId: "entity-a" },
										target: { kind: "existing", entityId: "library-1" },
									},
								],
							},
						},
					});
					expect(documents).toHaveLength(2);
				}),
			testTimeout,
		);
	}

	it.live(
		"limits targets to media schemas and returns no changes when none are visible",
		() =>
			Effect.gen(function* () {
				const documents: unknown[] = [];

				expect(
					yield* runSandboxTestScript(
						definition,
						{ owned: false, entityIds: ["person-1"] },
						ownershipHost([], documents),
						execution,
					),
				).toEqual({ output: { results: [{ status: "notFound", entityId: "person-1" }] } });
				const targetDocument = documents.find(
					(document) => !ryotqlDocumentNodes(document).includes("media-library"),
				);
				const nodes = ryotqlDocumentNodes(targetDocument);
				expect(nodes).toContain("movie");
				expect(nodes).not.toContain("person");
				expect(nodes).not.toContain("show-episode");
			}),
		testTimeout,
	);

	it.effect(
		"bounds operation batches and requires ISO ownership dates",
		() =>
			Effect.gen(function* () {
				const decode = Schema.decodeUnknownEffect(MediaOwnershipSetInput);
				yield* Effect.flip(decode({ owned: false, entityIds: [] }));
				yield* Effect.flip(
					decode({
						owned: false,
						entityIds: Array.from({ length: 51 }, (_, index) => `entity-${index}`),
					}),
				);
				yield* Effect.flip(decode({ owned: true, ownedOn: "03/04/2024", entityIds: ["entity-a"] }));
			}),
		testTimeout,
	);
});
