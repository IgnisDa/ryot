import { Effect } from "effect";
import { Playwright, PlaywrightSpawner } from "effect-playwright";

import { createAuthenticatedClient, waitForEventWithSchema } from "~/fixtures/kernel";
import { logMediaActivity, seedActivityShow } from "~/fixtures/plugins/media";
import { signInThroughHostedOAuth } from "~/support/browser";
import { expect, it } from "~/support/effect-test";
import { getApiUrl, getFrontendUrl } from "~/support/harness-target";

const nowIso = () => new Date().toISOString();

const openShow = (input: { email: string; password: string; showId: string }) =>
	Effect.gen(function* () {
		const browser = yield* Playwright.Browser;
		const page = yield* browser.newPage({ viewport: { width: 1280, height: 900 } });
		yield* signInThroughHostedOAuth(page, input.email, input.password);
		yield* page.goto(`${getFrontendUrl()}/e/${input.showId}`);
		const media = page.locator('iframe[title="Media plugin"]').contentFrame();
		yield* media
			.getByRole("heading", { level: 1, name: /^Activity Log Show / })
			.waitFor({ state: "visible", timeout: 150_000 });
		return media;
	});

const seedShowWithFirstEpisodeWatched = Effect.gen(function* () {
	const { email, client, password } = yield* createAuthenticatedClient(getApiUrl());
	const seeded = yield* seedActivityShow(client, {
		episodes: [1, 2, 3, 4].map((episodeNumber) => ({ episodeNumber, seasonNumber: 1 })),
	});
	yield* logMediaActivity(client, {
		submittedAt: nowIso(),
		submissionId: crypto.randomUUID(),
		entry: {
			kind: "episodes",
			when: { kind: "now" },
			parentEntityId: seeded.showId,
			episodeEntityIds: [seeded.episodeId(1, 1)],
		},
	});
	return { email, client, seeded, password };
});

it.live("marks the next episode watched from the header without a reload", () =>
	Effect.gen(function* () {
		const { email, client, seeded, password } = yield* seedShowWithFirstEpisodeWatched;
		const media = yield* openShow({ email, password, showId: seeded.showId });

		yield* media.getByRole("button", { exact: true, name: "Mark S1·E2 watched" }).click();
		yield* media
			.getByRole("status")
			.getByText("S1·E2 watched.", { exact: true })
			.waitFor({ state: "visible" });
		yield* media
			.getByRole("button", { exact: true, name: "Mark S1·E3 watched" })
			.waitFor({ state: "visible" });

		const complete = yield* waitForEventWithSchema(client, seeded.episodeId(1, 2), "complete");
		expect(complete.eventSchemaSlug).toBe("complete");
	}).pipe(PlaywrightSpawner.withBrowser),
);

it.live("marks an episode watched from its details", () =>
	Effect.gen(function* () {
		const { email, client, seeded, password } = yield* seedShowWithFirstEpisodeWatched;
		const media = yield* openShow({ email, password, showId: seeded.showId });

		yield* media.getByRole("tab", { name: "Episodes" }).click();
		yield* media
			.getByRole("button", { name: /^Open S1E3 / })
			.first()
			.click();
		const details = media.getByRole("dialog", { name: /^S1E3 / });
		yield* details.getByRole("button", { exact: true, name: "Mark watched" }).click();
		yield* details.getByText("Marked watched.", { exact: true }).waitFor({ state: "visible" });
		yield* details.getByText("Watched", { exact: true }).waitFor({ state: "visible" });

		const complete = yield* waitForEventWithSchema(client, seeded.episodeId(1, 3), "complete");
		expect(complete.eventSchemaSlug).toBe("complete");
	}).pipe(PlaywrightSpawner.withBrowser),
);

it.live("opens the Log activity sheet from episode details with that episode selected", () =>
	Effect.gen(function* () {
		const { email, seeded, password } = yield* seedShowWithFirstEpisodeWatched;
		const media = yield* openShow({ email, password, showId: seeded.showId });

		yield* media.getByRole("tab", { name: "Episodes" }).click();
		yield* media.getByRole("button", { name: /^Open S1E4 / }).click();
		yield* media
			.getByRole("dialog", { name: /^S1E4 / })
			.getByRole("button", { exact: true, name: "Log…" })
			.click();
		const sheet = media.getByRole("dialog", { name: "Log activity" });
		yield* sheet.waitFor({ state: "visible" });
		yield* sheet
			.getByRole("button", { exact: true, name: "Mark S1·E4 watched" })
			.waitFor({ state: "visible" });
	}).pipe(PlaywrightSpawner.withBrowser),
);
