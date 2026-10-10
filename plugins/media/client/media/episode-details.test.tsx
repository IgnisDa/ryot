import { afterEach, describe, expect, it } from "@effect/vitest";
import { Effect } from "@ryot-app/plugin-client-sdk/effect";
import { getByRole, queryByRole, waitFor } from "@testing-library/dom";

import {
	decodeEpisodicEpisodePage,
	EPISODIC_FIXTURE_RENDER,
	episodicEpisode,
	episodicEpisodePageData,
	episodicFixtureEpisodesQuery,
} from "../../tests/client/episodic/episodes-fixture";
import {
	clickRyotElement,
	flushRyotClient,
	mountRyotClient,
} from "../../tests/client/test-support";
import { mediaCursorPageError } from "./cursor-page-state";
import { MediaEpisodePages, type MediaEpisodePagesCopy } from "./episodes";

const COPY: MediaEpisodePagesCopy = {
	empty: "No episodes.",
	loading: { title: "Loading", detail: "Loading episodes." },
	error: (state) => mediaCursorPageError({ state, noun: "episodes" }),
};

afterEach(() => {
	document.body.innerHTML = "";
});

describe("episode details", () => {
	for (const compact of [true, false]) {
		it.live(
			`opens full details and restores focus in ${compact ? "compact" : "desktop"} layout`,
			() =>
				Effect.gen(function* () {
					const documents: unknown[] = [];
					const view = mountRyotClient(
						{
							query: (document) => {
								documents.push(document);
								return Effect.succeed(
									episodicEpisodePageData({
										episodes: [
											episodicEpisode({
												state: "complete",
												name: "The Arrival",
												description:
													"The **whole story** continues.\n\nAn unabridged second paragraph.",
											}),
										],
									}),
								);
							},
						},
						<MediaEpisodePages
							copy={COPY}
							nextUp={null}
							safeAreaTop={12}
							compact={compact}
							entityId="parent-1"
							containerId="parent-1"
							render={EPISODIC_FIXTURE_RENDER}
							query={episodicFixtureEpisodesQuery}
						/>,
					);
					yield* Effect.promise(() => flushRyotClient());
					yield* Effect.promise(() =>
						waitFor(() =>
							expect(
								getByRole(view.container, "button", { name: "Open The Arrival" }),
							).toBeDefined(),
						),
					);
					const trigger = getByRole(view.container, "button", { name: "Open The Arrival" });
					clickRyotElement(trigger);
					const dialog = getByRole(document.body, "dialog", { name: "The Arrival" });
					expect(getByRole(dialog, "heading", { name: "The Arrival" })).toBeDefined();
					expect(dialog.querySelector("strong")?.textContent).toBe("whole story");
					expect(dialog.textContent).toContain("An unabridged second paragraph.");
					expect(dialog.textContent).toContain("52 min");
					expect(dialog.textContent).toContain("Played");
					expect(documents).toHaveLength(1);
					clickRyotElement(getByRole(dialog, "button", { name: "Close episode details" }));
					expect(queryByRole(document.body, "dialog")).toBeNull();
					yield* Effect.promise(() => waitFor(() => expect(document.activeElement).toBe(trigger)));
					view.unmount();
				}),
		);
	}

	it.live("opens next-up details with missing optional metadata", () =>
		Effect.gen(function* () {
			const [nextUp] = decodeEpisodicEpisodePage({
				episodes: [
					episodicEpisode({
						images: [],
						runtime: null,
						description: null,
						publishDate: null,
						name: "Next chapter",
					}),
				],
			}).items;
			if (nextUp === undefined) {
				throw new Error("Expected next-up episode");
			}
			const view = mountRyotClient(
				{ query: () => Effect.succeed(episodicEpisodePageData({})) },
				<MediaEpisodePages
					compact
					copy={COPY}
					safeAreaTop={0}
					nextUp={nextUp}
					entityId="parent-1"
					containerId="parent-1"
					render={EPISODIC_FIXTURE_RENDER}
					query={episodicFixtureEpisodesQuery}
				/>,
			);
			yield* Effect.promise(() => flushRyotClient());
			yield* Effect.promise(() =>
				waitFor(() =>
					expect(getByRole(view.container, "button", { name: "Open Next chapter" })).toBeDefined(),
				),
			);
			clickRyotElement(getByRole(view.container, "button", { name: "Open Next chapter" }));
			const dialog = getByRole(document.body, "dialog", { name: "Next chapter" });
			expect(dialog.textContent).not.toContain("null");
			expect(dialog.textContent).not.toContain("undefined");
			expect(dialog.textContent).not.toContain(" min");
			view.unmount();
		}),
	);
});
