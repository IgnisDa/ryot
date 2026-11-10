import { EventSchemaSlug } from "@ryot-app/contract/schema/brands";
import { randomUuid } from "@ryot-app/testing/random";
import { Effect } from "effect";
import { Playwright, PlaywrightSpawner } from "effect-playwright";

import { createAuthenticatedClient, waitForEventWithSchema } from "~/fixtures/kernel";
import { logMediaActivity, seedShow } from "~/fixtures/plugins/media";
import { mediaPluginFrame } from "~/fixtures/plugins/media/frame";
import { signInThroughHostedOAuth } from "~/support/browser";
import { expect, it } from "~/support/effect-test";
import { getFrontendUrl } from "~/support/harness-target";
import { nowIso } from "~/support/time";

const openShow = (input: { email: string; showId: string; password: string }) =>
	Effect.gen(function* () {
		const browser = yield* Playwright.Browser;
		const page = yield* browser.newPage({ viewport: { width: 1280, height: 900 } });
		yield* signInThroughHostedOAuth(page, input.email, input.password);
		yield* page.goto(`${getFrontendUrl()}/e/${input.showId}`);
		const media = mediaPluginFrame(page).contentFrame();
		yield* media
			.getByRole("heading", { level: 1, name: /^Activity Log Show / })
			.waitFor({ state: "visible", timeout: 150_000 });
		return { page, media };
	});

const seedShowWithFirstEpisodeWatched = Effect.gen(function* () {
	const { email, client, password } = yield* createAuthenticatedClient();
	const seeded = yield* seedShow(client, {
		name: `Activity Log Show ${yield* randomUuid}`,
		seasons: [
			{ seasonNumber: 1, episodes: [1, 2, 3, 4].map((episodeNumber) => ({ episodeNumber })) },
		],
	});
	yield* logMediaActivity(client, {
		submittedAt: nowIso(),
		submissionId: yield* randomUuid,
		entry: {
			kind: "episodes",
			when: { kind: "now" },
			parentEntityId: seeded.show.id,
			episodeEntityIds: [seeded.episodeId(1, 1)],
		},
	});
	return { email, client, seeded, password };
});

it.live("marks the next episode watched from the header without a reload", () =>
	Effect.gen(function* () {
		const { email, client, seeded, password } = yield* seedShowWithFirstEpisodeWatched;
		const { page, media } = yield* openShow({ email, password, showId: seeded.show.id });

		yield* media.getByRole("button", { exact: true, name: "Mark S1·E2 watched" }).click();
		yield* page
			.getByRole("region", { name: "Background activity" })
			.getByText("S1·E2 watched.", { exact: true })
			.waitFor({ state: "visible" });
		yield* media
			.getByRole("button", { exact: true, name: "Mark S1·E3 watched" })
			.waitFor({ state: "visible" });

		const complete = yield* waitForEventWithSchema(client, seeded.episodeId(1, 2), "complete");
		expect(complete.eventSchemaSlug).toBe(EventSchemaSlug.make("complete"));
	}).pipe(PlaywrightSpawner.withBrowser),
);

it.live("marks an episode watched from its details", () =>
	Effect.gen(function* () {
		const { email, client, seeded, password } = yield* seedShowWithFirstEpisodeWatched;
		const { page, media } = yield* openShow({ email, password, showId: seeded.show.id });

		yield* media.getByRole("tab", { name: "Episodes" }).click();
		yield* media
			.getByRole("button", { name: /^Open S1E3 / })
			.first()
			.click();
		const details = media.getByRole("dialog", { name: /^S1E3 / });
		yield* details.getByRole("button", { exact: true, name: "Mark watched" }).click();
		yield* page
			.getByRole("region", { name: "Background activity" })
			.getByText(/^Marked .+ watched\.$/)
			.waitFor({ state: "visible" });
		yield* details.getByText("Watched", { exact: true }).waitFor({ state: "visible" });

		const complete = yield* waitForEventWithSchema(client, seeded.episodeId(1, 3), "complete");
		expect(complete.eventSchemaSlug).toBe(EventSchemaSlug.make("complete"));
	}).pipe(PlaywrightSpawner.withBrowser),
);

it.live("opens the Log activity sheet from episode details with that episode selected", () =>
	Effect.gen(function* () {
		const { email, seeded, password } = yield* seedShowWithFirstEpisodeWatched;
		const { media } = yield* openShow({ email, password, showId: seeded.show.id });

		yield* media.getByRole("tab", { name: "Episodes" }).click();
		yield* media.getByRole("button", { name: /^Open S1E4 / }).click();
		yield* media
			.getByRole("dialog", { name: /^S1E4 / })
			.getByRole("button", { exact: true, name: "Log with details…" })
			.click();
		const sheet = media.getByRole("dialog", { name: "Log activity" });
		yield* sheet.waitFor({ state: "visible" });
		yield* sheet
			.getByRole("switch", { exact: true, name: "Also mark 2 earlier unwatched episodes" })
			.waitFor({ state: "visible" });
		yield* sheet
			.getByRole("button", { exact: true, name: "Mark 3 episodes watched" })
			.waitFor({ state: "visible" });
	}).pipe(PlaywrightSpawner.withBrowser),
);

it.live("reviews an episode from its details and a season from its header", () =>
	Effect.gen(function* () {
		const { email, client, seeded, password } = yield* seedShowWithFirstEpisodeWatched;
		const { media } = yield* openShow({ email, password, showId: seeded.show.id });

		yield* media.getByRole("tab", { name: "Episodes" }).click();
		yield* media.getByRole("button", { name: /^Open S1E3 / }).click();
		yield* media
			.getByRole("dialog", { name: /^S1E3 / })
			.getByRole("button", { exact: true, name: "Review" })
			.click();
		const episodeReview = media.getByRole("dialog", { name: "Rate or review" });
		yield* episodeReview.waitFor({ state: "visible" });
		yield* episodeReview.getByText(/^Review of S1 • E3/).waitFor({ state: "visible" });
		yield* episodeReview.getByLabel("Rating (out of 100, optional)").fill("80");
		yield* episodeReview.getByRole("button", { exact: true, name: "Save review" }).click();
		yield* episodeReview.waitFor({ state: "hidden" });
		const episodeEvent = yield* waitForEventWithSchema(client, seeded.episodeId(1, 3), "review");
		expect(episodeEvent.properties).toEqual({ rating: 80 });

		yield* media.getByRole("button", { exact: true, name: "Review" }).click();
		const seasonReview = media.getByRole("dialog", { name: "Rate or review" });
		yield* seasonReview.getByText(/^Review of Season 1/).waitFor({ state: "visible" });
		yield* seasonReview.getByLabel("Rating (out of 100, optional)").fill("65");
		yield* seasonReview.getByRole("button", { exact: true, name: "Save review" }).click();
		yield* seasonReview.waitFor({ state: "hidden" });
		const seasonEvent = yield* waitForEventWithSchema(
			client,
			seeded.seasons[0]?.id ?? "",
			"review",
		);
		expect(seasonEvent.properties).toEqual({ rating: 65 });

		yield* media.getByRole("tab", { exact: true, name: "Activity" }).click();
		yield* media.getByText("Reviewed Season 1", { exact: true }).waitFor({ state: "visible" });
	}).pipe(PlaywrightSpawner.withBrowser),
);
