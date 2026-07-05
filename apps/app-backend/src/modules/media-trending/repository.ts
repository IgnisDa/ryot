import { EntitySchemaSlug, SandboxScriptId } from "@ryot/contract/schema/brands";
import { inArray, isNull, eq, and, asc } from "drizzle-orm";
import { Effect } from "effect";

import * as schema from "#lib/infrastructure/db/schema/tables/combined";
import { CurrentDb, dbEffect } from "#lib/infrastructure/db/service";
import { builtinMediaEntitySchemaSlugs } from "#modules/builtins/media-schema-slugs";

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
								entitySchemaSlug: schema.entitySchemaSandboxScript.entitySchemaSlug,
							})
							.from(schema.entitySchemaSandboxScript)
							.innerJoin(
								schema.sandboxScript,
								eq(schema.sandboxScript.id, schema.entitySchemaSandboxScript.sandboxScriptId),
							)
							.where(
								and(
									isNull(schema.sandboxScript.userId),
									eq(schema.sandboxScript.isBuiltin, true),
									inArray(schema.entitySchemaSandboxScript.entitySchemaSlug, [
										...builtinMediaEntitySchemaSlugs,
									]),
								),
							)
							.orderBy(
								asc(schema.entitySchemaSandboxScript.entitySchemaSlug),
								asc(schema.sandboxScript.slug),
							),
					);

					return rows.map(
						(row): TrendingProviderTarget => ({
							scriptSlug: row.scriptSlug,
							scriptId: SandboxScriptId.make(row.scriptId),
							entitySchemaSlug: EntitySchemaSlug.make(row.entitySchemaSlug),
						}),
					);
				},
			);

			return { listProviderTargets };
		},
	},
) {}
