import { Effect, Schema } from "effect";

import type { CurrentUserValue } from "#lib/auth-middleware";
import { builtinRelationshipSchemas } from "#lib/builtins/relationship-schemas";
import { DbRunner } from "#lib/db";
import { badRequest, conflict, notFound } from "#lib/errors";
import type { RelationshipSchemaId, UserId, EntitySchemaId } from "#lib/schema/brands";
import { Slug } from "#lib/schema/brands";
import { AppSchema } from "#lib/schema/property-schema";
import { validateAppSchemaDefinition } from "#lib/schema/property-schema-runtime";
import { slugify } from "#lib/slug";
import { requireText } from "#lib/validation";

import { RelationshipSchemasRepository } from "./repository";
import type { CreateRelationshipSchemaBody, ListRelationshipSchemasBody } from "./schemas";

const reservedRelationshipSchemaSlugs = new Set(builtinRelationshipSchemas().map((s) => s.slug));

const relationshipSchemaNotFoundError = "Relationship schema not found";

const resolveRelationshipSchemaSlug = (input: { name: string; slug?: string }) => {
	const candidate = input.slug?.trim() ?? input.name;
	const slug = candidate ? slugify(candidate) : null;
	if (!slug) {
		return badRequest("Relationship schema slug is required");
	}
	return Schema.decode(Slug)(slug).pipe(
		Effect.mapError(() => badRequest("Relationship schema slug is invalid")),
	);
};

const resolveRelationshipSchemaCreateInput = Effect.fn(function* (
	input: Pick<CreateRelationshipSchemaBody, "name" | "slug">,
) {
	const name = yield* requireText(input.name, "Relationship schema name is required");
	const slug = yield* resolveRelationshipSchemaSlug({ name, slug: input.slug });

	if (reservedRelationshipSchemaSlugs.has(slug)) {
		return yield* badRequest(`Relationship schema slug "${slug}" is reserved for built-in schemas`);
	}

	return { name, slug };
});

const parseRelationshipPropertiesSchema = (input: unknown) =>
	Schema.decodeUnknown(AppSchema)(input).pipe(
		Effect.mapError(() => badRequest("Relationship schema properties must be a valid schema")),
		Effect.flatMap((propertiesSchema) => {
			const issues = validateAppSchemaDefinition(propertiesSchema);
			const message = issues.map((issue) => issue.message).join("; ");
			return issues.length > 0
				? Effect.fail(badRequest(message))
				: Effect.succeed(propertiesSchema);
		}),
	);

export class RelationshipSchemasService extends Effect.Service<RelationshipSchemasService>()(
	"RelationshipSchemasService",
	{
		effect: Effect.gen(function* () {
			const runWithDb = yield* DbRunner;
			const repository = yield* RelationshipSchemasRepository;

			const validateEntitySchemaAccess = Effect.fn(function* (
				user: CurrentUserValue,
				entitySchemaId: EntitySchemaId | null | undefined,
			) {
				if (entitySchemaId === undefined || entitySchemaId === null) {
					return yield* Effect.void;
				}

				const entitySchema = yield* runWithDb(
					repository.getEntitySchemaScopeById({ entitySchemaId, userId: user.id }),
				);
				if (!entitySchema) {
					return yield* notFound("Entity schema not found");
				}
				return yield* Effect.void;
			});

			return {
				findBuiltinBySlug: Effect.fn("RelationshipSchemasService.findBuiltinBySlug")(function* (
					slug: string,
				) {
					const found = yield* runWithDb(repository.findBuiltinBySlug(slug));
					if (!found) {
						return yield* notFound(relationshipSchemaNotFoundError);
					}
					return found;
				}),
				findById: Effect.fn("RelationshipSchemasService.findById")(function* (
					id: RelationshipSchemaId,
					userId: UserId | null,
				) {
					const found = yield* runWithDb(repository.findById(id, userId));
					if (!found) {
						return yield* notFound(relationshipSchemaNotFoundError);
					}
					return found;
				}),
				list: Effect.fn("RelationshipSchemasService.list")(function* (
					user: CurrentUserValue,
					input: ListRelationshipSchemasBody,
				) {
					if (input.sourceEntitySchemaId !== undefined) {
						yield* validateEntitySchemaAccess(user, input.sourceEntitySchemaId);
					}
					if (input.targetEntitySchemaId !== undefined) {
						yield* validateEntitySchemaAccess(user, input.targetEntitySchemaId);
					}

					return yield* runWithDb(
						repository.listByUser({
							userId: user.id,
							slugs: input.slugs,
							sourceEntitySchemaId: input.sourceEntitySchemaId,
							targetEntitySchemaId: input.targetEntitySchemaId,
						}),
					);
				}),
				create: Effect.fn("RelationshipSchemasService.create")(function* (
					user: CurrentUserValue,
					payload: CreateRelationshipSchemaBody,
				) {
					yield* validateEntitySchemaAccess(user, payload.sourceEntitySchemaId);
					yield* validateEntitySchemaAccess(user, payload.targetEntitySchemaId);

					const resolved = yield* resolveRelationshipSchemaCreateInput({
						name: payload.name,
						slug: payload.slug,
					});

					const propertiesSchema = yield* parseRelationshipPropertiesSchema(
						payload.propertiesSchema,
					);

					const existing = yield* runWithDb(
						repository.findBySlugForUser({ userId: user.id, slug: resolved.slug }),
					);
					if (existing) {
						return yield* conflict("Relationship schema slug already exists");
					}

					return yield* runWithDb(
						repository.createRelationshipSchema({
							userId: user.id,
							propertiesSchema,
							name: resolved.name,
							slug: resolved.slug,
							sourceEntitySchemaId: payload.sourceEntitySchemaId ?? null,
							targetEntitySchemaId: payload.targetEntitySchemaId ?? null,
						}),
					);
				}),
			};
		}),
	},
) {}
