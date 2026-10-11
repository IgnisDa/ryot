import { Effect } from "effect";
import { Playwright, PlaywrightSpawner } from "effect-playwright";

import { createAuthenticatedClient } from "~/fixtures/kernel";
import { createWorkoutTemplateEntityFixture } from "~/fixtures/plugins/fitness";
import { signInThroughHostedOAuth } from "~/support/browser";
import { it } from "~/support/effect-test";
import { getFrontendUrl } from "~/support/harness-target";

it.live("adds a workout template to a collection and confirms permanent deletion", () =>
	Effect.gen(function* () {
		const { email, client, password } = yield* createAuthenticatedClient();
		const name = `Template actions ${crypto.randomUUID()}`;
		const { workoutTemplateId } = yield* createWorkoutTemplateEntityFixture(client, { name });
		const collection = yield* client.call((c) =>
			c.collections.create({ payload: { name: `Collection ${crypto.randomUUID()}` } }),
		);
		const page = yield* (yield* Playwright.Browser).newPage();
		yield* signInThroughHostedOAuth(page, email, password);
		yield* page.goto(`${getFrontendUrl()}/e/${workoutTemplateId}`);
		const frame = page.locator("iframe:visible").contentFrame();
		const more = frame.getByRole("button", { exact: true, name: "More template actions" });
		yield* more.click();
		yield* frame.getByRole("menuitem", { exact: true, name: "Add to collection" }).click();
		yield* page.getByRole("button", { exact: true, name: collection.name }).click();
		const add = page.getByRole("dialog", { exact: true, name: `Add to ${collection.name}` });
		yield* add.getByRole("button", { exact: true, name: "Add to collection" }).click();
		yield* add.waitFor({ state: "hidden" });
		const manager = page.getByRole("dialog", { exact: true, name: `Collections for ${name}` });
		yield* manager
			.getByRole("button", { name: new RegExp(`${collection.name}.*Added`) })
			.waitFor({ state: "visible" });
		yield* manager.getByRole("button", { exact: true, name: "Done" }).click();
		yield* manager.waitFor({ state: "hidden" });
		yield* more.click();
		yield* frame.getByRole("menuitem", { exact: true, name: "Delete template" }).click();
		const deletion = frame.getByRole("dialog", { exact: true, name: "Delete template?" });
		yield* deletion.getByRole("button", { exact: true, name: "Delete template" }).click();
		yield* page.waitForURL((url) => url.pathname === "/v/p/ryot/fitness/all-workout-templates");
	}).pipe(PlaywrightSpawner.withBrowser),
);
