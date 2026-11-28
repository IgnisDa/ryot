import type { ScalarExpression } from "@ryot-app/contract/modules/ryotql/authored";
import { and, castDate, conditional, gte, isNull, lt, or } from "@ryot-app/ryotql";
import { dateAdd } from "@ryot-app/ryotql/authoring";

type Bounds = { readonly end: ScalarExpression; readonly start: ScalarExpression };

const earlier = (left: ScalarExpression, right: ScalarExpression) =>
	conditional(lt(castDate(left), castDate(right)), castDate(left), castDate(right));

const later = (left: ScalarExpression, right: ScalarExpression) =>
	conditional(lt(castDate(left), castDate(right)), castDate(right), castDate(left));

const dayPadded = (at: ScalarExpression, start: ScalarExpression, end: ScalarExpression) => [
	gte(at, dateAdd(start, -1, "day")),
	lt(at, dateAdd(end, 1, "day")),
];

/** A row's `at` is in `[start, end)`. */
export const rowSourceDateWindow = (at: ScalarExpression, bounds: Bounds) => [
	gte(at, bounds.start),
	lt(at, bounds.end),
];

/**
 * A row's instant is in its bounds. Its `at` is within a day of the instant, so the window also
 * bounds `at` by a closed range the query can start from.
 */
export const rowSourceInstantWindow = (
	at: ScalarExpression,
	instant: { readonly bounds: Bounds; readonly at: ScalarExpression },
) => [
	...dayPadded(at, castDate(instant.bounds.start), castDate(instant.bounds.end)),
	...rowSourceDateWindow(instant.at, instant.bounds),
];

/**
 * A row's `at` is in `bounds`, or, for a row with an instant, the instant is in its own bounds; a
 * closed `at` range around both windows lets the query start from it.
 */
export const rowSourceTimeWindow = (
	at: ScalarExpression,
	bounds: Bounds,
	instant: null | { readonly bounds: Bounds; readonly at: ScalarExpression },
) =>
	instant === null
		? rowSourceDateWindow(at, bounds)
		: [
				...dayPadded(
					at,
					earlier(bounds.start, instant.bounds.start),
					later(bounds.end, instant.bounds.end),
				),
				or(
					and(isNull(instant.at), ...rowSourceDateWindow(at, bounds)),
					and(...rowSourceDateWindow(instant.at, instant.bounds)),
				),
			];
