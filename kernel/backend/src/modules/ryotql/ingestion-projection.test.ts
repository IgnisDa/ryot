import { expect, layer } from "@effect/vitest";
import { importIssuesRecipe, manualImportRunsRecipe } from "@ryot-app/ryotql-recipes/import-runs";
import { Effect, Layer, Result } from "effect";
import { assert } from "vitest";

import { user } from "#lib/infrastructure/db/schema/tables/auth";
import {
	importActivity,
	importBatch,
	importCapture,
	importIssue,
	importRun,
} from "#lib/infrastructure/db/schema/tables/imports";
import { DatabaseSession } from "#lib/infrastructure/db/session";
import { makeConfigProviderLayer } from "#lib/test-utils/effect";
import { isolatedDatabaseLayer } from "#lib/test-utils/isolated-database";

import { RyotQLService } from "./service";

const testLayer = RyotQLService.layer.pipe(
	Layer.provideMerge(isolatedDatabaseLayer("ingestion_projection")),
	Layer.provide(makeConfigProviderLayer()),
);

layer(testLayer)((test) => {
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
							.values({
								id: "run",
								userId: "owner",
								status: "running",
								source: "data-json",
								accountGeneration: "test-account-generation",
							});
						yield* db
							.insert(importCapture)
							.values({
								ordinal: 0,
								runId: "run",
								id: "capture",
								phase: "collection",
								data: {
									ordinal: 0,
									id: "capture",
									payload: null,
									state: "sealed",
									checkpoint: null,
									phase: "collection",
								},
							});
						for (const ordinal of [0, 1]) {
							const id = `batch-${ordinal}`;
							yield* db
								.insert(importBatch)
								.values({
									id,
									ordinal,
									runId: "run",
									executionId: id,
									operationIds: [],
									captureId: "capture",
									workflowName: "test-batch",
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
								id: "read",
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
									id,
									runId: "run",
									data: {
										id,
										operationId: id,
										severity: "error",
										recordKind: "play",
										reason: { key: "spotify", code: "provider-unavailable" },
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
				const recipe = manualImportRunsRecipe({ limit: 10 });
				const runs = Result.getOrThrow(
					recipe.decode(yield* service.executeForUser("owner", null, "kernel", recipe.document)),
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
				const issuesRecipe = importIssuesRecipe({ limit: 1, runId: "run" });
				const issues = Result.getOrThrow(
					issuesRecipe.decode(
						yield* service.executeForUser("owner", null, "kernel", issuesRecipe.document),
					),
				);
				expect(issues.items[0]?.data.attribution).toEqual({
					recordId: "issue-a",
					sourceLabel: "Song",
					sourceIdentifier: "source-play",
				});
				assert(issues.pageInfo.nextCursor);
				const nextRecipe = importIssuesRecipe({
					limit: 1,
					runId: "run",
					after: issues.pageInfo.nextCursor,
				});
				const next = Result.getOrThrow(
					nextRecipe.decode(
						yield* service.executeForUser("owner", null, "kernel", nextRecipe.document),
					),
				);
				expect(next.items.map(({ id }) => id)).toEqual(["issue-b"]);
				expect(
					Result.getOrThrow(
						issuesRecipe.decode(
							yield* service.executeForUser("other", null, "kernel", issuesRecipe.document),
						),
					).items,
				).toEqual([]);
				expect(
					Result.getOrThrow(
						recipe.decode(yield* service.executeForUser("other", null, "kernel", recipe.document)),
					).items,
				).toEqual([]);
			}),
	);
});
