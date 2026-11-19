import { savedViewPath } from "@ryot-app/contract/modules/plugins/navigation";
import { EventSchemaSlug } from "@ryot-app/contract/schema/brands";
import { mediaPlugin } from "@ryot-app/media-plugin";
import { randomUuid } from "@ryot-app/testing/random";
import { Effect } from "effect";
import { Playwright, PlaywrightSpawner } from "effect-playwright";

import { createAuthenticatedClient, listEventsForEntity } from "~/fixtures/kernel";
import {
	insertLibraryMembership,
	logMediaActivity,
	seedGlobalMovieWithCollection,
} from "~/fixtures/plugins/media";
import { mediaPluginFrame } from "~/fixtures/plugins/media/frame";
import { signInThroughHostedOAuth } from "~/support/browser";
import { expect, it } from "~/support/effect-test";
import { getFrontendUrl } from "~/support/harness-target";
import { nowIso } from "~/support/time";

it.live("creates, edits and deletes a rating-only review from Movie detail", () =>
	Effect.gen(function* () {
		const { email, client, password } = yield* createAuthenticatedClient();
		const suffix = yield* randomUuid;
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
		yield* create.getByLabel("Rating (out of 100, optional)").fill("0");
		yield* create.getByRole("button", { exact: true, name: "Save review" }).click();
		yield* create.waitFor({ state: "hidden" });
		yield* media.getByRole("tab", { exact: true, name: "Activity" }).click();
		yield* media.getByText("0 / 100", { exact: true }).waitFor({ state: "visible" });
		yield* media.getByRole("button", { exact: true, name: "Record actions" }).click();
		yield* media.getByRole("menuitem", { exact: true, name: "Edit" }).click();
		const edit = media.getByRole("dialog", { name: "Edit review" });
		expect(yield* edit.getByLabel("Review (optional)").inputValue()).toBe("");
		yield* edit.getByLabel("Rating (out of 100, optional)").fill("");
		yield* edit
			.getByRole("alert")
			.getByText("Keep a rating or review text, or delete this review.")
			.waitFor({ state: "visible" });
		expect(yield* edit.getByRole("button", { exact: true, name: "Save review" }).isEnabled()).toBe(
			false,
		);
		yield* edit.getByLabel("Rating (out of 100, optional)").fill("82");
		yield* edit.getByRole("button", { exact: true, name: "Save review" }).click();
		yield* edit.waitFor({ state: "hidden" });
		yield* media.getByText("82 / 100", { exact: true }).waitFor({ state: "visible" });
		const [review] = yield* listEventsForEntity(client, movie.id, undefined, 100, {
			eventSchemaSlug: "review",
		});
		expect(review?.properties).toEqual({ rating: 82 });
		yield* media.getByRole("button", { exact: true, name: "Record actions" }).click();
		yield* media.getByRole("menuitem", { exact: true, name: "Delete" }).click();
		yield* media
			.getByRole("dialog", { name: "Delete this review?" })
			.getByRole("button", { exact: true, name: "Delete review" })
			.click();
		yield* media.getByText("82 / 100", { exact: true }).waitFor({ state: "hidden" });
		expect(
			yield* listEventsForEntity(client, movie.id, undefined, 100, { eventSchemaSlug: "review" }),
		).toEqual([]);
		expect(
			(yield* listEventsForEntity(client, movie.id, undefined, 100)).map(
				(event) => event.eventSchemaSlug,
			),
		).toEqual([EventSchemaSlug.make("add-to-media-library")]);
	}).pipe(PlaywrightSpawner.withBrowser),
);

it.live("enters and shows Media review ratings in the rating scale chosen in Settings", () =>
	Effect.gen(function* () {
		const { email, client, password } = yield* createAuthenticatedClient();
		const suffix = yield* randomUuid;
		const movieName = `Scaled Movie ${suffix}`;
		const { movie } = yield* seedGlobalMovieWithCollection(client, {
			movieName,
			siblingName: `Scaled Sequel ${suffix}`,
			collectionName: `Scaled Collection ${suffix}`,
		});
		yield* insertLibraryMembership(client, { mediaEntityId: movie.id });
		const browser = yield* Playwright.Browser;
		const page = yield* browser.newPage({ viewport: { width: 1280, height: 900 } });
		yield* signInThroughHostedOAuth(page, email, password);

		yield* page.goto(`${getFrontendUrl()}/settings/preferences`);
		yield* page.getByRole("button", { name: "Rating scale: Out of 100" }).click();
		yield* page.getByRole("radio", { exact: true, name: "Out of 10" }).click();
		yield* page.getByRole("button", { name: "Save changes" }).click();
		yield* page.getByText("Preferences saved.", { exact: true }).waitFor({ state: "visible" });

		yield* page.goto(`${getFrontendUrl()}/e/${movie.id}`);
		const media = mediaPluginFrame(page).contentFrame();
		yield* media
			.getByRole("heading", { exact: true, name: movieName })
			.waitFor({ state: "visible" });
		yield* media.getByRole("button", { exact: true, name: "Rate or review" }).click();
		const create = media.getByRole("dialog", { name: "Rate or review" });
		yield* create.getByLabel("Rating (out of 10, optional)").fill("7.5");
		yield* create.getByRole("button", { exact: true, name: "Save review" }).click();
		yield* create.waitFor({ state: "hidden" });
		yield* media.getByRole("tab", { exact: true, name: "Activity" }).click();
		yield* media.getByRole("img", { name: "7.5 out of 10" }).waitFor({ state: "visible" });
		const [review] = yield* listEventsForEntity(client, movie.id, undefined, 100, {
			eventSchemaSlug: "review",
		});
		expect(review?.properties).toEqual({ rating: 75 });

		yield* page.goto(
			`${getFrontendUrl()}${savedViewPath({ kind: "plugin", slug: "all-movies", packageId: mediaPlugin.metadata.packageId })}`,
		);
		const savedView = page.locator("iframe").contentFrame();
		yield* savedView.getByRole("radio", { name: "Table view" }).click();
		yield* savedView
			.getByRole("columnheader", { exact: true, name: "Your rating" })
			.waitFor({ state: "visible" });
		const row = savedView.getByRole("row").filter({ hasText: movieName });
		yield* row.getByRole("img", { name: "7.5 out of 10" }).waitFor({ state: "visible" });
	}).pipe(PlaywrightSpawner.withBrowser),
);

it.live(
	"reviews a logged completion through About and opens the review from its Reviewed badge",
	() =>
		Effect.gen(function* () {
			const { email, client, password } = yield* createAuthenticatedClient();
			const suffix = yield* randomUuid;
			const movieName = `Linked Movie ${suffix}`;
			const { movie } = yield* seedGlobalMovieWithCollection(client, {
				movieName,
				siblingName: `Linked Sequel ${suffix}`,
				collectionName: `Linked Collection ${suffix}`,
			});
			yield* insertLibraryMembership(client, { mediaEntityId: movie.id });
			yield* logMediaActivity(client, {
				submittedAt: nowIso(),
				submissionId: yield* randomUuid,
				entry: { kind: "complete", entityId: movie.id, when: { kind: "now" } },
			});
			const [completion] = yield* listEventsForEntity(client, movie.id, undefined, 100, {
				eventSchemaSlug: "complete",
			});
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
			yield* create.getByRole("button", { name: "About: Not a specific time" }).click();
			yield* media
				.getByRole("dialog", { name: "About" })
				.getByRole("radio", { name: /^Finished · / })
				.click();
			yield* create
				.getByRole("button", { name: /^About: Finished · / })
				.waitFor({ state: "visible" });
			yield* create.getByLabel("Rating (out of 100, optional)").fill("70");
			yield* create.getByRole("button", { exact: true, name: "Save review" }).click();
			yield* create.waitFor({ state: "hidden" });
			yield* media.getByRole("tab", { exact: true, name: "Activity" }).click();
			yield* media.getByText(/^About your watch on /).waitFor({ state: "visible" });
			const [review] = yield* listEventsForEntity(client, movie.id, undefined, 100, {
				eventSchemaSlug: "review",
			});
			expect(review?.properties).toEqual({ rating: 70, consumptionEventId: completion?.id });
			yield* media.getByRole("button", { exact: true, name: "Reviewed" }).click();
			const edit = media.getByRole("dialog", { name: "Edit review" });
			expect(yield* edit.getByLabel("Rating (out of 100, optional)").inputValue()).toBe("70");
			yield* edit
				.getByRole("button", { name: /^About: Finished · / })
				.waitFor({ state: "visible" });
		}).pipe(PlaywrightSpawner.withBrowser),
);
