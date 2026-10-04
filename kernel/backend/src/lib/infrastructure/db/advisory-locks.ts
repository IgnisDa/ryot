import { sql } from "drizzle-orm";
import { Effect } from "effect";

import type { DatabaseSession } from "./session";

export const PLUGIN_INGESTION_ADVISORY_LOCK_KEY = "ryot-plugin-ingestion";

export const lockPluginIngestionShared = (session: DatabaseSession["Service"]) =>
	session
		.run((db) =>
			db.execute(
				sql`select pg_advisory_xact_lock_shared(hashtext(${PLUGIN_INGESTION_ADVISORY_LOCK_KEY}))`,
			),
		)
		.pipe(Effect.asVoid);
