import { sql } from "drizzle-orm";
import { Effect } from "effect";

import type { DatabaseSession } from "#platform/db/session";

export const PLUGIN_INGESTION_ADVISORY_LOCK_KEY = "ryot-plugin-ingestion";

// User-scoped plugins run only for their owner, so one user's plugin changes need to exclude only
// readers of that user's catalog. System-wide changes take the global key exclusively. Keys are
// always taken global first, then users in sorted order, in one statement.
const userKey = (userId: string) => `${PLUGIN_INGESTION_ADVISORY_LOCK_KEY}:user:${userId}`;

export const lockPluginIngestionShared = (
	session: DatabaseSession["Service"],
	userIds: ReadonlyArray<string>,
) =>
	session
		.run((db) =>
			db.execute(
				sql`select pg_advisory_xact_lock_shared(hashtext(k)) from unnest(array[${sql.join(
					[PLUGIN_INGESTION_ADVISORY_LOCK_KEY, ...[...new Set(userIds)].sort().map(userKey)].map(
						(key) => sql`${key}`,
					),
					sql`, `,
				)}]::text[]) with ordinality t(k, n) order by n`,
			),
		)
		.pipe(Effect.asVoid);

export const lockPluginIngestionForUser = (session: DatabaseSession["Service"], userId: string) =>
	session
		.run((db) =>
			db.execute(
				sql`select case when n = 1 then pg_advisory_xact_lock_shared(hashtext(k)) else pg_advisory_xact_lock(hashtext(k)) end from unnest(array[${PLUGIN_INGESTION_ADVISORY_LOCK_KEY}, ${userKey(userId)}]::text[]) with ordinality t(k, n) order by n`,
			),
		)
		.pipe(Effect.asVoid);
