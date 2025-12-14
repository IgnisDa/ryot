import { Effect } from "effect";

import type { CurrentUserValue } from "../../lib/auth";
import { builtinEntitySchemas } from "../../lib/builtins/entity-schemas";
import { DbRunner, TransactionRunner } from "../../lib/db";
import { BadRequest, badRequest, conflict, notFound } from "../../lib/errors";
import { parseLabeledPropertySchemaInput } from "../../lib/property-schema-runtime";
import { TrackersRepository } from "../trackers/repository";
import { EntitySchemasRepository } from "./repository";
import type { CreateEntitySchemaBody } from "./schemas";

const normalizeSlug = (value: string): string =>
	value
		.replaceAll("_", "-")
		.trim()
		.toLowerCase()
		.replace(/\s+/g, "-")
		.replace(/[^a-z0-9-]/g, "")
		.replace(/-+/g, "-")
		.replace(/^-+|-+$/g, "");

const resolveRequiredText = (value: string) => {
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
};

const resolveEntitySchemaName = (name: string) => {
	const resolved = resolveRequiredText(name);
	if (!resolved) {
		return badRequest("Entity schema name is required");
	}
	return resolved;
};

const resolveEntitySchemaIcon = (icon: string) => {
	const resolved = resolveRequiredText(icon);
	if (!resolved) {
		return badRequest("Entity schema icon is required");
	}
	return resolved;
};

const resolveEntitySchemaAccentColor = (accentColor: string) => {
	const resolved = resolveRequiredText(accentColor);
	if (!resolved) {
		return badRequest("Entity schema accent color is required");
	}
	return resolved;
};

const resolveEntitySchemaTrackerId = (trackerId: string) => {
	const resolved = trackerId.trim();
	return resolved.length > 0 ? resolved : null;
};

const resolveEntitySchemaSlug = (input: { name: string; slug?: string }) => {
	const candidate = input.slug?.trim() ?? input.name;
	const slug = candidate ? normalizeSlug(candidate) : null;
	if (!slug) {
		return badRequest("Entity schema slug is required");
	}
	return slug;
};

const validateSlugNotReserved = (slug: string): void => {
	const reservedSlugs = builtinEntitySchemas().map((s) => s.slug);
	if (reservedSlugs.includes(slug)) {
		throw new Error(`Entity schema slug "${slug}" is reserved for built-in schemas`);
	}
};

const resolveEntitySchemaCreateInput = (
	input: Pick<CreateEntitySchemaBody, "icon" | "name" | "slug" | "accentColor">,
) => {
	const icon = resolveEntitySchemaIcon(input.icon);
	if (icon instanceof BadRequest) {
		return icon;
	}

	const name = resolveEntitySchemaName(input.name);
	if (name instanceof BadRequest) {
		return name;
	}

	const accentColor = resolveEntitySchemaAccentColor(input.accentColor);
	if (accentColor instanceof BadRequest) {
		return accentColor;
	}

	const slug = resolveEntitySchemaSlug({ name, slug: input.slug });
	if (slug instanceof BadRequest) {
		return slug;
	}

	try {
		validateSlugNotReserved(slug);
	} catch (error) {
		return badRequest(error instanceof Error ? error.message : String(error));
	}

	return { icon, name, slug, accentColor };
};

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
							const trackerId = resolveEntitySchemaTrackerId(input.trackerId);
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
						const trackerId = resolveEntitySchemaTrackerId(payload.trackerId);
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

						const resolved = resolveEntitySchemaCreateInput({
							icon: payload.icon,
							name: payload.name,
							slug: payload.slug,
							accentColor: payload.accentColor,
						});
						if (resolved instanceof BadRequest) {
							return yield* resolved;
						}

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
