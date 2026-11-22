import { Effect } from "effect";

import { Folds } from "./service";

/** Runs event work without folding, for tests whose subjects declare no fold. */
export const unfoldedFolds = Folds.of({
	queue: () => Effect.void,
	settle: () => Effect.void,
	failed: () => Effect.void,
	rebuild: () => Effect.void,
	runQueued: () => Effect.succeed([]),
	commitQueued: () => Effect.succeed([]),
	prepareQueued: () => Effect.succeed([]),
});
