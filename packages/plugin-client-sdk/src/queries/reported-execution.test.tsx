import { afterEach, expect } from "bun:test";

import {
	calendarBuckets,
	type ReportingSelection,
} from "@ryot-app/contract/modules/analytics/reporting";
import type { ExecutionRequest } from "@ryot-app/contract/modules/ryotql/request";
import { TimeZone } from "@ryot-app/contract/schema/time-zone";
import { column, defineRecipe, selectedField, selectedRows, table } from "@ryot-app/ryotql";
import {
	reportingArguments,
	reportingParameterFields,
} from "@ryot-app/ryotql-recipes/reporting-parameters";
import { screen } from "@testing-library/dom";
import { it } from "@voila.dev/effect-bun-test";
import { Effect, Schema } from "effect";

import { periodCaption } from "../analytics/reporting";
import {
	createTestRyotClock,
	disposePluginBridges,
	mountPluginPage,
	routeLocation,
} from "../testing";
import { useRyotQuery } from "./hooks";
import { createReportedQuery } from "./reported";

const entry = table("event", "entry");
const recipe = defineRecipe({
	parameters: { fields: reportingParameterFields },
	queries: {
		points: selectedRows(entry, {
			selection: { at: selectedField(column(entry, "occurredAt"), Schema.String) },
		}),
	},
});
const query = createReportedQuery<
	{ readonly timeZone: TimeZone; readonly selection: ReportingSelection },
	{ readonly points: readonly { readonly at: string }[] }
>(({ selection, query: read }) =>
	read(recipe, reportingArguments(selection), undefined, (data) => ({ points: data.points.items })),
);
const clocks: ReturnType<typeof createTestRyotClock>[] = [];
afterEach(() =>
	Effect.runPromise(
		Effect.gen(function* () {
			disposePluginBridges();
			for (const clock of clocks.splice(0)) {
				yield* Effect.promise(() => clock.dispose());
			}
		}),
	),
);

function FailureProbe() {
	const result = useRyotQuery(query, {
		timeZone: TimeZone.make("UTC"),
		selection: { grouping: "auto", comparison: "none", range: { kind: "all-time" } },
	});
	return <output>{result.isError ? "Execution unavailable" : "Waiting"}</output>;
}

it.live(
	"uses the execution clock and account zone for captions and buckets while keeping rolling requests stable",
	() =>
		Effect.gen(function* () {
			const selection = {
				grouping: "day",
				comparison: "none",
				range: { days: 7, kind: "rolling" },
			} as const;
			const requests: ExecutionRequest[] = [];
			for (const now of ["2026-03-07T01:00:00Z", "2026-03-08T23:00:00Z"]) {
				const clock = createTestRyotClock();
				clocks.push(clock);
				yield* Effect.promise(() => clock.setTime(Date.parse(now)));
				function Probe() {
					const result = useRyotQuery(query, {
						selection,
						timeZone: TimeZone.make("America/Los_Angeles"),
					});
					const data = result.data;
					if (data === undefined) {
						return <span>Loading</span>;
					}
					const resolved = data.reporting.resolved;
					const buckets = calendarBuckets(data.points, {
						at: (point) => point.at,
						period: resolved.current,
						timeZone: resolved.timeZone,
						grouping: resolved.grouping,
					});
					return (
						<>
							<output>{periodCaption(resolved.current)}</output>
							<output>{buckets.flatMap((bucket) => bucket.points).length} observations</output>
						</>
					);
				}
				const page = mountPluginPage(Probe, {
					bootstrap: clock.bootstrap,
					location: routeLocation("/"),
					onClientMessage: (message) => {
						if (message.type !== "ryotql-request" || message.action !== "execute") {
							return;
						}
						requests.push(message.request);
						page.replyQuery(message.requestId, {
							outcome: "success",
							response: {
								execution: {
									timeZone: TimeZone.make("Asia/Tokyo"),
									now: Date.parse("2026-03-08T12:00:00Z"),
								},
								data: {
									points: {
										type: "rows",
										items: [{ at: "2026-03-08T01:00:00Z" }],
										pageInfo: { limit: 20, hasMore: false, nextCursor: null },
									},
								},
							},
						});
					},
				});
				yield* Effect.promise(() => screen.findByText("Mar 2 – 8, 2026"));
				expect(screen.getByText("1 observations")).toBeTruthy();
				page.dispose();
			}
			expect(requests).toHaveLength(2);
			expect(requests[0]?.arguments).toEqual(reportingArguments(selection));
			expect(requests[1]?.arguments).toEqual(requests[0]?.arguments);
		}),
	10000,
);

it.live(
	"fails reporting when execution metadata is absent instead of deriving dates locally",
	() =>
		Effect.gen(function* () {
			const clock = createTestRyotClock();
			clocks.push(clock);

			const page = mountPluginPage(FailureProbe, {
				bootstrap: clock.bootstrap,
				location: routeLocation("/"),
				onClientMessage: (message) => {
					if (message.type !== "ryotql-request" || message.action !== "execute") {
						return;
					}
					page.replyQuery(message.requestId, {
						outcome: "success",
						response: {
							data: {
								points: {
									items: [],
									type: "rows",
									pageInfo: { limit: 20, hasMore: false, nextCursor: null },
								},
							},
						},
					});
				},
			});
			yield* Effect.promise(() => screen.findByText("Execution unavailable"));
		}),
	10000,
);
