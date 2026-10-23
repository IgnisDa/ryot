import { afterEach, assert, beforeEach, describe, expect, it } from "@effect/vitest";
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

const openWorkout = (
	properties: {
		readonly startedAt: string;
		readonly endedAt?: string;
		readonly activeDuration?: number;
	},
	onClose: () => void,
) =>
	Effect.gen(function* () {
		const pluginId = PluginId.make("fitness");
		const page = mountPluginPage(
			() => (
				<PluginScreenFrame title="Workout">
					<AdjustWorkoutTime onClose={onClose} entityId="workout" />
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
								properties,
								id: "workout",
								name: "Saved workout",
								updatedAt: "2026-10-16T12:00:00.000Z",
							},
						],
					},
				},
			},
		});
		return page;
	});

it.live(
	"preserves unchanged timestamp precision and active duration across a lost-response retry",
	() =>
		Effect.gen(function* () {
			let closed = 0;
			const page = yield* openWorkout(
				{
					activeDuration: 3000,
					endedAt: "2026-10-16T11:00:38.789Z",
					startedAt: "2026-10-16T10:00:37.456Z",
				},
				() => {
					closed += 1;
				},
			);
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

describe("DST workout time corrections", () => {
	let previousZone: string | undefined;

	beforeEach(() => {
		previousZone = process.env["TZ"];
		process.env["TZ"] = "America/New_York";
	});

	afterEach(() => {
		if (previousZone === undefined) {
			delete process.env["TZ"];
		} else {
			process.env["TZ"] = previousZone;
		}
	});

	it.live("preserves the second occurrence and unchanged timestamp precision", () =>
		Effect.gen(function* () {
			const page = yield* openWorkout(
				{
					activeDuration: 3000,
					endedAt: "2026-11-01T07:30:38.789Z",
					startedAt: "2026-11-01T06:30:37.456Z",
				},
				() => undefined,
			);
			const startTime = yield* Effect.promise(() =>
				waitFor(() => screen.getByLabelText("Start time")),
			);
			act(() => {
				fireEvent.change(startTime, { target: { value: "2026-11-01T01:45" } });
			});
			act(() => {
				fireEvent.click(screen.getByRole("button", { name: "Save time correction" }));
			});
			const operation = yield* Effect.promise(() =>
				waitFor(() => {
					const request = page.clientMessages().find(({ type }) => type === "operation-request");
					assert(request?.type === "operation-request");
					return request;
				}),
			);
			expect(operation.input).toMatchObject({
				endedAt: "2026-11-01T07:30:38.789Z",
				activeDuration: { kind: "preserve" },
				startedAt: "2026-11-01T06:45:00.000Z",
			});
		}),
	);

	it.live("rejects a nonexistent local date and time", () =>
		Effect.gen(function* () {
			const page = yield* openWorkout(
				{ endedAt: "2026-03-07T08:30:00.000Z", startedAt: "2026-03-07T07:30:00.000Z" },
				() => undefined,
			);
			const startTime = yield* Effect.promise(() =>
				waitFor(() => screen.getByLabelText("Start time")),
			);
			act(() => {
				fireEvent.change(startTime, { target: { value: "2026-03-08T02:30" } });
			});
			act(() => {
				fireEvent.click(screen.getByRole("button", { name: "Save time correction" }));
			});
			expect(page.clientMessages().filter(({ type }) => type === "operation-request")).toEqual([]);
			expect(
				screen.getByText("This local date and time does not exist. Choose another time."),
			).toBeTruthy();
		}),
	);

	it.live("requires an occurrence choice for a repeated local time", () =>
		Effect.gen(function* () {
			const page = yield* openWorkout(
				{ endedAt: "2026-11-01T07:30:00.000Z", startedAt: "2026-10-31T05:30:00.000Z" },
				() => undefined,
			);
			const startTime = yield* Effect.promise(() =>
				waitFor(() => screen.getByLabelText("Start time")),
			);
			act(() => {
				fireEvent.change(startTime, { target: { value: "2026-11-01T01:30" } });
			});
			act(() => {
				fireEvent.click(screen.getByRole("button", { name: "Save time correction" }));
			});
			expect(page.clientMessages().filter(({ type }) => type === "operation-request")).toEqual([]);
			expect(screen.getByText("This local time occurs twice. Choose an occurrence.")).toBeTruthy();
			act(() => {
				fireEvent.click(
					screen.getByRole("button", { name: "Start time occurrence: Choose an occurrence" }),
				);
			});
			act(() => {
				fireEvent.click(screen.getByRole("radio", { name: "Second occurrence (UTC-05:00)" }));
			});
			act(() => {
				fireEvent.click(screen.getByRole("button", { name: "Save time correction" }));
			});
			const operation = yield* Effect.promise(() =>
				waitFor(() => {
					const request = page.clientMessages().find(({ type }) => type === "operation-request");
					assert(request?.type === "operation-request");
					return request;
				}),
			);
			expect(operation.input).toMatchObject({ startedAt: "2026-11-01T06:30:00.000Z" });
		}),
	);
});
