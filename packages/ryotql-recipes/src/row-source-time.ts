import type { ScalarExpression } from "@ryot-app/contract/modules/ryotql/authored";
import { and, castDate, conditional, gte, isNull, lt, or } from "@ryot-app/ryotql";
import { dateAdd } from "@ryot-app/ryotql/authoring";

type Bounds = { readonly end: ScalarExpression; readonly start: ScalarExpression };

const earlier = (left: ScalarExpression, right: ScalarExpression) =>
	conditional(lt(castDate(left), castDate(right)), castDate(left), castDate(right));

const later = (left: ScalarExpression, right: ScalarExpression) =>
	conditional(lt(castDate(left), castDate(right)), castDate(right), castDate(left));

/**
 * A row's `at` is within a day of its instant when it has one, so a timed source is also bounded
 * by a closed `at` range around both windows. Its query can then start from that range.
 */
export const rowSourceTimeWindow = (
	at: ScalarExpression,
	bounds: Bounds,
	instant: null | { readonly bounds: Bounds; readonly at: ScalarExpression },
) => {
	const match = [gte(at, bounds.start), lt(at, bounds.end)];
	return instant === null
		? match
		: [
				gte(at, dateAdd(earlier(bounds.start, instant.bounds.start), -1, "day")),
				lt(at, dateAdd(later(bounds.end, instant.bounds.end), 1, "day")),
				or(
					and(isNull(instant.at), ...match),
					and(gte(instant.at, instant.bounds.start), lt(instant.at, instant.bounds.end)),
				),
			];
};
