import { expect, layer } from "@effect/vitest";
import { builtinSavedViewId, definitionOwner } from "@ryot-app/contract/modules/plugins/references";
import { sql } from "drizzle-orm";
import { Effect } from "effect";

import { builtinSavedViewIdSql } from "#lib/infrastructure/db/schema/tables/views";
import { DatabaseSession } from "#lib/infrastructure/db/session";
import { isolatedDatabaseLayer } from "#lib/test-utils/isolated-database";

layer(isolatedDatabaseLayer("saved_view_identity"))((test) => {
	test.effect("matches SQL and TypeScript owner-qualified length framing", () =>
		Effect.gen(function* () {
			const session = yield* DatabaseSession;
			for (const [userId, pluginId, slug] of [
				["user:1", null, "all"],
				["user:1", "owner:one", "all"],
				["user:1", "owner:two", "all"],
				["user😀", "owner😀", "view😀:all"],
			] as const) {
				const [row] = yield* session.run((db) =>
					db
						.select({
							id: builtinSavedViewIdSql(
								sql`${userId}::text`,
								sql`${pluginId}::text`,
								sql`${slug}::text`,
							),
						})
						.from(sql`(select 1) identity_input`),
				);
				expect(row?.id).toBe(builtinSavedViewId(userId, definitionOwner(pluginId), slug));
			}
		}),
	);
});
