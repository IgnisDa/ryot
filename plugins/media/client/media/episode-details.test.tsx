import { afterEach, describe, expect, it } from "@effect/vitest";
import { RyotClientError } from "@ryot-app/plugin-client-sdk";
import { DateTime, Effect } from "@ryot-app/plugin-client-sdk/effect";
import { getByRole, getByText, queryByRole, waitFor } from "@testing-library/dom";

import {
	activityLogQuery,
	contextTarget,
	podcastRow,
} from "../../tests/client/activity-log/fixtures";
import {
	decodeEpisodicEpisodePage,
	EPISODIC_FIXTURE_LOG,
	EPISODIC_FIXTURE_RENDER,
	episodicEpisode,
	episodicEpisodePageData,
	episodicFixtureEpisodesQuery,
} from "../../tests/client/episodic/episodes-fixture";
import {
	clickRyotElement,
	flushRyotClient,
	localDateTime,
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
							log={EPISODIC_FIXTURE_LOG}
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
					log={EPISODIC_FIXTURE_LOG}
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

const NOW = DateTime.toEpochMillis(localDateTime({ day: 20, hour: 9, month: 10, year: 2026 }));

type Operation = { readonly slug: string; readonly input: unknown };

const mountDetails = (options: {
	readonly publishDate?: string | null;
	readonly podcast?: Parameters<typeof activityLogQuery>[0]["podcast"];
	readonly result?: (attempt: number) => Effect.Effect<unknown, RyotClientError>;
}) => {
	const requests: Operation[] = [];
	const logQuery = activityLogQuery({
		podcast: options.podcast ?? [],
		target: contextTarget({
			name: "Serial",
			schemaSlug: "podcast",
			podcastNextUp: {
				pageInfo: { limit: 1, hasMore: false },
				items: [{ id: "p5", name: "Five", episodeNumber: 5, seasonNumber: null }],
			},
		}),
	});
	const view = mountRyotClient(
		{
			watchEntities: () => ({ update: () => undefined, dispose: () => undefined }),
			invokeOperation: (request) => {
				requests.push(request);
				return options.result?.(requests.length) ?? Effect.succeed({ count: 1, status: "saved" });
			},
			query: (document) =>
				JSON.stringify(document).includes("fixtureEpisode")
					? Effect.succeed(
							episodicEpisodePageData({
								episodes: [
									episodicEpisode({
										id: "p1",
										episodeNumber: 1,
										name: "The Arrival",
										publishDate: options.publishDate ?? "2026-10-01",
									}),
								],
							}),
						)
					: logQuery(document),
		},
		<MediaEpisodePages
			compact
			copy={COPY}
			nextUp={null}
			safeAreaTop={0}
			entityId="parent-1"
			containerId="parent-1"
			log={EPISODIC_FIXTURE_LOG}
			render={EPISODIC_FIXTURE_RENDER}
			query={episodicFixtureEpisodesQuery}
		/>,
	);
	return { view, requests };
};

const openDetails = (mounted: ReturnType<typeof mountDetails>) =>
	Effect.gen(function* () {
		yield* Effect.promise(() => mounted.view.setTime(NOW));
		yield* Effect.promise(() =>
			waitFor(() =>
				clickRyotElement(getByRole(mounted.view.container, "button", { name: "Open The Arrival" })),
			),
		);
		return getByRole(document.body, "dialog", { name: "The Arrival" });
	});

describe("episode details actions", () => {
	it.live("marks the episode with a single episodes entry", () =>
		Effect.gen(function* () {
			const mounted = mountDetails({});
			const dialog = yield* openDetails(mounted);
			clickRyotElement(getByRole(dialog, "button", { name: "Mark listened" }));
			yield* Effect.promise(() => waitFor(() => expect(mounted.requests).toHaveLength(1)));
			expect(mounted.requests[0]).toMatchObject({
				slug: "media-activity-log",
				input: {
					entry: {
						kind: "episodes",
						when: { kind: "now" },
						episodeEntityIds: ["p1"],
						parentEntityId: "parent-1",
					},
				},
			});
			yield* Effect.promise(() =>
				waitFor(() => expect(getByText(dialog, "Marked listened.")).toBeDefined()),
			);
			mounted.view.unmount();
		}),
	);

	it.live("retries the same submission after a failure", () =>
		Effect.gen(function* () {
			const mounted = mountDetails({
				result: (attempt) =>
					attempt === 1
						? Effect.fail(new RyotClientError("operation-failed"))
						: Effect.succeed({ count: 1, status: "saved" }),
			});
			const dialog = yield* openDetails(mounted);
			clickRyotElement(getByRole(dialog, "button", { name: "Mark listened" }));
			yield* Effect.promise(() =>
				waitFor(() =>
					expect(getByRole(dialog, "alert").textContent).toBe("Couldn't save. Try again."),
				),
			);
			clickRyotElement(getByRole(dialog, "button", { name: "Retry" }));
			yield* Effect.promise(() => waitFor(() => expect(mounted.requests).toHaveLength(2)));
			expect(mounted.requests[1]).toEqual(mounted.requests[0]);
			yield* Effect.promise(() =>
				waitFor(() => expect(getByText(dialog, "Marked listened.")).toBeDefined()),
			);
			mounted.view.unmount();
		}),
	);

	it.live("hides both actions for an upcoming episode but not one airing today", () =>
		Effect.gen(function* () {
			const upcoming = mountDetails({ publishDate: "2026-10-21" });
			const upcomingDialog = yield* openDetails(upcoming);
			expect(queryByRole(upcomingDialog, "button", { name: "Mark listened" })).toBeNull();
			expect(queryByRole(upcomingDialog, "button", { name: "Log…" })).toBeNull();
			upcoming.view.unmount();
			document.body.innerHTML = "";
			const today = mountDetails({ publishDate: "2026-10-20" });
			const todayDialog = yield* openDetails(today);
			expect(getByRole(todayDialog, "button", { name: "Mark listened" })).toBeDefined();
			expect(getByRole(todayDialog, "button", { name: "Log…" })).toBeDefined();
			today.view.unmount();
		}),
	);

	it.live("stacks the log sheet over the details on an episode beyond the first picker page", () =>
		Effect.gen(function* () {
			const mounted = mountDetails({ podcast: [[podcastRow(5)], [podcastRow(1)]] });
			const dialog = yield* openDetails(mounted);
			clickRyotElement(getByRole(dialog, "button", { name: "Log…" }));
			const sheet = yield* Effect.promise(() =>
				waitFor(() => {
					const found = getByRole(document.body, "dialog", { name: "Log activity" });
					getByRole(found, "button", { name: "Mark Episode 1 listened" });
					return found;
				}),
			);
			expect(getByRole(sheet, "radio", { name: "Episode 5 · Next up" })).toBeDefined();
			expect(queryByRole(sheet, "radio", { name: "Episode 1" })).toBeNull();
			expect(
				getByRole(document.body, "dialog", { hidden: true, name: "The Arrival" }),
			).toBeDefined();
			expect(mounted.requests).toEqual([]);
			mounted.view.unmount();
		}),
	);
});
