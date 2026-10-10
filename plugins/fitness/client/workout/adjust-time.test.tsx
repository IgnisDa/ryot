import { afterEach, assert, expect, it } from "@effect/vitest";
import { Effect } from "@ryot-app/plugin-client-sdk/effect";
import { PluginId } from "@ryot-app/plugin-client-sdk/plugin";
import { PluginScreenFrame } from "@ryot-app/plugin-client-sdk/screen";
import {
	disposePluginBridges,
	mountPluginPage,
	pluginContributor,
	routeLocation,
} from "@ryot-app/plugin-client-sdk/testing";
import { fireEvent, screen, waitFor } from "@testing-library/dom";
import { act } from "react";

import { PLUGIN_PACKAGE_ID } from "../../shared/plugin-identity";
import { AdjustWorkoutTime } from "./adjust-time";

afterEach(disposePluginBridges);

it.live(
	"preserves unchanged timestamp precision and active duration across a lost-response retry",
	() =>
		Effect.gen(function* () {
			const pluginId = PluginId.make("fitness");
			let closed = 0;
			const page = mountPluginPage(
				() => (
					<PluginScreenFrame title="Workout">
						<AdjustWorkoutTime
							entityId="workout"
							onClose={() => {
								closed += 1;
							}}
						/>
					</PluginScreenFrame>
				),
				{
					location: routeLocation("/"),
					page: {
						view: null,
						settings: {},
						dataSources: null,
						route: { params: {} },
						renderer: { pluginId, kind: "plugin", exportName: "workout-detail" },
						target: { path: "/", search: "", kind: "plugin-route", packageId: PLUGIN_PACKAGE_ID },
						contributors: [
							pluginContributor({ pluginId, name: "Fitness", packageId: PLUGIN_PACKAGE_ID }),
						],
					},
				},
			);
			const request = yield* Effect.promise(() =>
				waitFor(() => {
					const query = page.queryRequests()[0];
					assert(query);
					return query;
				}),
			);
			page.replyQuery(request.requestId, {
				outcome: "success",
				response: {
					data: {
						entity: {
							type: "rows",
							pageInfo: { limit: 1, hasMore: false, nextCursor: null },
							items: [
								{
									id: "workout",
									name: "Saved workout",
									updatedAt: "2026-10-16T12:00:00.000Z",
									properties: {
										activeDuration: 3000,
										endedAt: "2026-10-16T11:00:38.789Z",
										startedAt: "2026-10-16T10:00:37.456Z",
									},
								},
							],
						},
					},
				},
			});
			yield* Effect.promise(() =>
				waitFor(() =>
					expect(screen.getByRole("button", { name: "Save time correction" })).toBeTruthy(),
				),
			);
			act(() => {
				fireEvent.click(screen.getByRole("button", { name: "Save time correction" }));
			});
			const first = yield* Effect.promise(() =>
				waitFor(() => {
					const operation = page.clientMessages().find(({ type }) => type === "operation-request");
					assert(operation?.type === "operation-request");
					return operation;
				}),
			);
			expect(first.input).toMatchObject({
				entityId: "workout",
				endedAt: "2026-10-16T11:00:38.789Z",
				activeDuration: { kind: "preserve" },
				startedAt: "2026-10-16T10:00:37.456Z",
			});
			page.send({
				outcome: "failure",
				reason: "transport",
				type: "operation-result",
				requestId: first.requestId,
			});
			yield* Effect.promise(() =>
				waitFor(() =>
					expect(screen.getByRole("button", { name: "Retry correction" })).toBeTruthy(),
				),
			);
			expect(screen.getByLabelText("Start time").closest("fieldset")?.disabled).toBe(true);
			act(() => {
				fireEvent.click(screen.getByRole("button", { name: "Retry correction" }));
			});
			const retry = yield* Effect.promise(() =>
				waitFor(() => {
					const operation = page
						.clientMessages()
						.filter(({ type }) => type === "operation-request")[1];
					assert(operation?.type === "operation-request");
					return operation;
				}),
			);
			expect(retry.input).toEqual(first.input);
			page.send({
				outcome: "success",
				type: "operation-result",
				requestId: retry.requestId,
				value: { kind: "saved", entityId: "workout" },
			});
			yield* Effect.promise(() => waitFor(() => expect(closed).toBe(1)));
		}),
);
