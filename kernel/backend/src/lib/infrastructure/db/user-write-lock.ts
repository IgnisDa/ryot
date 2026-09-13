import type { UserId } from "@ryot-app/contract/schema/brands";
import { sql } from "drizzle-orm";
import { Effect } from "effect";

import { DatabaseSession } from "./session";

export const acquireUserWriteLock = Effect.fn("acquireUserWriteLock")(function* (userId: UserId) {
	const session = yield* DatabaseSession;
	yield* session.run((database) =>
		database.execute(sql`select pg_advisory_xact_lock(hashtext(${`user-write:${userId}`}))`),
	);
});
