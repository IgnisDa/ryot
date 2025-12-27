import { Effect } from "effect";

import { DbRunner } from "#lib/db";
import { notFound } from "#lib/errors";

import { RelationshipSchemasRepository } from "./repository";

export class RelationshipSchemasService extends Effect.Service<RelationshipSchemasService>()(
	"RelationshipSchemasService",
	{
		effect: Effect.gen(function* () {
			const runWithDb = yield* DbRunner;
			const repository = yield* RelationshipSchemasRepository;

			return {
				findBuiltinBySlug: (slug: string) =>
					Effect.gen(function* () {
						const found = yield* runWithDb(repository.findBuiltinBySlug(slug));
						if (!found) {
							return yield* notFound("Relationship schema not found");
						}
						return found;
					}),
				findById: (id: string, userId: string | null) =>
					Effect.gen(function* () {
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
