import { afterEach, expect } from "bun:test";

import { Effect, Schema } from "@ryot-app/plugin-client-sdk/effect";
import {
	disposePluginBridges,
	mountPluginPage,
	routeLocation,
	savedViewPageContext,
} from "@ryot-app/plugin-client-sdk/testing";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { fireEvent, screen, waitFor, within } from "@testing-library/dom";
import { it } from "@voila.dev/effect-bun-test";
import { act } from "react";

import { WorkoutEditorDraftSchema } from "../../shared/workout-editor-draft";
import { WorkoutMediaOverlay } from "./media";
import type { WorkoutMediaKind } from "./media-state";

afterEach(disposePluginBridges);

it.live(
	"routes selected image and video files to the occurrence and keeps existing media after an upload failure",
	() =>
		Effect.gen(function* () {
			const draft = yield* Schema.decodeEffect(WorkoutEditorDraftSchema)({
				images: [],
				videos: [],
				supersets: [],
				name: "Workout",
				draftId: "draft-1",
				mode: { kind: "live" },
				displayEnergyUnit: "kcal",
				activeDurationIntent: "set",
				kind: "fitness-workout-editor",
				occurrences: [
					{
						sets: [],
						notes: [],
						videos: [],
						clientId: "first",
						isCollapsed: false,
						exerciseKind: "reps",
						exerciseId: "exercise-1",
						images: [{ type: "remote", url: "https://assets.test/keep.jpg" }],
					},
				],
			});
			const uploads: { readonly file: File; readonly kind: WorkoutMediaKind }[] = [];
			const page = mountPluginPage(
				() => (
					<WorkoutMediaOverlay
						canUpload
						draft={draft}
						disabled={false}
						uploading={false}
						label="first exercise"
						onClose={() => undefined}
						onRemove={() => undefined}
						target={{ kind: "occurrence", occurrenceId: "first" }}
						onUpload={(kind, file) =>
							Effect.sync(() => {
								uploads.push({ kind, file });
							}).pipe(
								Effect.flatMap(() =>
									kind === "images" ? Effect.fail("unavailable") : Effect.void,
								),
							)
						}
					/>
				),
				{
					location: routeLocation("/media"),
					page: savedViewPageContext({
						settings: {},
						savedViewId: "media-test",
						rendererName: "media-test",
						dataSources: { queries: {} },
					}),
				},
			);
			yield* Effect.promise(() =>
				waitFor(() =>
					expect(
						screen.getByRole("dialog", { name: "Attachments for first exercise" }),
					).toBeTruthy(),
				),
			);
			const panel = within(screen.getByRole("dialog", { name: "Attachments for first exercise" }));
			const image = new File(["image"], "form.jpg", { type: "image/jpeg" });
			act(() => {
				fireEvent.change(panel.getByLabelText("Upload image"), { target: { files: [image] } });
			});
			yield* Effect.promise(() =>
				waitFor(() =>
					expect(panel.getByText(/The attachment could not be uploaded or stored/)).toBeTruthy(),
				),
			);
			expect(uploads[0]).toEqual({ file: image, kind: "images" });
			expect(panel.getByRole("img", { name: "first exercise image 1" }).getAttribute("src")).toBe(
				"https://assets.test/keep.jpg",
			);
			const video = new File(["video"], "form.mp4", { type: "video/mp4" });
			act(() => {
				fireEvent.change(panel.getByLabelText("Upload video"), { target: { files: [video] } });
			});
			yield* Effect.promise(() =>
				waitFor(() => {
					expect(uploads).toHaveLength(2);
					expect(panel.queryByText(/The attachment could not be uploaded or stored/)).toBeNull();
				}),
			);
			expect(uploads[1]).toEqual({ file: video, kind: "videos" });
			page.dispose();
		}),
	testTimeout,
);
