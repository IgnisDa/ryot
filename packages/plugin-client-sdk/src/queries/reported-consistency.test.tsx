import { afterEach, expect } from "bun:test";

import type { ReportingSelection } from "@ryot-app/contract/modules/analytics/reporting";
import type { ExecutionRequest } from "@ryot-app/contract/modules/ryotql/request";
import { TimeZone } from "@ryot-app/contract/schema/time-zone";
import { column, defineRecipe, selectedField, selectedRows, table } from "@ryot-app/ryotql";
import {
	reportingArguments,
	reportingParameterFields,
} from "@ryot-app/ryotql-recipes/reporting-parameters";
import { rowsResponse } from "@ryot-app/ryotql-recipes/test-utils";
import { waitFor } from "@testing-library/dom";
import { it } from "@voila.dev/effect-bun-test";
import { Effect, Schema } from "effect";
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";

import { createTestRyotClock } from "../testing";
import { useRyotQuery } from "./hooks";
import { RyotProvider } from "./provider";
import { createConsistencyQuery } from "./reported";

const entry = table("entity", "entry");
const recipe = defineRecipe({
	parameters: { fields: reportingParameterFields },
	queries: {
		entries: selectedRows(entry, {
			selection: { id: selectedField(column(entry, "id"), Schema.String) },
		}),
	},
});
const query = createConsistencyQuery<
	{ readonly timeZone: TimeZone; readonly selection: ReportingSelection },
	{ readonly items: readonly { readonly id: string }[] }
>((context) =>
	context.query(
		recipe,
		{ ...reportingArguments(context.selection), consistency: true },
		undefined,
		(data) => ({ items: data.entries.items }),
	),
);
const roots: Root[] = [];
const clocks: ReturnType<typeof createTestRyotClock>[] = [];
afterEach(() =>
	Effect.runPromise(
		Effect.gen(function* () {
			for (const root of roots.splice(0)) {
				act(() => root.unmount());
			}
			for (const clock of clocks.splice(0)) {
				yield* Effect.promise(() => clock.dispose());
			}
			document.body.innerHTML = "";
		}),
	),
);
function Probe({
	selection,
	recordSelection,
}: {
	readonly selection: ReportingSelection;
	readonly recordSelection: (value: ReportingSelection) => void;
}) {
	const result = useRyotQuery(query, { selection, timeZone: TimeZone.make("America/New_York") });
	useEffect(() => {
		if (result.data !== undefined) {
			recordSelection(result.data.reporting.selection);
		}
	}, [recordSelection, result.data]);
	return <span aria-label="Status">{result.isSuccess ? "ready" : "waiting"}</span>;
}

it.live(
	"keeps recorded consistency execution arguments stable across different client clocks",
	() =>
		Effect.gen(function* () {
			for (const selection of [
				{
					grouping: "auto",
					comparison: "previous-period",
					range: { offset: -1, unit: "month", kind: "calendar" },
				},
				{ grouping: "year", range: { kind: "all-time" }, comparison: "previous-period" },
			] as const) {
				const requests: ExecutionRequest[] = [];
				const recordedSelections: ReportingSelection[] = [];
				for (const now of ["2026-03-15T12:00:00Z", "2026-11-02T18:00:00Z"]) {
					const clock = createTestRyotClock({
						query: (request) =>
							Effect.sync(() => {
								requests.push(request);
								return {
									...rowsResponse("entries", [], { limit: 20, hasMore: false, nextCursor: null }),
									execution: {
										now: Date.parse("2026-11-03T12:00:00Z"),
										timeZone: TimeZone.make("America/New_York"),
									},
								};
							}),
					});
					clocks.push(clock);
					yield* Effect.promise(() => clock.setTime(Date.parse(now)));
					const container = document.createElement("div");
					document.body.append(container);
					const root = createRoot(container);
					roots.push(root);
					act(() =>
						root.render(
							<RyotProvider runtime={clock.runtime}>
								<Probe
									selection={selection}
									recordSelection={(value) => recordedSelections.push(value)}
								/>
							</RyotProvider>,
						),
					);
					yield* Effect.promise(() =>
						waitFor(() =>
							expect(container.querySelector('[aria-label="Status"]')?.textContent).toBe("ready"),
						),
					);
					expect(recordedSelections.at(-1)).toEqual({
						grouping: "day",
						comparison: "none",
						range:
							selection.range.kind === "all-time"
								? { kind: "custom", endDate: "2026-11-03", startDate: "2025-11-03" }
								: { kind: "custom", endDate: "2026-10-31", startDate: "2026-10-01" },
					});
				}
				expect(recordedSelections[0]).toEqual(recordedSelections[1]);
				expect(requests).toHaveLength(2);
				expect(requests[0]?.arguments).toEqual({
					...reportingArguments(selection),
					consistency: true,
				});
				expect(requests[1]?.arguments).toEqual(requests[0]?.arguments);
				expect(requests[1]?.source).toEqual(requests[0]?.source);
			}
		}),
);
