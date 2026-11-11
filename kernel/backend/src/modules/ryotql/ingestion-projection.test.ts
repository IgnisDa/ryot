import { expect } from "bun:test";

import { importIssuesRecipe, manualImportRunsRecipe } from "@ryot-app/ryotql-recipes/import-runs";
import { assert } from "@ryot-app/testing/assert";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { layer } from "@voila.dev/effect-bun-test";
import { Effect, Layer, Result } from "effect";

import { DatabaseSession } from "#platform/db/session";
import { user } from "#schema/tables/auth";
import { importActivity, importIssue, importItem, importRun } from "#schema/tables/imports";
import { makeAppConfigLayer, makeConfigProviderLayer } from "#testing/effect";
import { isolatedDatabaseLayer } from "#testing/isolated-database";

import { RyotQLService } from "./service";

const testLayer = RyotQLService.layer.pipe(
	Layer.provideMerge(isolatedDatabaseLayer("ingestion_projection")),
	Layer.provide(makeConfigProviderLayer()),
);

layer(testLayer.pipe(Layer.provide(makeAppConfigLayer())))((test) => {
	test.effect(
		"aggregates committed batches by kind and unit and isolates attributed issue pages",
		() =>
			Effect.gen(function* () {
				const session = yield* DatabaseSession;
				yield* session.run((db) =>
					Effect.gen(function* () {
						yield* db
							.insert(user)
							.values({ id: "owner", name: "Owner", email: "owner@example.test" });
						yield* db
							.insert(user)
							.values({ id: "other", name: "Other", email: "other@example.test" });
						yield* db
							.insert(importRun)
							.values({ id: "run", userId: "owner", status: "running", source: "data-json" });
						yield* db
							.insert(importItem)
							.values({
								runId: "run",
								id: "capture",
								kind: "payload",
								published: true,
								data: {
									ordinal: 0,
									state: "sealed",
									checkpoint: null,
									phase: "collection",
									stagingExecutionId: null,
									inputFingerprint: "capture",
									payload: { byteSize: 0, locator: "capture", checksum: "capture" },
								},
							});
						for (const ordinal of [0, 1]) {
							const id = `batch-${ordinal}`;
							yield* db
								.insert(importItem)
								.values({
									id,
									runId: "run",
									kind: "batch",
									operationIds: [],
									data: {
										id,
										ordinal,
										state: "applied",
										captureId: "capture",
										inputFingerprint: id,
										summary: [
											{
												recordKind: "play",
												unit: "listening events",
												counts: {
													created: 6,
													updated: 1,
													skipped: 3,
													unchanged: 2,
													unsuccessful: 4,
												},
											},
										],
									},
								});
						}
						yield* db
							.insert(importActivity)
							.values({
								runId: "run",
								data: {
									id: "read",
									wait: null,
									completed: 1,
									unit: "files",
									batchId: null,
									parentId: null,
									kind: "reading",
									exactTotal: null,
									state: "running",
									lastAdvancedAt: "2026-10-01T00:00:00.000Z",
								},
							});
						for (const id of ["issue-a", "issue-b"]) {
							yield* db
								.insert(importIssue)
								.values({
									runId: "run",
									data: {
										id,
										operationId: id,
										severity: "error",
										recordKind: "play",
										reason: { key: "example-service", code: "provider-unavailable" },
										attribution: {
											recordId: id,
											sourceLabel: "Song",
											sourceIdentifier: "source-play",
										},
									},
								});
						}
					}),
				);
				const service = yield* RyotQLService;
				const recipe = manualImportRunsRecipe;
				const recipeRequest = {
					arguments: {},
					source: { kind: "inline", document: recipe.document } as const,
					pages: Object.fromEntries(
						Object.entries(recipe.document.queries).flatMap(([key, query]) =>
							query.output.type === "rows" || query.output.groupBy?.length
								? [[key, { limit: 10 }]]
								: [],
						),
					),
				};
				const runs = Result.getOrThrow(
					recipe.decode(yield* service.executeForUser("owner", null, "kernel", recipeRequest)),
				);
				const run = runs.items[0];
				assert(run);
				expect(run.summary).toEqual([
					{
						recordKind: "play",
						unit: "listening events",
						counts: { updated: 2, skipped: 6, created: 12, unchanged: 4, unsuccessful: 8 },
					},
				]);
				expect(run.activities[0]?.unit).toBe("files");
				expect(run.activities[0]?.exactTotal).toBeNull();
				const issuesRecipe = importIssuesRecipe;
				const issuesRecipeRequest = {
					arguments: { runId: "run" },
					source: { kind: "inline", document: issuesRecipe.document } as const,
					pages: Object.fromEntries(
						Object.entries(issuesRecipe.document.queries).flatMap(([key, query]) =>
							query.output.type === "rows" || query.output.groupBy?.length
								? [[key, { limit: 1 }]]
								: [],
						),
					),
				};
				const issues = Result.getOrThrow(
					issuesRecipe.decode(
						yield* service.executeForUser("owner", null, "kernel", issuesRecipeRequest),
					),
				);
				expect(issues.items[0]?.data.attribution).toEqual({
					recordId: "issue-a",
					sourceLabel: "Song",
					sourceIdentifier: "source-play",
				});
				assert(issues.pageInfo.nextCursor);
				const nextRecipe = importIssuesRecipe;
				const nextRecipeRequest = {
					arguments: { runId: "run" },
					source: { kind: "inline", document: nextRecipe.document } as const,
					pages: Object.fromEntries(
						Object.entries(nextRecipe.document.queries).flatMap(([key, query]) =>
							query.output.type === "rows" || query.output.groupBy?.length
								? [[key, { limit: 1, after: issues.pageInfo.nextCursor ?? undefined }]]
								: [],
						),
					),
				};
				const next = Result.getOrThrow(
					nextRecipe.decode(
						yield* service.executeForUser("owner", null, "kernel", nextRecipeRequest),
					),
				);
				expect(next.items.map(({ id }) => id)).toEqual(["issue-b"]);
				expect(
					Result.getOrThrow(
						issuesRecipe.decode(
							yield* service.executeForUser("other", null, "kernel", issuesRecipeRequest),
						),
					).items,
				).toEqual([]);
				expect(
					Result.getOrThrow(
						recipe.decode(yield* service.executeForUser("other", null, "kernel", recipeRequest)),
					).items,
				).toEqual([]);
			}),
		testTimeout,
	);
});
