import { Effect } from "effect";
import { Playwright, PlaywrightSpawner } from "effect-playwright";

import { createAuthenticatedClient, listEventsForEntity } from "~/fixtures/kernel";
import { insertLibraryMembership, seedGlobalMovieWithCollection } from "~/fixtures/plugins/media";
import { mediaPluginFrame } from "~/fixtures/plugins/media/frame";
import { signInThroughHostedOAuth } from "~/support/browser";
import { expect, it } from "~/support/effect-test";
import { getFrontendUrl } from "~/support/harness-target";

it.live("creates, edits and deletes a rating-only review from Movie detail", () =>
	Effect.gen(function* () {
		const { email, client, password } = yield* createAuthenticatedClient();
		const suffix = crypto.randomUUID();
		const movieName = `Rating-only Movie ${suffix}`;
		const { movie } = yield* seedGlobalMovieWithCollection(client, {
			movieName,
			siblingName: `Rating-only Sequel ${suffix}`,
			collectionName: `Rating-only Collection ${suffix}`,
		});
		yield* insertLibraryMembership(client, { mediaEntityId: movie.id });
		const browser = yield* Playwright.Browser;
		const page = yield* browser.newPage({ viewport: { width: 1280, height: 900 } });
		yield* signInThroughHostedOAuth(page, email, password);
		yield* page.goto(`${getFrontendUrl()}/e/${movie.id}`);
		const media = mediaPluginFrame(page).contentFrame();
		yield* media
			.getByRole("heading", { exact: true, name: movieName })
			.waitFor({ state: "visible" });
		yield* media.getByRole("button", { exact: true, name: "Rate or review" }).click();
		const create = media.getByRole("dialog", { name: "Rate or review" });
		expect(yield* create.getByRole("switch", { name: "Contains spoilers" }).count).toBe(0);
		yield* create.getByLabel("Rating (0–100, optional)").fill("0");
		yield* create.getByRole("button", { exact: true, name: "Save review" }).click();
		yield* create.waitFor({ state: "hidden" });
		yield* media.getByRole("tab", { exact: true, name: "Activity" }).click();
		yield* media.getByText("0 / 100", { exact: true }).waitFor({ state: "visible" });
		yield* media.getByRole("button", { exact: true, name: "Record actions" }).click();
		yield* media.getByRole("menuitem", { exact: true, name: "Edit" }).click();
		const edit = media.getByRole("dialog", { name: "Edit review" });
		expect(yield* edit.getByLabel("Review (optional)").inputValue()).toBe("");
		yield* edit.getByLabel("Rating (0–100, optional)").fill("");
		yield* edit
			.getByRole("alert")
			.getByText("Keep a rating or review text, or delete this review.")
			.waitFor({ state: "visible" });
		expect(yield* edit.getByRole("button", { exact: true, name: "Save review" }).isEnabled()).toBe(
			false,
		);
		yield* edit.getByLabel("Rating (0–100, optional)").fill("82.5");
		yield* edit.getByRole("button", { exact: true, name: "Save review" }).click();
		yield* edit.waitFor({ state: "hidden" });
		yield* media.getByText("82.5 / 100", { exact: true }).waitFor({ state: "visible" });
		const [review] = yield* listEventsForEntity(client, movie.id, undefined, 100, {
			eventSchemaSlug: "review",
		});
		expect(review?.properties).toEqual({ rating: 82.5 });
		yield* media.getByRole("button", { exact: true, name: "Record actions" }).click();
		yield* media.getByRole("menuitem", { exact: true, name: "Delete" }).click();
		yield* media
			.getByRole("dialog", { name: "Delete this review?" })
			.getByRole("button", { exact: true, name: "Delete review" })
			.click();
		yield* media.getByText("82.5 / 100", { exact: true }).waitFor({ state: "hidden" });
		expect(
			yield* listEventsForEntity(client, movie.id, undefined, 100, { eventSchemaSlug: "review" }),
		).toEqual([]);
		expect(
			(yield* listEventsForEntity(client, movie.id, undefined, 100)).map(
				(event) => event.eventSchemaSlug,
			),
		).toEqual(["add-to-media-library"]);
	}).pipe(PlaywrightSpawner.withBrowser),
);
