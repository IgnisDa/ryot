import { DateTime, Effect } from "effect";
import { Playwright, PlaywrightSpawner } from "effect-playwright";

import { createAuthenticatedClient } from "~/fixtures/kernel";
import {
	createExerciseEntityFixture,
	createWorkoutEntityFixture,
	openFitnessPage,
	seedExerciseWorkout,
} from "~/fixtures/plugins/fitness";
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

it.live("narrows the workouts list by a Started filter and keeps it after reload", () =>
	Effect.gen(function* () {
		const { email, client, password } = yield* createAuthenticatedClient();
		const suffix = crypto.randomUUID();
		const recent = `Recent workout ${suffix}`;
		const old = `Old workout ${suffix}`;
		const yesterday = DateTime.subtract(yield* DateTime.now, { days: 1 });
		yield* createWorkoutEntityFixture(client, {
			name: recent,
			startedAt: DateTime.formatIso(yesterday),
			endedAt: DateTime.formatIso(DateTime.add(yesterday, { hours: 1 })),
		});
		yield* createWorkoutEntityFixture(client, { name: old });
		const page = yield* (yield* Playwright.Browser).newPage();
		yield* signInThroughHostedOAuth(page, email, password);
		const frame = yield* openFitnessPage(page, "/v/p/ryot/fitness/all-workouts");
		yield* frame.getByRole("link", { name: old, exact: true }).waitFor({ state: "visible" });
		yield* frame.getByRole("link", { exact: true, name: recent }).waitFor({ state: "visible" });
		yield* frame.getByRole("button", { name: /^Filters/ }).click();
		const dialog = frame.getByRole("dialog", { exact: true, name: "Filters" });
		yield* dialog.getByRole("button", { name: /^Add filter/ }).click();
		yield* frame.getByRole("radio", { exact: true, name: "Started" }).click();
		yield* dialog.getByRole("button", { name: /^Filter 1 operator/ }).click();
		yield* frame.getByRole("radio", { name: "is within the last (days)" }).click();
		yield* dialog.getByRole("spinbutton", { name: "Started days" }).fill("7");
		yield* page.keyboard.press("Escape");
		yield* dialog.waitFor({ state: "hidden" });
		yield* frame
			.getByRole("button", { exact: true, name: "Filters, 1 active filter" })
			.waitFor({ state: "visible" });
		yield* frame.getByRole("link", { name: old, exact: true }).waitFor({ state: "detached" });
		yield* frame.getByRole("link", { exact: true, name: recent }).waitFor({ state: "visible" });
		yield* page.reload;
		yield* frame
			.getByRole("button", { exact: true, name: "Filters, 1 active filter" })
			.waitFor({ state: "visible" });
		yield* frame.getByRole("link", { exact: true, name: recent }).waitFor({ state: "visible" });
		yield* frame.getByRole("link", { name: old, exact: true }).waitFor({ state: "detached" });
	}).pipe(PlaywrightSpawner.withBrowser),
);

it.live("narrows the workouts list by an Exercises filter", () =>
	Effect.gen(function* () {
		const { email, client, password } = yield* createAuthenticatedClient();
		const suffix = crypto.randomUUID();
		const startedAt = DateTime.formatIso(DateTime.subtract(yield* DateTime.now, { days: 1 }));
		const sets = [{ occurredAt: startedAt, properties: { reps: 5, weight: 100 } }];
		const squat = yield* createExerciseEntityFixture(client, { name: `Squat ${suffix}` });
		const press = yield* createExerciseEntityFixture(client, { name: `Press ${suffix}` });
		const legs = `Legs workout ${suffix}`;
		const push = `Push workout ${suffix}`;
		yield* seedExerciseWorkout(client, {
			sets,
			startedAt,
			name: legs,
			exerciseId: squat.exerciseId,
		});
		yield* seedExerciseWorkout(client, {
			sets,
			startedAt,
			name: push,
			exerciseId: press.exerciseId,
		});
		const page = yield* (yield* Playwright.Browser).newPage();
		yield* signInThroughHostedOAuth(page, email, password);
		const frame = yield* openFitnessPage(page, "/v/p/ryot/fitness/all-workouts");
		yield* frame.getByRole("link", { name: legs, exact: true }).waitFor({ state: "visible" });
		yield* frame.getByRole("link", { name: push, exact: true }).waitFor({ state: "visible" });
		yield* frame.getByRole("button", { name: /^Filters/ }).click();
		const dialog = frame.getByRole("dialog", { exact: true, name: "Filters" });
		yield* dialog.getByRole("button", { name: /^Add filter/ }).click();
		yield* frame.getByRole("radio", { exact: true, name: "Exercises" }).click();
		yield* dialog.getByRole("button", { name: /^Exercises values/ }).click();
		const picker = frame.getByRole("dialog", { exact: true, name: "Exercises" });
		yield* picker.getByRole("textbox", { name: "Search Exercises" }).fill(suffix);
		yield* picker.getByRole("checkbox", { name: squat.exercise.name }).check();
		yield* picker.getByRole("button", { exact: true, name: "Done" }).click();
		yield* page.keyboard.press("Escape");
		yield* dialog.waitFor({ state: "hidden" });
		yield* frame
			.getByRole("button", { exact: true, name: "Filters, 1 active filter" })
			.waitFor({ state: "visible" });
		yield* frame.getByRole("link", { name: push, exact: true }).waitFor({ state: "detached" });
		yield* frame.getByRole("link", { name: legs, exact: true }).waitFor({ state: "visible" });
	}).pipe(PlaywrightSpawner.withBrowser),
);
