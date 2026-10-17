import { afterEach, expect, it } from "@effect/vitest";
import type { ClientPageContext } from "@ryot-app/plugin-client-contract";
import { Effect } from "@ryot-app/plugin-client-sdk/effect";
import { EntitySchemaSlug, PluginId } from "@ryot-app/plugin-client-sdk/plugin";
import {
	disposePluginBridges,
	entityLocation,
	mountPluginPage,
	pluginContributor,
} from "@ryot-app/plugin-client-sdk/testing";
import { EntityId } from "@ryot-app/plugin-kit/schema";
import { fireEvent, screen, waitFor } from "@testing-library/dom";
import { act } from "react";

import { PLUGIN_PACKAGE_ID } from "../../shared/plugin-identity";
import WorkoutTemplatePage from "./screen";

afterEach(disposePluginBridges);

type QueryReply = Extract<
	Parameters<ReturnType<typeof mountPluginPage>["replyQuery"]>[1],
	{ readonly outcome: "success" }
>;
const rows = (
	items: readonly Record<string, unknown>[],
): QueryReply["response"]["data"][string] => ({
	items,
	type: "rows",
	pageInfo: { limit: 100, hasMore: false, nextCursor: null },
});

it.live(
	"shows exercise-only and partial template plans in preferred units without starting clocks",
	() =>
		Effect.gen(function* () {
			const pluginId = PluginId.make("fitness");
			const context: ClientPageContext = {
				view: null,
				settings: {},
				dataSources: null,
				route: { params: {} },
				renderer: { pluginId, kind: "plugin", exportName: "workout-template-detail" },
				contributors: [
					pluginContributor({ pluginId, name: "Fitness", packageId: PLUGIN_PACKAGE_ID }),
				],
				target: {
					kind: "entity",
					entitySchemaPluginId: pluginId,
					entityId: EntityId.make("template"),
					entitySchemaSlug: EntitySchemaSlug.make("workout-template"),
				},
			};
			let answer: (() => void) | undefined;
			const page = mountPluginPage(WorkoutTemplatePage, {
				page: context,
				onClientMessage: () => answer?.(),
				location: entityLocation("template", "workout-template"),
			});
			const answered = new Set<string>();
			answer = () => {
				for (const request of page.clientMessages()) {
					if (!("requestId" in request) || answered.has(request.requestId)) {
						continue;
					}
					answered.add(request.requestId);
					if (request.type === "operation-request") {
						page.send({
							outcome: "success",
							type: "operation-result",
							requestId: request.requestId,
							value: {
								proAvailable: false,
								settings: {
									dropRestTime: 0,
									energyUnit: "kJ",
									muteSounds: true,
									warmUpRestTime: 0,
									normalRestTime: 60,
									failureRestTime: 0,
									unitSystem: "imperial",
									promptForRestTimer: false,
									startTimerForDurationExercises: true,
								},
							},
						});
					} else if (request.type === "ryotql-request") {
						const data: QueryReply["response"]["data"] = Object.fromEntries(
							Object.keys(request.document.queries).map((name) => {
								if (name === "entity") {
									return [
										name,
										rows([
											{
												id: "template",
												name: "Partial plan",
												updatedAt: "2026-10-16T10:00:00.000Z",
												properties: {
													exercises: [
														{
															exerciseOrder: 0,
															exerciseId: "bench",
															notes: ["Keep control"],
															sets: [{ weight: 100, setOrder: 0, restTime: 0, setLot: "normal" }],
														},
														{ sets: [], notes: [], exerciseOrder: 1, exerciseId: "bench" },
													],
												},
											},
										]),
									];
								}
								if (name === "exercises") {
									return [
										name,
										rows([
											{ id: "bench", name: "Bench press", properties: { kind: "reps_and_weight" } },
										]),
									];
								}
								return [name, rows([])];
							}),
						);
						page.replyQuery(request.requestId, { outcome: "success", response: { data } });
					}
				}
			};
			yield* Effect.promise(() =>
				waitFor(() => {
					answer();
					expect(screen.getByRole("heading", { name: "Partial plan" })).toBeTruthy();
				}),
			);
			expect(screen.getByText("No planned sets.")).toBeTruthy();
			expect(screen.getByText("Keep control")).toBeTruthy();
			expect(screen.getByText(/220\.46 lb/).textContent).toContain("Rest 0:00");
			expect(screen.queryByRole("button", { name: "Confirm" })).toBeNull();
			expect(page.clientMessages().filter(({ type }) => type === "device-request")).toEqual([]);
			act(() => {
				fireEvent.click(screen.getByRole("button", { name: "Start workout" }));
			});
			yield* Effect.promise(() =>
				waitFor(() =>
					expect(page.clientMessages()).toContainEqual(
						expect.objectContaining({
							type: "navigate",
							target: {
								search: "",
								kind: "plugin-route",
								packageId: PLUGIN_PACKAGE_ID,
								path: "/templates/template/start",
							},
						}),
					),
				),
			);
		}),
);
