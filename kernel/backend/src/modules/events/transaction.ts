import { DbError } from "@ryot-app/contract/errors";
import { Effect } from "effect";

import { DatabaseSessionStateError, type DatabaseSession } from "#lib/infrastructure/db/session";
import { runRootTransaction } from "#lib/infrastructure/db/transaction";

export const eventRootTransaction =
	(session: DatabaseSession["Service"], message: string) =>
	<A, E, R>(work: Effect.Effect<A, E, R>) =>
		runRootTransaction(session, work).pipe(
			Effect.mapError((error) =>
				error instanceof DatabaseSessionStateError ? new DbError({ message }) : error,
			),
		);
