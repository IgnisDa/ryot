import type { ScalarExpression } from "@ryot-app/contract/modules/ryotql/authored";
import { and, gte, isNull, lt, or } from "@ryot-app/ryotql";

type Bounds = { readonly end: ScalarExpression; readonly start: ScalarExpression };

export const rowSourceTimeWindow = (
	at: ScalarExpression,
	bounds: Bounds,
	instant: null | { readonly bounds: Bounds; readonly at: ScalarExpression },
) => {
	const match = [gte(at, bounds.start), lt(at, bounds.end)];
	return instant === null
		? match
		: [
				or(
					and(isNull(instant.at), ...match),
					and(gte(instant.at, instant.bounds.start), lt(instant.at, instant.bounds.end)),
				),
			];
};
