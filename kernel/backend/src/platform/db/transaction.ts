import type { Effect } from "effect";

import { retryOnDeadlock } from "./errors";
import type { DatabaseSession } from "./session";

export const runRootTransaction = <A, E, R>(
	session: DatabaseSession["Service"],
	work: Effect.Effect<A, E, R>,
) => retryOnDeadlock(session.transaction(work));
