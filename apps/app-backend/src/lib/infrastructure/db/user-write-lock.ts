import type { UserId } from "@ryot/contract/schema/brands";
import { sql } from "drizzle-orm";
import { Effect } from "effect";

import { Database, mapDatabaseErrors } from "./service";

export const acquireUserWriteLock = Effect.fn("acquireUserWriteLock")(function* (userId: UserId) {
	const database = yield* Database;
	yield* mapDatabaseErrors(
		database.execute(sql`select pg_advisory_xact_lock(hashtext(${`user-write:${userId}`}))`),
	);
});
