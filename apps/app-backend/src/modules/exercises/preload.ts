import { and, eq, isNull, sql } from "drizzle-orm";
import { Cause, DateTime, Effect, Layer, Schema } from "effect";

import { CurrentDb, DbRunner, dbEffect, schema } from "#lib/db";
import { dieOnDbError, unknownToMessage } from "#lib/errors";
import { SandboxService } from "#lib/sandbox/service";
import { parseAppSchemaProperties } from "#lib/schema/core";
import {
	decodeEntityDetailsResult,
	decodeEntitySearchResult,
	processRelatedEntity,
} from "#modules/entities/population";
import { EntitiesRepository } from "#modules/entities/repository";
import { SandboxRepository } from "#modules/sandbox/repository";

const builtinExercisePageSize = 100;
const builtinExerciseExpectedCount = 873;
const builtinExerciseImportConcurrency = 5;
const builtinExerciseScriptSlug = "exercise.free-exercise-db";

class BuiltinEntityPreloadError extends Schema.TaggedError<BuiltinEntityPreloadError>()(
	"BuiltinEntityPreloadError",
	{ message: Schema.String },
) {}

const extractPrimaryRemoteImage = (images: unknown) => {
	if (!Array.isArray(images)) {
		return null;
	}

	for (const image of images) {
		if (typeof image !== "object" || image === null) {
			continue;
		}

		const type = Reflect.get(image, "type");
		const url = Reflect.get(image, "url");
		if (type === "remote" && typeof url === "string" && url.length > 0) {
			return { type: "remote" as const, url };
		}
	}

	return null;
};

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

		const runDriver = (input: {
			driverName: string;
			executionId: string;
			context: Record<string, unknown>;
		}) =>
			sandbox
				.run({
					userId: null,
					code: script.code,
					scriptId: script.id,
					context: input.context,
					driverName: input.driverName,
					executionId: input.executionId,
					allowedHostFunctions: script.metadata.allowedHostFunctions ?? [],
				})
				.pipe(
					Effect.mapError((error) => new BuiltinEntityPreloadError({ message: error.message })),
				);

		const searchBuiltinExercises = (page: number) =>
			runDriver({
				driverName: "search",
				executionId: `builtin-exercise-search-${page}`,
				context: { query: "", page, pageSize: builtinExercisePageSize },
			}).pipe(
				Effect.flatMap((result) =>
					result.error
						? Effect.fail(new BuiltinEntityPreloadError({ message: result.error }))
						: decodeEntitySearchResult(result.value).pipe(
								Effect.mapError(
									(error) =>
										new BuiltinEntityPreloadError({
											message: `Builtin exercise search returned an unexpected shape: ${error.message}`,
										}),
								),
							),
				),
				Effect.map(({ items }) => [...new Set(items.map((item) => item.externalId))]),
			);

		const loadBuiltinExerciseDetails = (externalId: string) =>
			runDriver({
				driverName: "details",
				context: { externalId },
				executionId: `builtin-exercise-details-${externalId}`,
			}).pipe(
				Effect.flatMap((result) =>
					result.error
						? Effect.fail(new BuiltinEntityPreloadError({ message: result.error }))
						: Effect.succeed(result.value),
				),
			);

		const importBuiltinExercise = (externalId: string) =>
			Effect.gen(function* () {
				const existing = yield* runWithDb(
					repository.findGlobalEntityByExternalId({
						externalId,
						entitySchemaId: preloadTarget.entitySchemaId,
						sandboxScriptId: preloadTarget.sandboxScriptId,
					}),
				);
				if (existing && existing.populatedAt !== null) {
					return;
				}

				const detailsValue = yield* loadBuiltinExerciseDetails(externalId);
				const entitySchemaScope = yield* runWithDb(
					repository.findEntitySchemaById(preloadTarget.entitySchemaId),
				).pipe(
					Effect.flatMap((scope) =>
						scope
							? Effect.succeed(scope)
							: new BuiltinEntityPreloadError({ message: "Entity schema not found" }),
					),
				);

				const details = yield* decodeEntityDetailsResult(detailsValue).pipe(
					Effect.mapError(
						(error) =>
							new BuiltinEntityPreloadError({
								message: `Invalid entity details: ${error.message}`,
							}),
					),
				);
				const validatedProperties = yield* parseAppSchemaProperties({
					kind: "Entity",
					properties: details.properties,
					propertiesSchema: entitySchemaScope.propertiesSchema,
				}).pipe(
					Effect.mapError((error) => new BuiltinEntityPreloadError({ message: error.message })),
				);

				const entity = yield* runWithDb(
					repository.createOrUpdateGlobalEntity({
						externalId,
						image: null,
						populatedAt: null,
						name: details.name,
						properties: validatedProperties,
						entitySchemaId: preloadTarget.entitySchemaId,
						sandboxScriptId: preloadTarget.sandboxScriptId,
					}),
				);

				yield* Effect.forEach(
					details.relatedEntities ?? [],
					(relatedEntity) =>
						processRelatedEntity({
							relatedEntity,
							sourceEntityId: entity.id,
							sourceEntitySchemaId: preloadTarget.entitySchemaId,
						}).pipe(
							Effect.mapError((error) => new BuiltinEntityPreloadError({ message: error.message })),
						),
					{ discard: true },
				);

				const populatedAt = yield* DateTime.nowAsDate;
				yield* runWithDb(
					repository.createOrUpdateGlobalEntity({
						externalId,
						populatedAt,
						name: details.name,
						properties: validatedProperties,
						entitySchemaId: preloadTarget.entitySchemaId,
						sandboxScriptId: preloadTarget.sandboxScriptId,
						image: extractPrimaryRemoteImage(validatedProperties.images),
					}),
				);
			});

		const runPreload = Effect.gen(function* () {
			yield* Effect.logInfo(
				`Starting builtin exercise preload (${importedCount}/${builtinExerciseExpectedCount} imported)`,
			);

			let page = 1;

			for (;;) {
				const externalIds = yield* searchBuiltinExercises(page).pipe(
					Effect.catchAll((error) =>
						Effect.logError(
							`Builtin exercise preload search failed on page ${page}: ${error.message}`,
						).pipe(Effect.as<string[]>([])),
					),
				);

				if (externalIds.length === 0) {
					break;
				}

				yield* Effect.logInfo(
					`Importing ${externalIds.length} builtin exercises from page ${page}`,
				);

				yield* Effect.forEach(
					externalIds,
					(externalId) =>
						importBuiltinExercise(externalId).pipe(
							Effect.catchAll((error) =>
								Effect.logError(
									`Failed to import builtin exercise '${externalId}': ${error.message}`,
								),
							),
						),
					{ concurrency: builtinExerciseImportConcurrency, discard: true },
				);

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
