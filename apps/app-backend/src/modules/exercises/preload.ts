import { WorkflowEngine } from "@effect/workflow/WorkflowEngine";
import { and, eq, isNull, sql } from "drizzle-orm";
import { Cause, Effect, Layer } from "effect";

import { CurrentDb, DbRunner, dbEffect } from "#lib/db";
import * as schema from "#lib/db/schema/tables";
import { dieOnDbError, unknownToMessage } from "#lib/errors";
import { SandboxService } from "#lib/sandbox/service";
import { EntitiesRepository } from "#modules/entities/repository";
import { decodeEntitySearchResult } from "#modules/entity-import/population";
import { BuiltinEntityImportWorkflow } from "#modules/entity-import/workflows";
import { SandboxRepository } from "#modules/sandbox/repository";

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

export const BuiltinEntityPreloaderLive = Layer.scopedDiscard(
	Effect.gen(function* () {
		const runWithDb = yield* DbRunner;
		const engine = yield* WorkflowEngine;
		const sandbox = yield* SandboxService;
		const repository = yield* EntitiesRepository;
		const sandboxRepository = yield* SandboxRepository;

		const preloadTarget = yield* runWithDb(
			repository.findEntitySchemaScriptBySlug(builtinExerciseScriptSlug),
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
		if (importedCount >= builtinExerciseExpectedCount) {
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

		const searchPage = (page: number) =>
			sandbox
				.run({
					userId: null,
					code: script.code,
					scriptId: script.id,
					driverName: "search",
					scriptIsBuiltin: script.isBuiltin,
					executionId: `builtin-exercise-search-${page}`,
					context: { query: "", page, pageSize: builtinExercisePageSize },
					allowedHostFunctions: script.metadata.allowedHostFunctions ?? [],
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
				.execute(BuiltinEntityImportWorkflow, {
					discard: true,
					executionId: `builtin-exercise-${externalId}`,
					payload: {
						externalId,
						userId: null,
						scriptId: preloadTarget.sandboxScriptId,
						entitySchemaId: preloadTarget.entitySchemaId,
						executionId: `builtin-exercise-${externalId}`,
					},
				})
				.pipe(Effect.orDie);

		const runPreload = Effect.gen(function* () {
			yield* Effect.logInfo(
				`Starting builtin exercise preload (${importedCount}/${builtinExerciseExpectedCount} imported)`,
			);

			let page = 1;

			for (;;) {
				const externalIds = yield* searchPage(page);

				if (externalIds.length === 0) {
					break;
				}

				yield* Effect.logInfo(
					`Scheduling ${externalIds.length} builtin exercises from page ${page}`,
				);

				yield* Effect.forEach(externalIds, scheduleImport, { discard: true });

				if (externalIds.length < builtinExercisePageSize) {
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
