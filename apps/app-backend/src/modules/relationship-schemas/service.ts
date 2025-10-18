import { Effect } from "effect";

import { DbRunner } from "#lib/db";
import { notFound } from "#lib/errors";
import type { RelationshipSchemaId, UserId } from "#lib/schema/brands";

import { RelationshipSchemasRepository } from "./repository";

export class RelationshipSchemasService extends Effect.Service<RelationshipSchemasService>()(
	"RelationshipSchemasService",
	{
		effect: Effect.gen(function* () {
			const runWithDb = yield* DbRunner;
			const repository = yield* RelationshipSchemasRepository;

			return {
				findBuiltinBySlug: Effect.fn("RelationshipSchemasService.findBuiltinBySlug")(function* (
					slug: string,
				) {
					const found = yield* runWithDb(repository.findBuiltinBySlug(slug));
					if (!found) {
						return yield* notFound("Relationship schema not found");
					}
					return found;
				}),
				findById: Effect.fn("RelationshipSchemasService.findById")(function* (
					id: RelationshipSchemaId,
					userId: UserId | null,
				) {
					const found = yield* runWithDb(repository.findById(id, userId));
					if (!found) {
						return yield* notFound("Relationship schema not found");
					}
					return found;
				}),
			};
		}),
	},
) {}
