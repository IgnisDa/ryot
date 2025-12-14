import { Effect } from "effect";

import type { CurrentUserValue } from "../../lib/auth";
import { builtinEntitySchemas } from "../../lib/builtins/entity-schemas";
import { DbRunner, TransactionRunner } from "../../lib/db";
import { badRequest, conflict, notFound } from "../../lib/errors";
import { parseLabeledPropertySchemaInput } from "../../lib/property-schema-runtime";
import { slugify } from "../../lib/slug";
import { requireText, trimToNull } from "../../lib/validation";
import { TrackersRepository } from "../trackers/repository";
import { EntitySchemasRepository } from "./repository";
import type { CreateEntitySchemaBody } from "./schemas";

const reservedEntitySchemaSlugs = new Set(builtinEntitySchemas().map((s) => s.slug));

const resolveEntitySchemaSlug = (input: { name: string; slug?: string }) => {
	const candidate = input.slug?.trim() ?? input.name;
	const slug = candidate ? slugify(candidate) : null;
	if (!slug) {
		return badRequest("Entity schema slug is required");
	}
	return Effect.succeed(slug);
};

const resolveEntitySchemaCreateInput = (
	input: Pick<CreateEntitySchemaBody, "icon" | "name" | "slug" | "accentColor">,
) =>
	Effect.gen(function* () {
		const icon = yield* requireText(input.icon, "Entity schema icon is required");
		const name = yield* requireText(input.name, "Entity schema name is required");
		const accentColor = yield* requireText(
			input.accentColor,
			"Entity schema accent color is required",
		);
		const slug = yield* resolveEntitySchemaSlug({ name, slug: input.slug });

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
			const runInTransaction = yield* TransactionRunner;
			const repository = yield* EntitySchemasRepository;
			const trackersRepository = yield* TrackersRepository;

			return {
				list: (
					user: CurrentUserValue,
					input: { trackerId?: string; slugs?: ReadonlyArray<string> },
				) =>
					Effect.gen(function* () {
						if (input.trackerId) {
							const trackerId = trimToNull(input.trackerId);
							if (!trackerId) {
								return yield* badRequest("Tracker id is required");
							}

							const tracker = yield* runWithDb(trackersRepository.getOwnedById(user.id, trackerId));
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
					}),
				create: (user: CurrentUserValue, payload: CreateEntitySchemaBody) =>
					Effect.gen(function* () {
						const trackerId = trimToNull(payload.trackerId);
						if (!trackerId) {
							return yield* badRequest("Tracker id is required");
						}

						const tracker = yield* runWithDb(trackersRepository.getOwnedById(user.id, trackerId));
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

						return yield* runInTransaction(
							Effect.gen(function* () {
								const createdEntitySchema = yield* repository.createEntitySchema({
									userId: user.id,
									propertiesSchema,
									icon: resolved.icon,
									name: resolved.name,
									slug: resolved.slug,
									accentColor: resolved.accentColor,
								});

								yield* repository.linkToTracker({
									trackerId,
									entitySchemaId: createdEntitySchema.id,
								});

								yield* repository.createDefaultSavedView({
									trackerId,
									userId: user.id,
									icon: resolved.icon,
									entitySchemaSlug: resolved.slug,
									entitySchemaName: resolved.name,
									accentColor: resolved.accentColor,
								});

								return {
									trackerId,
									providers: [],
									id: createdEntitySchema.id,
									name: createdEntitySchema.name,
									slug: createdEntitySchema.slug,
									icon: createdEntitySchema.icon,
									isBuiltin: createdEntitySchema.isBuiltin,
									accentColor: createdEntitySchema.accentColor,
									propertiesSchema: createdEntitySchema.propertiesSchema,
								};
							}),
						);
					}),
				getById: (user: CurrentUserValue, entitySchemaId: string) =>
					Effect.gen(function* () {
						const result = yield* runWithDb(
							repository.getByIdForUser({ userId: user.id, entitySchemaId }),
						);
						if (!result) {
							return yield* notFound("Entity schema not found");
						}
						return result;
					}),
			};
		}),
	},
) {}
