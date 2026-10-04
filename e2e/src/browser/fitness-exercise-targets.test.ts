import { Effect } from "effect";
import { Playwright, PlaywrightSpawner } from "effect-playwright";

import { createAuthenticatedClient } from "~/fixtures/kernel";
import { createExerciseEntityFixture } from "~/fixtures/plugins/fitness";
import { signInThroughHostedOAuth } from "~/support/browser";
import { expect, it } from "~/support/effect-test";
import { getFrontendUrl } from "~/support/harness-target";

const visible = (locator: Playwright.Locator) => locator.waitFor({ state: "visible" });

const targetPicker = (page: Playwright.Page) =>
	page.getByRole("dialog", { exact: true, name: "Choose Exercise Target" });

it.live("creates a private target inline while creating a custom exercise", () =>
	Effect.gen(function* () {
		const { email, password } = yield* createAuthenticatedClient();
		const exerciseName = `Cuff raise ${crypto.randomUUID()}`;
		const page = yield* (yield* Playwright.Browser).newPage();
		yield* signInThroughHostedOAuth(page, email, password);
		yield* page.goto(`${getFrontendUrl()}/p/ryot/fitness/exercises/new`);
		const frame = page.locator("iframe:visible").contentFrame();

		yield* frame.getByLabel("Name", { exact: true }).fill(exerciseName);
		yield* frame.getByRole("radio", { exact: true, name: "reps_and_weight" }).click();
		yield* frame.getByRole("button", { exact: true, name: "Add Exercise Targets" }).click();

		const picker = targetPicker(page);
		yield* picker.getByLabel("Search", { exact: true }).fill("Rotator Cuff");
		yield* picker.getByRole("button", { exact: true, name: 'Create "Rotator Cuff"' }).click();
		const form = picker.getByRole("form", { exact: true, name: "New Exercise Target" });
		expect(yield* form.getByLabel("Name", { exact: true }).inputValue()).toBe("Rotator Cuff");
		yield* form.getByRole("button", { exact: true, name: "Create" }).click();
		yield* visible(form.getByText("Kind is required", { exact: true }));
		yield* form.getByRole("radio", { exact: true, name: "tendon" }).click();
		yield* form.getByRole("button", { exact: true, name: "Create" }).click();
		yield* picker.waitFor({ state: "hidden" });

		yield* visible(frame.getByText("Rotator Cuff", { exact: true }));
		yield* frame.getByRole("button", { exact: true, name: "Save" }).click();
		yield* page.waitForURL((url) => url.pathname.startsWith("/e/"));
		const detail = page.locator("iframe:visible").contentFrame();
		yield* visible(detail.getByRole("heading", { level: 1, exact: true, name: exerciseName }));
		yield* visible(detail.getByText("Rotator Cuff", { exact: true }));
	}).pipe(PlaywrightSpawner.withBrowser),
);

it.live("imports a not-yet-materialized catalog target and then lists it as existing", () =>
	Effect.gen(function* () {
		const { email, client, password } = yield* createAuthenticatedClient();
		const exerciseName = `Neck curl ${crypto.randomUUID()}`;
		const { exerciseId } = yield* createExerciseEntityFixture(client, { name: exerciseName });
		const page = yield* (yield* Playwright.Browser).newPage();
		yield* signInThroughHostedOAuth(page, email, password);
		yield* page.goto(`${getFrontendUrl()}/p/ryot/fitness/exercises/${exerciseId}/edit`);
		const frame = page.locator("iframe:visible").contentFrame();
		yield* visible(frame.getByLabel("Name", { exact: true }));

		yield* frame.getByRole("button", { exact: true, name: "Add Exercise Targets" }).click();
		const picker = targetPicker(page);
		yield* picker.getByLabel("Search", { exact: true }).fill("Neck");
		const catalog = picker.getByRole("region", {
			exact: true,
			name: "Exercise Target Fitness Catalog",
		});
		yield* catalog.getByRole("button", { exact: true, name: "Add Neck" }).click();
		yield* picker.waitFor({ state: "hidden" });

		yield* visible(frame.getByText("Neck", { exact: true }));
		yield* frame.getByRole("button", { exact: true, name: "Save" }).click();
		yield* page.waitForURL((url) => url.pathname === `/e/${exerciseId}`);
		const detail = page.locator("iframe:visible").contentFrame();
		yield* visible(detail.getByRole("heading", { level: 1, exact: true, name: exerciseName }));
		yield* visible(detail.getByText("Neck", { exact: true }));

		yield* page.goto(`${getFrontendUrl()}/p/ryot/fitness/exercises/${exerciseId}/edit`);
		yield* frame.getByRole("button", { exact: true, name: "Add Exercise Targets" }).click();
		yield* picker.getByLabel("Search", { exact: true }).fill("Neck");
		yield* visible(
			picker
				.getByRole("region", { exact: true, name: "Existing" })
				.getByRole("button", { exact: true, name: "Neck" }),
		);
		yield* visible(catalog.getByText('No other results for "Neck".', { exact: true }));
		expect(yield* catalog.getByRole("button", { exact: true, name: "Add Neck" }).count).toBe(0);
	}).pipe(PlaywrightSpawner.withBrowser),
);
