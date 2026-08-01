import { Effect } from "effect";

import type { ApiScope } from "@/api/request-key";
import { reorderSavedViews, updateSavedView } from "@/api/saved-views";

import type { CustomizePlan } from "./customize-plan";

export const runCustomizePlan = (props: { scope: ApiScope; plan: CustomizePlan }) =>
	Effect.gen(function* () {
		for (const update of props.plan.updates) {
			yield* updateSavedView(props.scope, update.viewSlug, update.payload);
		}
		for (const reorder of props.plan.reorders) {
			yield* reorderSavedViews(props.scope, reorder.payload);
		}
	});
