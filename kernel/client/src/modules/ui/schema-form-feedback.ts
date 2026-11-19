import { Effect } from "effect";

import { selectionHaptic } from "#/modules/device/haptics";

export const schemaFormReorderFeedback = () => {
	void Effect.runPromise(selectionHaptic);
};
