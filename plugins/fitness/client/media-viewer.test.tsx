import { afterEach, expect, it } from "@effect/vitest";
import { Effect } from "@ryot-app/plugin-client-sdk/effect";
import {
	disposePluginBridges,
	mountPluginPage,
	routeLocation,
	savedViewPageContext,
} from "@ryot-app/plugin-client-sdk/testing";
import { screen, waitFor } from "@testing-library/dom";

import { WorkoutMediaViewer } from "./media-viewer";

afterEach(disposePluginBridges);

it.live("renders image previews and video controls for workout attachments", () =>
	Effect.gen(function* () {
		const page = mountPluginPage(
			() => (
				<WorkoutMediaViewer
					label="Workout"
					images={[{ type: "remote", url: "https://assets.test/form.jpg" }]}
					videos={[{ type: "remote", url: "https://assets.test/form.mp4" }]}
				/>
			),
			{
				location: routeLocation("/media"),
				page: savedViewPageContext({
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
);
