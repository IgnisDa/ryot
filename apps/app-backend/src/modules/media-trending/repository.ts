import { EntitySchemaId, SandboxScriptId } from "@ryot/contract/schema/brands";
import { inArray, isNull, eq, and, asc } from "drizzle-orm";
import { Effect } from "effect";

import { builtinMediaEntitySchemaSlugs } from "#lib/builtins/media-schema-slugs";
import * as schema from "#lib/db/schema/tables/combined";
import { CurrentDb, dbEffect } from "#lib/db/service";

import type { TrendingProviderTarget } from "./schemas";

export class MediaTrendingRepository extends Effect.Service<MediaTrendingRepository>()(
	"MediaTrendingRepository",
	{
		sync: () => {
			const listProviderTargets = Effect.fn("MediaTrendingRepository.listProviderTargets")(
				function* () {
					const db = yield* CurrentDb;
					const rows = yield* dbEffect(() =>
						db
							.select({
								scriptId: schema.sandboxScript.id,
								scriptSlug: schema.sandboxScript.slug,
								entitySchemaId: schema.entitySchema.id,
								entitySchemaSlug: schema.entitySchema.slug,
							})
							.from(schema.entitySchemaScript)
							.innerJoin(
								schema.entitySchema,
								eq(schema.entitySchema.id, schema.entitySchemaScript.entitySchemaId),
							)
							.innerJoin(
								schema.sandboxScript,
								eq(schema.sandboxScript.id, schema.entitySchemaScript.sandboxScriptId),
							)
							.where(
								and(
									isNull(schema.entitySchema.userId),
									isNull(schema.sandboxScript.userId),
									eq(schema.entitySchema.isBuiltin, true),
									eq(schema.sandboxScript.isBuiltin, true),
									inArray(schema.entitySchema.slug, [...builtinMediaEntitySchemaSlugs]),
								),
							)
							.orderBy(asc(schema.entitySchema.slug), asc(schema.sandboxScript.slug)),
					);

					return rows.map(
						(row): TrendingProviderTarget => ({
							scriptSlug: row.scriptSlug,
							entitySchemaSlug: row.entitySchemaSlug,
							scriptId: SandboxScriptId.make(row.scriptId),
							entitySchemaId: EntitySchemaId.make(row.entitySchemaId),
						}),
					);
				},
			);

			return { listProviderTargets };
		},
	},
) {}
