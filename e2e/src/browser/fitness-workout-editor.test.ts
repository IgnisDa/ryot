import { Effect } from "effect";
import { Playwright, PlaywrightSpawner } from "effect-playwright";

import { createAuthenticatedClient } from "~/fixtures/kernel";
import {
	createExerciseEntityFixture,
	createWorkoutTemplateEntityFixture,
	seedExerciseWorkout,
} from "~/fixtures/plugins/fitness";
import { signInThroughHostedOAuth } from "~/support/browser";
import { expect, it } from "~/support/effect-test";
import { getFrontendUrl } from "~/support/harness-target";

it.live("repeats, recovers, saves and edits a workout through registered Fitness pages", () =>
	Effect.gen(function* () {
		const { email, client, password } = yield* createAuthenticatedClient();
		const name = `Browser workout ${crypto.randomUUID()}`;
		const { exerciseId } = yield* createExerciseEntityFixture(client, { name: `Bench ${name}` });
		const { workoutId } = yield* seedExerciseWorkout(client, {
			name,
			exerciseId,
			endedAt: "2026-10-01T11:00:00.000Z",
			startedAt: "2026-10-01T10:00:00.000Z",
			sets: [{ properties: { reps: 8, weight: 50 }, occurredAt: "2026-10-01T10:10:00.000Z" }],
		});
		const browser = yield* Playwright.Browser;
		const page = yield* browser.newPage();
		yield* signInThroughHostedOAuth(page, email, password);
		yield* page.goto(`${getFrontendUrl()}/e/${workoutId}`);
		const frame = page.locator("iframe:visible").contentFrame();
		yield* frame.getByRole("button", { exact: true, name: "Repeat workout" }).click();
		yield* frame.getByRole("textbox", { exact: true, name: "Name" }).fill(`${name} repeated`);
		yield* page.reload;
		yield* frame.getByRole("textbox", { exact: true, name: "Name" }).waitFor({ state: "visible" });
		expect(yield* frame.getByRole("textbox", { exact: true, name: "Name" }).inputValue()).toBe(
			`${name} repeated`,
		);
		yield* frame.getByRole("button", { exact: true, name: "Confirm" }).click();
		yield* frame.getByRole("button", { exact: true, name: "Finish" }).click();
		yield* frame.getByRole("button", { exact: true, name: "Save workout" }).click();
		yield* frame
			.getByRole("heading", { level: 1, exact: true, name: `${name} repeated` })
			.waitFor({ state: "visible" });
		yield* frame
			.getByRole("link", { exact: false, name: `Repeated from ${name}` })
			.waitFor({ state: "visible" });
		yield* frame.getByText("Active duration", { exact: true }).waitFor({ state: "visible" });
		yield* frame.getByRole("button", { exact: true, name: "Edit" }).click();
		yield* frame.getByRole("textbox", { exact: true, name: "Name" }).fill(`${name} edited`);
		yield* frame.getByRole("button", { exact: true, name: "Save" }).click();
		yield* frame.getByRole("button", { exact: true, name: "Save workout" }).click();
		yield* frame
			.getByRole("heading", { level: 1, exact: true, name: `${name} edited` })
			.waitFor({ state: "visible" });
	}).pipe(PlaywrightSpawner.withBrowser),
);

it.live("starts workouts from list Add and templates while guarding another draft", () =>
	Effect.gen(function* () {
		const { email, client, password } = yield* createAuthenticatedClient();
		const name = `Template browser ${crypto.randomUUID()}`;
		const { workoutTemplateId } = yield* createWorkoutTemplateEntityFixture(client, { name });
		const browser = yield* Playwright.Browser;
		const page = yield* browser.newPage();
		yield* signInThroughHostedOAuth(page, email, password);
		yield* page.goto(`${getFrontendUrl()}/v/p/ryot/fitness/all-workouts`);
		const frame = page.locator("iframe:visible").contentFrame();
		yield* frame.getByRole("button", { exact: true, name: "Add to this view" }).click();
		yield* frame.getByRole("textbox", { exact: true, name: "Name" }).fill("Retained new workout");
		yield* page.goto(`${getFrontendUrl()}/e/${workoutTemplateId}`);
		yield* frame.getByRole("button", { exact: true, name: "Start workout" }).click();
		yield* frame
			.getByRole("dialog", { exact: true, name: "Existing draft" })
			.waitFor({ state: "visible" });
		yield* frame.getByRole("button", { exact: true, name: "Resume draft" }).click();
		expect(yield* frame.getByRole("textbox", { exact: true, name: "Name" }).inputValue()).toBe(
			"Retained new workout",
		);
		yield* page.goto(`${getFrontendUrl()}/e/${workoutTemplateId}`);
		yield* frame.getByRole("button", { exact: true, name: "Start workout" }).click();
		yield* frame
			.getByRole("button", { exact: true, name: "Discard and start requested action" })
			.click();
		yield* frame.getByRole("textbox", { exact: true, name: "Name" }).waitFor({ state: "visible" });
		expect(yield* frame.getByRole("textbox", { exact: true, name: "Name" }).inputValue()).toBe(
			name,
		);
		yield* frame.getByRole("button", { exact: true, name: "Cancel and discard" }).click();
		yield* frame.getByRole("button", { exact: true, name: "Discard draft" }).click();
		yield* page.goto(`${getFrontendUrl()}/e/${workoutTemplateId}`);
		yield* frame.getByRole("button", { exact: true, name: "Edit template (Pro)" }).click();
		yield* frame
			.getByText("Editing a saved workout.", { exact: false })
			.count.pipe(Effect.map((count) => expect(count).toBe(0)));
		yield* frame
			.getByText("Plan a reusable session.", { exact: false })
			.waitFor({ state: "visible" });
	}).pipe(PlaywrightSpawner.withBrowser),
);
