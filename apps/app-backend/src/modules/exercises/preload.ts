import { WorkflowEngine } from "@effect/workflow/WorkflowEngine";
import { dieOnDbError, unknownToMessage } from "@ryot/contract/errors";
import { generateId } from "better-auth";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { Effect, Layer } from "effect";

import * as schema from "#lib/infrastructure/db/schema/tables/combined";
import { CurrentDb, DbRunner, dbEffect } from "#lib/infrastructure/db/service";
import { EntitiesRepository } from "#modules/entities/repository";
import { ProviderEntityPopulationWorkflow } from "#modules/entity-import/provider-entity-population-workflow";
import { decodeProviderSearchResult } from "#modules/sandbox/provider-contracts";
import { SandboxRepository } from "#modules/sandbox/repository";
import { RunSandboxWorkflow } from "#modules/sandbox/sandbox-run-workflow";

const builtinExercisePageSize = 100;
const builtinExerciseExpectedCount = 873;
const builtinExerciseImportConcurrency = 5;
const builtinExerciseScriptSlug = "exercise.free-exercise-db";

const countImportedGlobalEntities = Effect.fn(function* (input: {
	entitySchemaSlug: string;
	sandboxScriptId: string;
}) {
	const db = yield* CurrentDb;
	const [row] = yield* dbEffect(() =>
		db
			.select({ count: sql<number>`count(*)::int` })
			.from(schema.entity)
			.where(
				and(
					isNull(schema.entity.userId),
					eq(schema.entity.entitySchemaSlug, input.entitySchemaSlug),
					eq(schema.entity.sandboxScriptId, input.sandboxScriptId),
				),
			)
			.limit(1),
	);
	return row?.count ?? 0;
});

const findImportedGlobalExternalIds = Effect.fn(function* (input: {
	externalIds: string[];
	entitySchemaSlug: string;
	sandboxScriptId: string;
}) {
	if (input.externalIds.length === 0) {
		return new Set<string>();
	}

	const db = yield* CurrentDb;
	const rows = yield* dbEffect(() =>
		db
			.select({ externalId: schema.entity.externalId })
			.from(schema.entity)
			.where(
				and(
					isNull(schema.entity.userId),
					eq(schema.entity.entitySchemaSlug, input.entitySchemaSlug),
					eq(schema.entity.sandboxScriptId, input.sandboxScriptId),
					inArray(schema.entity.externalId, input.externalIds),
				),
			),
	);

	return new Set(rows.flatMap((row) => (row.externalId ? [row.externalId] : [])));
});

export const BuiltinEntityPreloaderLive = (configuredPreloadLimit: number) =>
	Layer.scopedDiscard(
		Effect.gen(function* () {
			const runWithDb = yield* DbRunner;
			const engine = yield* WorkflowEngine;
			const repository = yield* EntitiesRepository;
			const sandboxRepository = yield* SandboxRepository;

			const preloadTarget = yield* runWithDb(
				repository.findEntitySchemaSandboxScriptBySlug(builtinExerciseScriptSlug),
			);
			if (!preloadTarget) {
				yield* Effect.logWarning("builtin exercise preload target missing").pipe(
					Effect.annotateLogs({ scriptSlug: builtinExerciseScriptSlug }),
				);
				return;
			}

			const importedCount = yield* runWithDb(countImportedGlobalEntities(preloadTarget)).pipe(
				dieOnDbError,
			);
			const preloadLimit = Math.min(
				builtinExerciseExpectedCount,
				Math.max(0, configuredPreloadLimit),
			);
			if (importedCount >= preloadLimit) {
				return;
			}

			const script = yield* runWithDb(
				sandboxRepository.getScriptForUser({
					userId: null,
					scriptId: preloadTarget.sandboxScriptId,
				}),
			);
			if (!script) {
				yield* Effect.logWarning("builtin exercise preload script missing").pipe(
					Effect.annotateLogs({ scriptSlug: builtinExerciseScriptSlug }),
				);
				return;
			}

			const preloadRunId = generateId();

			const searchPage = (page: number) => {
				const executionId = `${preloadRunId}-search-${page}`;
				return engine
					.execute(RunSandboxWorkflow, {
						executionId,
						payload: {
							executionId,
							userId: null,
							scriptId: script.id,
							driverName: "search",
							context: { query: "", page, pageSize: builtinExercisePageSize },
						},
					})
					.pipe(
						Effect.raceFirst(
							engine
								.poll(RunSandboxWorkflow, executionId)
								.pipe(Effect.delay("250 millis"), Effect.forever),
						),
						Effect.flatMap((result) =>
							result.error
								? Effect.logError("builtin exercise search failed").pipe(
										Effect.annotateLogs({ page, error: result.error.message }),
										Effect.as<string[]>([]),
									)
								: decodeProviderSearchResult(result.value).pipe(
										Effect.map(({ items }) => [...new Set(items.map((item) => item.externalId))]),
										Effect.orElseSucceed(() => []),
									),
						),
					);
			};

			const importExercise = (externalId: string) => {
				const executionId = `${preloadRunId}-exercise-${externalId}`;
				return engine
					.execute(ProviderEntityPopulationWorkflow, {
						executionId,
						payload: {
							externalId,
							executionId,
							userId: null,
							mode: "ensure",
							origin: { kind: "bootstrap" },
							scriptId: preloadTarget.sandboxScriptId,
							entitySchemaSlug: preloadTarget.entitySchemaSlug,
						},
					})
					.pipe(
						Effect.raceFirst(
							engine
								.poll(ProviderEntityPopulationWorkflow, executionId)
								.pipe(Effect.delay("250 millis"), Effect.forever),
						),
						Effect.as(true),
						Effect.catchAll((error) =>
							Effect.logError("builtin exercise import failed").pipe(
								Effect.annotateLogs({ externalId, error: unknownToMessage(error) }),
								Effect.as(false),
							),
						),
					);
			};

			const runPreload = Effect.gen(function* () {
				yield* Effect.logInfo("builtin exercise preload started").pipe(
					Effect.annotateLogs({ importedCount, preloadLimit }),
				);

				let page = 1;
				let remaining = preloadLimit - importedCount;

				for (;;) {
					const externalIds = yield* searchPage(page);

					if (externalIds.length === 0) {
						break;
					}

					const importedExternalIds = yield* runWithDb(
						findImportedGlobalExternalIds({ ...preloadTarget, externalIds }),
					).pipe(dieOnDbError);
					const scheduledIds = externalIds
						.filter((externalId) => !importedExternalIds.has(externalId))
						.slice(0, remaining);

					yield* Effect.logInfo("builtin exercises scheduled").pipe(
						Effect.annotateLogs({ page, count: scheduledIds.length }),
					);

					const importResults = yield* Effect.forEach(scheduledIds, importExercise, {
						concurrency: builtinExerciseImportConcurrency,
					});
					remaining -= importResults.filter(Boolean).length;

					if (remaining <= 0 || externalIds.length < builtinExercisePageSize) {
						break;
					}

					page += 1;
				}

				yield* Effect.logInfo("builtin exercise preload finished").pipe(
					Effect.annotateLogs({ preloadLimit, importedCount: preloadLimit - remaining }),
				);
			}).pipe(
				Effect.catchAllCause((cause) => Effect.logError("builtin exercise preload failed", cause)),
			);

			yield* Effect.forkScoped(runPreload);
		}),
	);
