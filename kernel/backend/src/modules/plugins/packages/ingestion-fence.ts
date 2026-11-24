import { sql } from "drizzle-orm";
import { Effect } from "effect";

import type { DatabaseSession } from "#platform/db/session";
import { writeState, type WriteTransaction } from "#platform/db/write-transaction";

export const PLUGIN_INGESTION_ADVISORY_LOCK_KEY = "ryot-plugin-ingestion";

// User-scoped plugins run only for their owner, so one user's plugin changes need to exclude only
// readers of that user's catalog. System-wide changes take the global key exclusively. Keys are
// always taken global first, then users in sorted order, in one statement. A plugin's configuration
// changes take its `plugin-config:` key exclusively. A caller that names its `WriteTransaction` skips
// the shared keys that transaction already holds.
const userKey = (userId: string) => `${PLUGIN_INGESTION_ADVISORY_LOCK_KEY}:user:${userId}`;

export const pluginConfigLockKey = (pluginId: string) => `plugin-config:${pluginId}`;

const heldShared = writeState((_: WriteTransaction) => new Set<string>());

const lockShared = (
	session: DatabaseSession["Service"],
	ordered: ReadonlyArray<string>,
	transaction?: WriteTransaction,
) => {
	const held = transaction ? heldShared(transaction) : new Set<string>();
	const keys = ordered.filter((key) => !held.has(key));
	if (keys.length === 0) {
		return Effect.void;
	}
	return session
		.run((db) =>
			db.execute(
				sql`select pg_advisory_xact_lock_shared(hashtext(k)) from unnest(array[${sql.join(
					keys.map((key) => sql`${key}`),
					sql`, `,
				)}]::text[]) with ordinality t(k, n) order by n`,
			),
		)
		.pipe(
			Effect.tap(() =>
				Effect.sync(() => {
					for (const key of keys) {
						held.add(key);
					}
				}),
			),
			Effect.asVoid,
		);
};

export const lockPluginIngestionShared = (
	session: DatabaseSession["Service"],
	userIds: ReadonlyArray<string>,
	transaction?: WriteTransaction,
) =>
	lockShared(
		session,
		[PLUGIN_INGESTION_ADVISORY_LOCK_KEY, ...[...new Set(userIds)].sort().map(userKey)],
		transaction,
	);

/** Takes the plugins' configuration keys shared, in the caller's order. */
export const lockPluginConfigShared = (
	session: DatabaseSession["Service"],
	pluginIds: ReadonlyArray<string>,
	transaction?: WriteTransaction,
) => lockShared(session, [...new Set(pluginIds)].map(pluginConfigLockKey), transaction);

export const lockPluginIngestionForUser = (session: DatabaseSession["Service"], userId: string) =>
	session
		.run((db) =>
			db.execute(
				sql`select case when n = 1 then pg_advisory_xact_lock_shared(hashtext(k)) else pg_advisory_xact_lock(hashtext(k)) end from unnest(array[${PLUGIN_INGESTION_ADVISORY_LOCK_KEY}, ${userKey(userId)}]::text[]) with ordinality t(k, n) order by n`,
			),
		)
		.pipe(Effect.asVoid);
