import { Effect } from "effect";
import { Playwright, PlaywrightSpawner } from "effect-playwright";

import { createAuthenticatedClient } from "~/fixtures/kernel";
import { createWorkoutEntityFixture } from "~/fixtures/plugins/fitness";
import { signInThroughHostedOAuth } from "~/support/browser";
import { it } from "~/support/effect-test";
import { getFrontendUrl } from "~/support/harness-target";

it.live("adds a saved workout to an existing collection and confirms permanent deletion", () =>
	Effect.gen(function* () {
		const { email, client, password } = yield* createAuthenticatedClient();
		const name = `Workout actions ${crypto.randomUUID()}`;
		const { workoutId } = yield* createWorkoutEntityFixture(client, { name });
		const collection = yield* client.call((c) =>
			c.collections.create({
				payload: {
					name: `Collection ${crypto.randomUUID()}`,
					fields: [{ type: "text", label: "Note", required: true, description: "Workout note" }],
				},
			}),
		);
		const page = yield* (yield* Playwright.Browser).newPage();
		yield* signInThroughHostedOAuth(page, email, password);
		yield* page.goto(`${getFrontendUrl()}/e/${workoutId}`);
		const frame = page.locator("iframe:visible").contentFrame();
		yield* frame.getByRole("button", { exact: true, name: "More workout actions" }).click();
		yield* frame.getByRole("menuitem", { exact: true, name: "Add to collection" }).click();
		yield* page.getByRole("button", { exact: true, name: collection.name }).click();
		const add = page.getByRole("dialog", { exact: true, name: `Add to ${collection.name}` });
		yield* add.getByRole("textbox", { exact: true, name: "Note" }).fill("Keep this workout");
		yield* add.getByRole("button", { exact: true, name: "Add to collection" }).click();
		yield* add.waitFor({ state: "hidden" });
		yield* frame.getByRole("button", { exact: true, name: "More workout actions" }).click();
		yield* frame.getByRole("menuitem", { exact: true, name: "Delete workout" }).click();
		const deletion = frame.getByRole("dialog", { exact: true, name: "Delete workout?" });
		yield* deletion.getByRole("button", { exact: true, name: "Cancel" }).click();
		yield* frame
			.getByRole("heading", { name, level: 1, exact: true })
			.waitFor({ state: "visible" });
		yield* frame.getByRole("button", { exact: true, name: "More workout actions" }).click();
		yield* frame.getByRole("menuitem", { exact: true, name: "Delete workout" }).click();
		yield* deletion.getByRole("button", { exact: true, name: "Delete workout" }).click();
		yield* page.waitForURL((url) => url.pathname === "/v/p/ryot/fitness/all-workouts");
	}).pipe(PlaywrightSpawner.withBrowser),
);
