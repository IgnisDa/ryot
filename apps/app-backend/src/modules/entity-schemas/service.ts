import { WorkflowEngine } from "@effect/workflow/WorkflowEngine";
import type { CurrentUserValue } from "@ryot/contract/auth-middleware";
import { badRequest, conflict, notFound } from "@ryot/contract/errors";
import type {
	CreateEntitySchemaBody,
	SearchEntitySchemasBody,
} from "@ryot/contract/modules/entity-schemas/schemas";
import { type EntitySchemaId, TrackerId } from "@ryot/contract/schema/brands";
import { generateId } from "better-auth";
import { Effect } from "effect";

import { DbRunner, TransactionRunner } from "#lib/infrastructure/db/service";
import { parseLabeledPropertySchemaInput } from "#lib/property-schema/property-schema-runtime";
import { requireSlug } from "#lib/shared/slug";
import { requireText, trimToNull } from "#lib/shared/validation";
import { builtinEntitySchemas } from "#modules/builtins/entity-schemas";
import { SandboxApiService } from "#modules/sandbox/service";
import { TrackersRepository } from "#modules/trackers/repository";

import { CreateDefaultSavedViewWorkflow } from "./default-saved-view-workflow";
import { EntitySchemasRepository } from "./repository";

const reservedEntitySchemaSlugs = new Set(builtinEntitySchemas().map((s) => s.slug));

const resolveEntitySchemaCreateInput = Effect.fn(function* (
	input: Pick<CreateEntitySchemaBody, "icon" | "name" | "slug" | "accentColor">,
) {
	const icon = yield* requireText(input.icon, "Entity schema icon is required");
	const name = yield* requireText(input.name, "Entity schema name is required");
	const accentColor = yield* requireText(
		input.accentColor,
		"Entity schema accent color is required",
	);
	const slug = yield* requireSlug({ label: "Entity schema", name, slug: input.slug });

	if (reservedEntitySchemaSlugs.has(slug)) {
		return yield* badRequest(`Entity schema slug "${slug}" is reserved for built-in schemas`);
	}

	return { icon, name, slug, accentColor };
});

export class EntitySchemasService extends Effect.Service<EntitySchemasService>()(
	"EntitySchemasService",
	{
		effect: Effect.gen(function* () {
			const runWithDb = yield* DbRunner;
			const engine = yield* WorkflowEngine;
			const runInTransaction = yield* TransactionRunner;
			const repository = yield* EntitySchemasRepository;
			const sandboxApiService = yield* SandboxApiService;
			const trackersRepository = yield* TrackersRepository;

			const list = Effect.fn("EntitySchemasService.list")(function* (
				user: CurrentUserValue,
				input: { trackerId?: TrackerId | undefined; slugs?: ReadonlyArray<string> | undefined },
			) {
				if (input.trackerId) {
					const trackerId = trimToNull(input.trackerId);
					if (!trackerId) {
						return yield* badRequest("Tracker id is required");
					}

					const tracker = yield* runWithDb(
						trackersRepository.getOwnedById(user.id, TrackerId.make(trackerId)),
					);
					if (!tracker) {
						return yield* notFound("Tracker not found");
					}
				}

				return yield* runWithDb(
					repository.listByUser({
						userId: user.id,
						slugs: input.slugs,
						trackerId: input.trackerId,
					}),
				);
			});

			const create = Effect.fn("EntitySchemasService.create")(function* (
				user: CurrentUserValue,
				payload: CreateEntitySchemaBody,
			) {
				const trackerId = trimToNull(payload.trackerId);
				if (!trackerId) {
					return yield* badRequest("Tracker id is required");
				}

				const tracker = yield* runWithDb(
					trackersRepository.getOwnedById(user.id, TrackerId.make(trackerId)),
				);
				if (!tracker) {
					return yield* notFound("Tracker not found");
				}
				if (tracker.isBuiltin) {
					return yield* badRequest("Built-in trackers do not support entity schema creation");
				}

				const resolved = yield* resolveEntitySchemaCreateInput({
					icon: payload.icon,
					name: payload.name,
					slug: payload.slug,
					accentColor: payload.accentColor,
				});

				const propertiesSchema = yield* parseLabeledPropertySchemaInput(
					payload.propertiesSchema,
					"Entity schema properties",
				).pipe(Effect.mapError((error) => badRequest(error.message)));

				const existing = yield* runWithDb(repository.findBySlug(user.id, resolved.slug));
				if (existing) {
					return yield* conflict("Entity schema slug already exists");
				}

				const createdEntitySchema = yield* runInTransaction(
					Effect.gen(function* () {
						const created = yield* repository.createEntitySchema({
							userId: user.id,
							propertiesSchema,
							icon: resolved.icon,
							name: resolved.name,
							slug: resolved.slug,
							accentColor: resolved.accentColor,
						});

						yield* trackersRepository.linkEntitySchema({
							entitySchemaId: created.id,
							trackerId: TrackerId.make(trackerId),
						});

						return created;
					}),
				);

				const executionId = generateId();
				yield* engine
					.execute(CreateDefaultSavedViewWorkflow, {
						executionId,
						discard: true,
						payload: {
							executionId,
							userId: user.id,
							icon: resolved.icon,
							entitySchemaSlug: resolved.slug,
							entitySchemaName: resolved.name,
							accentColor: resolved.accentColor,
							trackerId: TrackerId.make(trackerId),
						},
					})
					.pipe(Effect.orDie);

				return {
					providers: [],
					id: createdEntitySchema.id,
					name: createdEntitySchema.name,
					slug: createdEntitySchema.slug,
					icon: createdEntitySchema.icon,
					trackerId: TrackerId.make(trackerId),
					isBuiltin: createdEntitySchema.isBuiltin,
					accentColor: createdEntitySchema.accentColor,
					propertiesSchema: createdEntitySchema.propertiesSchema,
				};
			});

			const getById = Effect.fn("EntitySchemasService.getById")(function* (
				user: CurrentUserValue,
				entitySchemaId: EntitySchemaId,
			) {
				const result = yield* runWithDb(
					repository.getByIdForUser({ userId: user.id, entitySchemaId }),
				);
				if (!result) {
					return yield* notFound("Entity schema not found");
				}
				return result;
			});

			const search = Effect.fn("EntitySchemasService.search")(function* (
				user: CurrentUserValue,
				payload: SearchEntitySchemasBody,
			) {
				return yield* sandboxApiService.enqueue(user, {
					driverName: "search",
					context: payload.context,
					scriptId: payload.scriptId,
				});
			});

			const getSearchResult = Effect.fn("EntitySchemasService.getSearchResult")(function* (
				user: CurrentUserValue,
				jobId: string,
			) {
				return yield* sandboxApiService.getResult(user, jobId);
			});

			return { list, create, getById, search, getSearchResult };
		}),
	},
) {}
