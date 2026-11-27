import { afterEach, expect } from "bun:test";

import { testText } from "@ryot-app/kernel-messages/testing";
import { Effect } from "@ryot-app/plugin-client-sdk/effect";
import {
	disposePluginBridges,
	mountPluginPage,
	routeLocation,
} from "@ryot-app/plugin-client-sdk/testing";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { screen, waitFor } from "@testing-library/dom";
import { it } from "@voila.dev/effect-bun-test";

import { fitnessCatalogs, fitnessSavedViewPage } from "../tests/client/test-text";
import { WorkoutMediaViewer } from "./media-viewer";

afterEach(disposePluginBridges);

it.live(
	"renders image previews and video controls for workout attachments",
	() =>
		Effect.gen(function* () {
			const page = mountPluginPage(
				() => (
					<WorkoutMediaViewer
						label={testText("Workout")}
						images={[{ type: "remote", url: "https://assets.test/form.jpg" }]}
						videos={[{ type: "remote", url: "https://assets.test/form.mp4" }]}
					/>
				),
				{
					catalogs: fitnessCatalogs,
					location: routeLocation("/media"),
					page: fitnessSavedViewPage({
						settings: {},
						dataSources: { queries: {} },
						savedViewId: "media-viewer-test",
						rendererName: "media-viewer-test",
					}),
				},
			);
			yield* Effect.promise(() =>
				waitFor(() =>
					expect(screen.getByRole("region", { name: "Workout attachments" })).toBeTruthy(),
				),
			);
			const section = screen.getByRole("region", { name: "Workout attachments" });
			expect(screen.getByRole("heading", { name: "Attachments" })).toBeTruthy();
			expect(screen.getByRole("img", { name: "Workout image 1" }).getAttribute("src")).toBe(
				"https://assets.test/form.jpg",
			);
			const video = screen.getByLabelText("Workout video 1");
			expect(section.contains(video)).toBe(true);
			expect(video.hasAttribute("controls")).toBe(true);
			page.dispose();
		}),
	testTimeout,
);
