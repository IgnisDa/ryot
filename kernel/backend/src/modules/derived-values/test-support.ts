import { Effect } from "effect";

import { Folds } from "./service";

/** Runs event writes without folding, for tests whose subjects declare no fold. */
export const unfoldedFolds = Folds.of({
	failed: () => Effect.void,
	rebuild: () => Effect.void,
	queue: () => Effect.succeed([]),
	fold: () => Effect.succeed(false),
});
