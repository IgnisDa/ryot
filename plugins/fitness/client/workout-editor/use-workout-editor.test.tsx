import { expect, it } from "@effect/vitest";
import type { ClientPageContext } from "@ryot-app/plugin-client-contract";
import { Effect } from "@ryot-app/plugin-client-sdk/effect";
import { PluginId } from "@ryot-app/plugin-client-sdk/plugin";
import { PluginScreenFrame } from "@ryot-app/plugin-client-sdk/screen";
import {
	createTestRyotClock,
	disposePluginBridges,
	mountPluginPage,
	pluginContributor,
	routeLocation,
	waitForMessagePortMacrotask,
} from "@ryot-app/plugin-client-sdk/testing";
import { Schema } from "@ryot-app/plugin-kit/effect";
import { screen, waitFor } from "@testing-library/dom";
import { act, useState } from "react";

import { PLUGIN_PACKAGE_ID } from "../../shared/plugin-identity";
import {
	encodeWorkoutEditorDraft,
	WorkoutEditorDraftSchema,
} from "../../shared/workout-editor-draft";
import { useWorkoutEditor } from "./use-workout-editor";

function Probe() {
	const [renders, setRenders] = useState(0);
	const { snapshot } = useWorkoutEditor({
		search: "",
		path: "/editor",
		kind: "plugin-route",
		packageId: PLUGIN_PACKAGE_ID,
	});
	return (
		<PluginScreenFrame title="Editor probe">
			<p>{snapshot.status === "ready" ? snapshot.draft.name : snapshot.status}</p>
			<button onClick={() => setRenders(renders + 1)}>Render {renders}</button>
		</PluginScreenFrame>
	);
}

it.live(
	"retains the controller across renders, refreshes context once, and requests awake demand",
	() =>
		Effect.gen(function* () {
			const clock = createTestRyotClock();
			const pluginId = PluginId.make("fitness");
			const context: ClientPageContext = {
				view: null,
				settings: {},
				dataSources: null,
				route: { params: {} },
				renderer: { pluginId, kind: "plugin", exportName: "probe" },
				target: { search: "", path: "/editor", kind: "plugin-route", packageId: PLUGIN_PACKAGE_ID },
				contributors: [
					pluginContributor({ pluginId, name: "Fitness", packageId: PLUGIN_PACKAGE_ID }),
				],
			};
			const initialDraft = yield* Schema.decodeEffect(WorkoutEditorDraftSchema)({
				images: [],
				videos: [],
				supersets: [],
				occurrences: [],
				activeDuration: 0,
				draftId: "draft-1",
				mode: { kind: "live" },
				name: "Recovered session",
				displayEnergyUnit: "kcal",
				activeDurationIntent: "set",
				kind: "fitness-workout-editor",
				startedAt: "2026-10-15T10:00:00.000Z",
			});
			const stored = encodeWorkoutEditorDraft(initialDraft);
			const page = mountPluginPage(Probe, {
				page: context,
				bootstrap: clock.bootstrap,
				location: routeLocation("/editor"),
			});
			const answered = new Set<string>();
			const respond = () => {
				for (const request of page.clientMessages()) {
					if (!("requestId" in request) || answered.has(request.requestId)) {
						continue;
					}
					answered.add(request.requestId);
					if (request.type === "storage-request") {
						page.send({
							outcome: "success",
							type: "storage-result",
							requestId: request.requestId,
							value: request.action === "get" ? stored : null,
						});
					} else if (request.type === "device-request") {
						page.send({
							outcome: "success",
							type: "device-result",
							value: { status: "done" },
							requestId: request.requestId,
						});
					} else if (request.type === "operation-request") {
						page.send({
							outcome: "success",
							type: "operation-result",
							requestId: request.requestId,
							value: {
								proAvailable: false,
								settings: {
									dropRestTime: 0,
									warmUpRestTime: 0,
									muteSounds: false,
									normalRestTime: 60,
									failureRestTime: 0,
									energyUnit: "kcal",
									unitSystem: "metric",
									promptForRestTimer: false,
									startTimerForDurationExercises: true,
								},
							},
						});
					}
				}
			};
			try {
				yield* Effect.promise(() =>
					waitFor(() => {
						respond();
						expect(screen.getByText("Recovered session")).toBeTruthy();
						expect(page.clientMessages()).toContainEqual(
							expect.objectContaining({ enabled: true, action: "awake", type: "device-request" }),
						);
					}),
				);
				act(() => screen.getByRole("button", { name: "Render 0" }).click());
				expect(screen.getByRole("button", { name: "Render 1" })).toBeTruthy();
				expect(
					page
						.clientMessages()
						.filter((request) => request.type === "storage-request" && request.action === "get"),
				).toHaveLength(1);
				page.send({ type: "page-refresh" });
				yield* waitForMessagePortMacrotask;
				yield* Effect.promise(() => clock.advance("1 second"));
				yield* Effect.promise(() =>
					waitFor(() => {
						respond();
						expect(
							page.clientMessages().filter((request) => request.type === "operation-request"),
						).toHaveLength(2);
					}),
				);
				yield* waitForMessagePortMacrotask;
				yield* Effect.promise(() => clock.advance("1 second"));
				expect(
					page.clientMessages().filter((request) => request.type === "operation-request"),
				).toHaveLength(2);
			} finally {
				disposePluginBridges();
				yield* Effect.promise(() => clock.dispose());
			}
		}),
);
