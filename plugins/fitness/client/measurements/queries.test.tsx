import { afterEach, expect } from "bun:test";

import { RyotQLResponse } from "@ryot-app/contract/modules/ryotql/language";
import { Effect, Result, Schema } from "@ryot-app/plugin-client-sdk/effect";
import { TimeZone } from "@ryot-app/plugin-client-sdk/plugin";
import { useRyotQuery } from "@ryot-app/plugin-client-sdk/react";
import {
	createTestRyotClock,
	disposePluginBridges,
	mountPluginPage,
	pluginContributor,
	routeLocation,
	savedViewPageContext,
} from "@ryot-app/plugin-client-sdk/testing";
import { recipeResponse, rowsResult } from "@ryot-app/ryotql-recipes/test-utils";
import { assert } from "@ryot-app/testing/assert";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { screen, waitFor } from "@testing-library/dom";
import { it } from "@voila.dev/effect-bun-test";

import { measurementSeriesRecipe } from "../../shared/measurement-recipes";
import { PLUGIN_PACKAGE_ID } from "../../shared/plugin-identity";
import { seriesQuery } from "./queries";

afterEach(disposePluginBridges);

it.live(
	"loads every selected metric across bounded series batches and preserves zero readings",
	() =>
		Effect.gen(function* () {
			const clock = createTestRyotClock();
			const metricIds = ["a", "b", "c", "d", "e"];
			function Probe() {
				const query = useRyotQuery(seriesQuery, {
					metricIds,
					range: "1M",
					timeZone: TimeZone.make("UTC"),
					firstReadings: metricIds.map(() => ({ firstAt: null })),
				});
				return (
					<output aria-label="Series">
						{query.data?.series
							.map((series) => `${series.metricId}:${series.points[0]?.value}`)
							.join(",")}
					</output>
				);
			}
			const page = mountPluginPage(Probe, {
				bootstrap: clock.bootstrap,
				location: routeLocation("/v/measurements"),
				page: {
					...savedViewPageContext({
						settings: {},
						savedViewId: "measurements",
						rendererName: "measurements",
						dataSources: { queries: {} },
						view: { icon: "ruler", name: "Measurements" },
					}),
					contributors: [
						pluginContributor({
							name: "Fitness",
							pluginId: "fitness-owner",
							packageId: PLUGIN_PACKAGE_ID,
						}),
					],
				},
			});
			try {
				yield* Effect.promise(() =>
					waitFor(() => expect(page.queryRequests("averages")).toHaveLength(3)),
				);
				const requested: string[] = [];
				for (const request of page.queryRequests("averages")) {
					const ids = request.request.arguments?.["metricIds"];
					assert(Array.isArray(ids));
					expect(ids.length).toBeLessThanOrEqual(2);
					const selectedIds = ids.map((id) => {
						assert(typeof id === "string");
						return id;
					});
					requested.push(...selectedIds);
					const pageInfo = { limit: 1000, hasMore: false, nextCursor: null };
					const response = recipeResponse(
						measurementSeriesRecipe({ reference: { kind: "self" } }),
						{
							metrics: rowsResult(
								selectedIds.map((id) => ({ id })),
								{ ...pageInfo, limit: 2 },
							),
							averages: {
								pageInfo,
								type: "aggregate",
								items: selectedIds.map((metricId) => ({ metricId, value: 0, at: "2026-01-01" })),
							},
						},
					);
					page.replyQuery(request.requestId, {
						outcome: "success",
						response: Result.getOrThrow(Schema.decodeUnknownResult(RyotQLResponse)(response)),
					});
				}
				expect(requested).toEqual(metricIds);
				yield* Effect.promise(() =>
					waitFor(() =>
						expect(screen.getByLabelText("Series").textContent).toBe("a:0,b:0,c:0,d:0,e:0"),
					),
				);
			} finally {
				page.dispose();
				yield* Effect.promise(() => clock.dispose());
			}
		}),
	testTimeout,
);
