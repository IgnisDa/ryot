import type { CurrentUserValue } from "@ryot/contract/auth-middleware";
import { badRequest, conflict, notFound } from "@ryot/contract/errors";
import type { CreateEventSchemaBody } from "@ryot/contract/modules/event-schemas/schemas";
import { EntitySchemaId } from "@ryot/contract/schema/brands";
import { Effect } from "effect";

import { DbRunner } from "#lib/infrastructure/db/service";
import { parseLabeledPropertySchemaInput } from "#lib/property-schema/property-schema-runtime";
import { slugify } from "#lib/shared/slug";
import { requireText } from "#lib/shared/validation";
import { builtinEntitySchemas } from "#modules/builtins/entity-schemas";

import { EventSchemasRepository } from "./repository";

const reservedEventSchemaSlugsByEntitySchema = new Map(
	builtinEntitySchemas().map(
		(entitySchema) =>
			[
				entitySchema.slug,
				new Set(entitySchema.eventSchemas.map((eventSchema) => eventSchema.slug)),
			] as const,
	),
);

const resolveEventSchemaSlug = (input: { name: string; slug?: string | undefined }) => {
	const candidate = input.slug?.trim() ?? input.name;
	const slug = candidate ? slugify(candidate) : null;
	if (!slug) {
		return badRequest("Event schema slug is required");
	}

	return Effect.succeed(slug);
};

const resolveEventSchemaCreateInput = Effect.fn(function* (
	input: Pick<CreateEventSchemaBody, "name" | "slug">,
) {
	const name = yield* requireText(input.name, "Event schema name is required");
	const slug = yield* resolveEventSchemaSlug({ name, slug: input.slug });
	return { name, slug };
});

const validateEventSchemaSlugNotReserved = (slug: string, entitySchemaSlug: string) => {
	const reservedSlugs = reservedEventSchemaSlugsByEntitySchema.get(entitySchemaSlug);
	if (reservedSlugs?.has(slug)) {
		return badRequest(`Event schema slug "${slug}" is reserved for built-in schemas`);
	}

	return Effect.void;
};

export class EventSchemasService extends Effect.Service<EventSchemasService>()(
	"EventSchemasService",
	{
		effect: Effect.gen(function* () {
			const runWithDb = yield* DbRunner;
			const repository = yield* EventSchemasRepository;

			const requireEntitySchema = Effect.fn("EventSchemasService.requireEntitySchema")(function* (
				user: CurrentUserValue,
				entitySchemaIdInput: string,
			) {
				const entitySchemaId = EntitySchemaId.make(
					yield* requireText(entitySchemaIdInput, "Entity schema id is required"),
				);
				const entitySchema = yield* runWithDb(
					repository.getEntitySchemaScopeById({ entitySchemaId, userId: user.id }),
				);
				if (!entitySchema) {
					return yield* notFound("Entity schema not found");
				}

				return { entitySchema, entitySchemaId };
			});

			const list = Effect.fn("EventSchemasService.list")(function* (
				user: CurrentUserValue,
				input: { entitySchemaId: EntitySchemaId },
			) {
				const { entitySchemaId } = yield* requireEntitySchema(user, input.entitySchemaId);

				return yield* runWithDb(
					repository.listByEntitySchemaForUser({ entitySchemaId, userId: user.id }),
				);
			});

			const create = Effect.fn("EventSchemasService.create")(function* (
				user: CurrentUserValue,
				payload: CreateEventSchemaBody,
			) {
				const { entitySchema, entitySchemaId } = yield* requireEntitySchema(
					user,
					payload.entitySchemaId,
				);
				if (entitySchema.isBuiltin) {
					return yield* badRequest("Built-in entity schemas do not support event schema creation");
				}

				const resolved = yield* resolveEventSchemaCreateInput({
					name: payload.name,
					slug: payload.slug,
				});

				const propertiesSchema = yield* parseLabeledPropertySchemaInput(
					payload.propertiesSchema,
					"Event schema properties",
				).pipe(Effect.mapError((error) => badRequest(error.message)));

				yield* validateEventSchemaSlugNotReserved(resolved.slug, entitySchema.slug);

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
			});

			return { list, create };
		}),
	},
) {}
