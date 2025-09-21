import { Context, Effect, Layer } from "effect";

import { DbRunner } from "../../lib/db";
import type { DbError, NotFound } from "../../lib/errors";
import { notFound } from "../../lib/errors";
import { RelationshipSchemasRepository } from "./repository";
import type { RelationshipSchemaScope } from "./schemas";

export class RelationshipSchemasService extends Context.Tag("RelationshipSchemasService")<
	RelationshipSchemasService,
	{
		readonly getBuiltinBySlug: (
			slug: string,
		) => Effect.Effect<RelationshipSchemaScope, NotFound | DbError>;
		readonly getById: (
			id: string,
			userId: string | null,
		) => Effect.Effect<RelationshipSchemaScope, NotFound | DbError>;
	}
>() {}

export const RelationshipSchemasServiceLive = Layer.effect(
	RelationshipSchemasService,
	Effect.gen(function* () {
		const runWithDb = yield* DbRunner;
		const repository = yield* RelationshipSchemasRepository;

		return {
			getBuiltinBySlug: (slug) =>
				Effect.gen(function* () {
					const found = yield* runWithDb(repository.findBuiltinBySlug(slug));
					if (!found) {
						return yield* notFound("Relationship schema not found");
					}
					return found;
				}),
			getById: (id, userId) =>
				Effect.gen(function* () {
					const found = yield* runWithDb(repository.findById(id, userId));
					if (!found) {
						return yield* notFound("Relationship schema not found");
					}
					return found;
				}),
		};
	}),
);
