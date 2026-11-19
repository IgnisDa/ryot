import { expect, it } from "bun:test";

import { bindArguments } from "@ryot-app/contract/modules/ryotql/parameters";
import { Result } from "effect";

import { reportingArguments, reportingParameters } from "./reporting-parameters";

const bind = (input: Readonly<Record<string, unknown>>) =>
	Result.getOrThrow(bindArguments(reportingParameters.schema, input));

it("binds each range preset to the offsets it implies, ignoring supplied offsets", () => {
	expect(
		bind({
			...reportingArguments({
				grouping: "auto",
				comparison: "previous-period",
				range: { days: 90, kind: "rolling" },
			}),
			startOffsetDays: -364,
		}),
	).toMatchObject({
		endOffsetDays: 1,
		range: "rolling-90",
		rangeKind: "rolling",
		startOffsetDays: -89,
		previousEndOffsetDays: -89,
		previousStartOffsetDays: -179,
	});
	expect(bind({ rangeKind: "year", range: "previous-month" })).toMatchObject({
		rangeKind: "month",
		calendarEndOffset: 0,
		calendarStartOffset: -1,
		previousCalendarEndOffset: -1,
		previousCalendarStartOffset: -2,
	});
	expect(bind({})).toMatchObject({ range: "rolling-30", startOffsetDays: -29 });
});
