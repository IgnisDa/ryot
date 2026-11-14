import { Effect } from "effect";

import { Folds } from "./service";

/** Runs event work without folding, for tests whose subjects declare no fold. */
export const unfoldedFolds = Folds.of({
	within: (work) => work,
	failed: () => Effect.void,
	rebuild: () => Effect.void,
	reserve: () => Effect.succeed(null),
});
