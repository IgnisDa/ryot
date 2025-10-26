import { Effect } from "effect";

import type { CurrentUserValue } from "../../lib/auth";
import { builtinEntitySchemas } from "../../lib/builtins/entity-schemas";
import { DbRunner } from "../../lib/db";
import { BadRequest, badRequest, conflict, notFound } from "../../lib/errors";
import { parseLabeledPropertySchemaInput } from "../../lib/property-schema-runtime";
import { slugify } from "../../lib/slug";
import { requireText } from "../../lib/validation";
import { EventSchemasRepository } from "./repository";
import type { CreateEventSchemaBody } from "./schemas";

const reservedEventSchemaSlugsByEntitySchema = new Map(
	builtinEntitySchemas().map(
		(entitySchema) =>
			[
				entitySchema.slug,
				new Set(entitySchema.eventSchemas.map((eventSchema) => eventSchema.slug)),
			] as const,
	),
);

const resolveEventSchemaSlug = (input: { name: string; slug?: string }) => {
	const candidate = input.slug?.trim() ?? input.name;
	const slug = candidate ? slugify(candidate) : null;
	if (!slug) {
		return badRequest("Event schema slug is required");
	}

	return slug;
};

const resolveEventSchemaCreateInput = (input: Pick<CreateEventSchemaBody, "name" | "slug">) => {
	const name = requireText(input.name, "Event schema name is required");
	if (name instanceof BadRequest) {
		return name;
	}

	const slug = resolveEventSchemaSlug({ name, slug: input.slug });
	if (slug instanceof BadRequest) {
		return slug;
	}

	return { name, slug };
};

const validateEventSchemaSlugNotReserved = (slug: string, entitySchemaSlug: string) => {
	const reservedSlugs = reservedEventSchemaSlugsByEntitySchema.get(entitySchemaSlug);
	if (reservedSlugs?.has(slug)) {
		return badRequest(`Event schema slug "${slug}" is reserved for built-in schemas`);
	}

	return undefined;
};

export class EventSchemasService extends Effect.Service<EventSchemasService>()(
	"EventSchemasService",
	{
		effect: Effect.gen(function* () {
			const runWithDb = yield* DbRunner;
			const repository = yield* EventSchemasRepository;

			return {
				list: (user: CurrentUserValue, input: { entitySchemaId: string }) =>
					Effect.gen(function* () {
						const entitySchemaId = requireText(
							input.entitySchemaId,
							"Entity schema id is required",
						);
						if (entitySchemaId instanceof BadRequest) {
							return yield* entitySchemaId;
						}

						const entitySchema = yield* runWithDb(
							repository.getEntitySchemaScopeById({ entitySchemaId, userId: user.id }),
						);
						if (!entitySchema) {
							return yield* notFound("Entity schema not found");
						}

						return yield* runWithDb(
							repository.listByEntitySchemaForUser({ entitySchemaId, userId: user.id }),
						);
					}),
				create: (user: CurrentUserValue, payload: CreateEventSchemaBody) =>
					Effect.gen(function* () {
						const entitySchemaId = requireText(
							payload.entitySchemaId,
							"Entity schema id is required",
						);
						if (entitySchemaId instanceof BadRequest) {
							return yield* entitySchemaId;
						}

						const entitySchema = yield* runWithDb(
							repository.getEntitySchemaScopeById({ entitySchemaId, userId: user.id }),
						);
						if (!entitySchema) {
							return yield* notFound("Entity schema not found");
						}
						if (entitySchema.isBuiltin) {
							return yield* badRequest(
								"Built-in entity schemas do not support event schema creation",
							);
						}

						const resolved = resolveEventSchemaCreateInput({
							name: payload.name,
							slug: payload.slug,
						});
						if (resolved instanceof BadRequest) {
							return yield* resolved;
						}

						const propertiesSchema = yield* parseLabeledPropertySchemaInput(
							payload.propertiesSchema,
							"Event schema properties",
						).pipe(Effect.mapError((error) => badRequest(error.message)));

						const reservedSlug = validateEventSchemaSlugNotReserved(
							resolved.slug,
							entitySchema.slug,
						);
						if (reservedSlug instanceof BadRequest) {
							return yield* reservedSlug;
						}

						const existing = yield* runWithDb(
							repository.findBySlugForUser({
								entitySchemaId,
								userId: user.id,
								slug: resolved.slug,
							}),
						);
						if (existing) {
							return yield* conflict("Event schema slug already exists");
						}

						return yield* runWithDb(
							repository.createEventSchema({
								entitySchemaId,
								userId: user.id,
								propertiesSchema,
								name: resolved.name,
								slug: resolved.slug,
							}),
						);
					}),
			};
		}),
	},
) {}
