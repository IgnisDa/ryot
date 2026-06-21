import { WorkflowEngine } from "@effect/workflow/WorkflowEngine";
import { dieOnDbError, unknownToMessage } from "@ryot/contract/errors";
import { generateId } from "better-auth";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { Cause, Effect, Layer } from "effect";

import { AppConfig } from "#lib/infrastructure/config/service";
import * as schema from "#lib/infrastructure/db/schema/tables/combined";
import { CurrentDb, DbRunner, dbEffect } from "#lib/infrastructure/db/service";
import { EntitiesRepository } from "#modules/entities/repository";
import { decodeEntitySearchResult } from "#modules/entity-import/population";
import { ProviderEntityPopulationWorkflow } from "#modules/entity-import/provider-entity-population-workflow";
import { SandboxRepository } from "#modules/sandbox/repository";
import { RunSandboxWorkflow } from "#modules/sandbox/sandbox-run-workflow";

const builtinExercisePageSize = 100;
const builtinExerciseExpectedCount = 873;
const builtinExerciseScriptSlug = "exercise.free-exercise-db";

const countImportedGlobalEntities = Effect.fn(function* (input: {
	entitySchemaId: string;
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
					eq(schema.entity.entitySchemaId, input.entitySchemaId),
					eq(schema.entity.sandboxScriptId, input.sandboxScriptId),
				),
			)
			.limit(1),
	);
	return row?.count ?? 0;
});

const findImportedGlobalExternalIds = Effect.fn(function* (input: {
	externalIds: string[];
	entitySchemaId: string;
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
					eq(schema.entity.entitySchemaId, input.entitySchemaId),
					eq(schema.entity.sandboxScriptId, input.sandboxScriptId),
					inArray(schema.entity.externalId, input.externalIds),
				),
			),
	);

	return new Set(rows.flatMap((row) => (row.externalId ? [row.externalId] : [])));
});

export const BuiltinEntityPreloaderLive = Layer.scopedDiscard(
	Effect.gen(function* () {
		const config = yield* AppConfig;
		const runWithDb = yield* DbRunner;
		const engine = yield* WorkflowEngine;
		const repository = yield* EntitiesRepository;
		const sandboxRepository = yield* SandboxRepository;

		const preloadTarget = yield* runWithDb(
			repository.findEntitySchemaSandboxScriptBySlug(builtinExerciseScriptSlug),
		);
		if (!preloadTarget) {
			yield* Effect.logWarning(
				`Builtin exercise preload skipped because '${builtinExerciseScriptSlug}' is not linked to an entity schema`,
			);
			return;
		}

		const importedCount = yield* runWithDb(countImportedGlobalEntities(preloadTarget)).pipe(
			dieOnDbError,
		);
		const preloadLimit = Math.min(
			builtinExerciseExpectedCount,
			Math.max(0, config.builtinExercisePreloadLimit),
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
			yield* Effect.logWarning(
				`Builtin exercise preload skipped because script '${builtinExerciseScriptSlug}' was not found`,
			);
			return;
		}

		const preloadRunId = generateId();

		const searchPage = (page: number) =>
			engine
				.execute(RunSandboxWorkflow, {
					executionId: `${preloadRunId}-search-${page}`,
					payload: {
						userId: null,
						scriptId: script.id,
						driverName: "search",
						executionId: `${preloadRunId}-search-${page}`,
						context: { query: "", page, pageSize: builtinExercisePageSize },
					},
				})
				.pipe(
					Effect.flatMap((result) =>
						result.error
							? Effect.logError(
									`Builtin exercise search failed on page ${page}: ${result.error}`,
								).pipe(Effect.as<string[]>([]))
							: decodeEntitySearchResult(result.value).pipe(
									Effect.map(({ items }) => [...new Set(items.map((item) => item.externalId))]),
									Effect.catchAll(() => Effect.succeed<string[]>([])),
								),
					),
				);

		const scheduleImport = (externalId: string) =>
			engine
				.execute(ProviderEntityPopulationWorkflow, {
					discard: true,
					executionId: `builtin-exercise-${externalId}`,
					payload: {
						externalId,
						userId: null,
						mode: "ensure",
						scriptId: preloadTarget.sandboxScriptId,
						entitySchemaId: preloadTarget.entitySchemaId,
						executionId: `builtin-exercise-${externalId}`,
					},
				})
				.pipe(Effect.orDie);

		const runPreload = Effect.gen(function* () {
			yield* Effect.logInfo(
				`Starting builtin exercise preload (${importedCount}/${preloadLimit} imported)`,
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

				yield* Effect.logInfo(
					`Scheduling ${scheduledIds.length} builtin exercises from page ${page}`,
				);

				yield* Effect.forEach(scheduledIds, scheduleImport, { discard: true });
				remaining -= scheduledIds.length;

				if (remaining <= 0 || externalIds.length < builtinExercisePageSize) {
					break;
				}

				page += 1;
			}
		}).pipe(
			Effect.catchAllCause((cause) =>
				Effect.logError(
					`Builtin exercise preload failed: ${unknownToMessage(Cause.squash(cause))}`,
				),
			),
		);

		yield* Effect.forkScoped(runPreload);
	}),
);
