import { DbError } from "@ryot-app/contract/errors";
import { Effect } from "effect";

import type { DatabaseSession } from "#platform/db/session";
import { runRootTransaction } from "#platform/db/transaction";

export const eventRootTransaction =
	(session: DatabaseSession["Service"], message: string) =>
	<A, E, R>(work: Effect.Effect<A, E, R>) =>
		runRootTransaction(session, work).pipe(
			Effect.catchTag("DatabaseSessionStateError", () => Effect.fail(new DbError({ message }))),
		);
