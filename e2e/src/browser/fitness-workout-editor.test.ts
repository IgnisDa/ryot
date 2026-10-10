import { workoutListRecipe } from "@ryot-app/fitness-plugin/query-recipes";
import { Effect } from "effect";
import { Playwright, PlaywrightSpawner } from "effect-playwright";

import {
	createAuthenticatedClient,
	executeRyotQLRecipe,
	listEventsForEntity,
} from "~/fixtures/kernel";
import {
	createExerciseEntityFixture,
	createMeasurementMetric,
	createWorkoutTemplateEntityFixture,
	findFitnessEntitySchema,
	readWorkoutDetails,
	seedExerciseWorkout,
	updateExerciseOverrides,
} from "~/fixtures/plugins/fitness";
import { requirePresent } from "~/support/assertions";
import { signInThroughHostedOAuth } from "~/support/browser";
import { expect, it } from "~/support/effect-test";
import { getFrontendUrl } from "~/support/harness-target";

it.live("dismisses a workout overlay with an edge swipe without leaving the draft", () =>
	Effect.gen(function* () {
		const { email, password } = yield* createAuthenticatedClient();
		const page = yield* (yield* Playwright.Browser).newPage();
		yield* page.setViewportSize({ width: 390, height: 844 });
		yield* signInThroughHostedOAuth(page, email, password);
		yield* page.goto(`${getFrontendUrl()}/p/ryot/fitness/workouts/new`);
		const frame = page.locator("iframe:visible").contentFrame();
		yield* frame.getByRole("textbox", { exact: true, name: "Name" }).fill("Swipe recovery");
		yield* frame.getByRole("button", { exact: true, name: "Add exercises" }).click();
		const picker = frame.getByRole("dialog", { exact: true, name: "Choose exercises" });
		yield* picker.waitFor({ state: "visible" });
		yield* page.getByTestId("edge-gesture").waitFor({ state: "visible" });
		yield* page.use((raw) => raw.mouse.move(8, 400));
		yield* page.use((raw) => raw.mouse.down());
		yield* page.use((raw) => raw.mouse.move(240, 400, { steps: 12 }));
		yield* page.use((raw) => raw.mouse.up());
		yield* picker.waitFor({ state: "hidden" });
		expect(yield* frame.getByRole("textbox", { exact: true, name: "Name" }).inputValue()).toBe(
			"Swipe recovery",
		);
		expect(yield* page.getByRole("dialog", { exact: true, name: "Navigation" }).isVisible()).toBe(
			false,
		);
	}).pipe(PlaywrightSpawner.withBrowser),
);

it.live("retains a competing historical edit instead of overwriting a newer save", () =>
	Effect.gen(function* () {
		const { email, client, password } = yield* createAuthenticatedClient();
		const name = `Competing edit ${crypto.randomUUID()}`;
		const { exerciseId } = yield* createExerciseEntityFixture(client);
		const { workoutId } = yield* seedExerciseWorkout(client, {
			name,
			exerciseId,
			endedAt: "2026-10-01T11:00:00.000Z",
			startedAt: "2026-10-01T10:00:00.000Z",
			sets: [{ properties: { reps: 8, weight: 50 }, occurredAt: "2026-10-01T10:10:00.000Z" }],
		});
		const browser = yield* Playwright.Browser;
		const first = yield* browser.newPage();
		const second = yield* browser.newPage();
		for (const [page, editName] of [
			[first, `${name} first`],
			[second, `${name} second`],
		] as const) {
			yield* signInThroughHostedOAuth(page, email, password);
			yield* page.goto(`${getFrontendUrl()}/e/${workoutId}`);
			const frame = page.locator("iframe:visible").contentFrame();
			yield* frame.getByRole("button", { exact: true, name: "Edit" }).click();
			yield* frame.getByRole("textbox", { exact: true, name: "Name" }).fill(editName);
		}
		const firstFrame = first.locator("iframe:visible").contentFrame();
		yield* firstFrame.getByRole("button", { exact: true, name: "Save" }).click();
		yield* firstFrame.getByRole("button", { exact: true, name: "Save workout" }).click();
		yield* first.waitForURL(`${getFrontendUrl()}/e/${workoutId}`);
		const secondFrame = second.locator("iframe:visible").contentFrame();
		yield* secondFrame.getByRole("button", { exact: true, name: "Save" }).click();
		yield* secondFrame.getByRole("button", { exact: true, name: "Save workout" }).click();
		yield* secondFrame
			.getByText("The saved record changed.", { exact: false })
			.waitFor({ state: "visible" });
		expect(
			yield* secondFrame.getByRole("textbox", { exact: true, name: "Name" }).inputValue(),
		).toBe(`${name} second`);
		expect((yield* readWorkoutDetails(client, workoutId)).name).toBe(`${name} first`);
	}).pipe(PlaywrightSpawner.withBrowser),
);

it.live("keeps independently saved zero measurements when the workout is discarded", () =>
	Effect.gen(function* () {
		const { email, client, password } = yield* createAuthenticatedClient();
		const metric = yield* createMeasurementMetric(client, { name: "Weight" });
		const page = yield* (yield* Playwright.Browser).newPage();
		yield* signInThroughHostedOAuth(page, email, password);
		yield* page.goto(`${getFrontendUrl()}/p/ryot/fitness/workouts/new`);
		const frame = page.locator("iframe:visible").contentFrame();
		yield* frame.getByRole("button", { exact: true, name: "Log measurement" }).click();
		const measurement = frame.getByRole("dialog", { exact: true, name: "Log measurement" });
		yield* measurement.getByLabel("Weight (kg)", { exact: true }).fill("0");
		yield* measurement.getByLabel("Comment (optional)").fill("Saved independently");
		yield* measurement.getByRole("button", { exact: true, name: "Save" }).click();
		yield* measurement.waitFor({ state: "hidden" });
		yield* frame.getByRole("button", { exact: true, name: "Cancel and discard" }).click();
		yield* frame.getByRole("button", { exact: true, name: "Discard draft" }).click();
		const readings = yield* listEventsForEntity(client, metric.entityId, undefined, 100);
		expect(readings).toMatchObject([{ properties: { value: 0, comment: "Saved independently" } }]);
		yield* page.goto(`${getFrontendUrl()}/v/p/ryot/fitness/all-measurements`);
		yield* frame.getByText("Saved independently", { exact: true }).waitFor({ state: "visible" });
	}).pipe(PlaywrightSpawner.withBrowser),
);

it.live("retries a committed workout after a lost response and reload without duplicating it", () =>
	Effect.gen(function* () {
		const { email, client, password } = yield* createAuthenticatedClient();
		const name = `Recovery workout ${crypto.randomUUID()}`;
		const first = `First ${name}`;
		const second = `Second ${name}`;
		for (const exerciseName of [first, second]) {
			const { exerciseId } = yield* createExerciseEntityFixture(client, { name: exerciseName });
			yield* updateExerciseOverrides(client, {
				exerciseId,
				remove: [],
				set: { normalRestTime: 0 },
			});
		}
		const page = yield* (yield* Playwright.Browser).newPage();
		yield* signInThroughHostedOAuth(page, email, password);
		yield* page.goto(`${getFrontendUrl()}/v/p/ryot/fitness/all-workouts`);
		const frame = page.locator("iframe:visible").contentFrame();
		yield* frame.getByRole("button", { exact: true, name: "Add" }).click();
		yield* frame.getByRole("textbox", { exact: true, name: "Name" }).fill(name);
		yield* frame.getByRole("button", { exact: true, name: "Add exercises" }).click();
		const picker = frame.getByRole("dialog", { exact: true, name: "Choose exercises" });
		for (const exerciseName of [first, second]) {
			yield* picker.getByRole("searchbox", { name: "Search exercises" }).fill(exerciseName);
			yield* picker.getByRole("checkbox", { exact: true, name: exerciseName }).check();
		}
		yield* picker.getByRole("button", { exact: true, name: "Add 2 exercises" }).click();
		for (const exerciseName of [first, second]) {
			const exercise = frame.getByRole("region", { exact: true, name: exerciseName });
			yield* exercise.getByRole("textbox", { exact: true, name: "Set 1 reps" }).fill("0");
			yield* exercise.getByRole("textbox", { exact: true, name: "Set 1 weight (kg)" }).fill("0");
			yield* exercise.getByRole("button", { exact: true, name: "Confirm" }).click();
		}
		yield* frame.getByRole("button", { exact: true, name: "Reorder" }).click();
		const reorder = frame.getByRole("dialog", { exact: true, name: "Reorder exercises" });
		yield* reorder.getByRole("button", { exact: true, name: `Reorder ${second}` }).press("ArrowUp");
		yield* reorder.getByRole("button", { exact: true, name: "Done" }).click();
		yield* page.goto(`${getFrontendUrl()}/settings/import-data`);
		yield* page.getByRole("button", { exact: true, name: "Resume workout" }).click();
		yield* frame.getByRole("textbox", { exact: true, name: "Name" }).waitFor({ state: "visible" });
		expect(yield* frame.getByRole("textbox", { exact: true, name: "Name" }).inputValue()).toBe(
			name,
		);
		yield* frame.getByRole("button", { exact: true, name: "Finish" }).click();
		yield* page.use((native) =>
			native.route(
				"**/api/plugins/ryot/fitness/operations/workout-editor-save",
				// oxlint-disable-next-line effecttsgo/async-function -- Playwright owns this network callback.
				async (route) => {
					await route.fetch();
					await route.abort("connectionfailed");
				},
				{ times: 1 },
			),
		);
		yield* frame.getByRole("button", { exact: true, name: "Save workout" }).click();
		yield* frame
			.getByText("This action could not be completed.", { exact: false })
			.waitFor({ state: "visible" });
		yield* frame.getByRole("button", { exact: true, name: "Continue editing" }).last().click();
		expect(yield* frame.getByRole("textbox", { exact: true, name: "Name" }).isDisabled()).toBe(
			true,
		);
		const { pluginId } = yield* findFitnessEntitySchema(client, "workout");
		const recipe = workoutListRecipe({ limit: 100, reference: { pluginId, kind: "local" } });
		const committed = (yield* executeRyotQLRecipe(client, recipe)).items.filter(
			(item) => item.name === name,
		);
		expect(committed).toHaveLength(1);
		yield* page.reload;
		yield* frame.getByRole("button", { exact: true, name: "Retry save" }).click();
		yield* page.waitForURL((url) => url.pathname.startsWith("/e/"));
		yield* frame
			.getByRole("heading", { name, level: 1, exact: true })
			.waitFor({ state: "visible" });
		const workoutId = requirePresent(
			new URL(page.url()).pathname.split("/").at(-1),
			"Expected the saved workout URL",
		);
		const saved = yield* readWorkoutDetails(client, workoutId);
		expect(committed[0]?.id).toBe(workoutId);
		expect(
			(yield* executeRyotQLRecipe(client, recipe)).items.filter((item) => item.name === name),
		).toHaveLength(1);
		const sets = saved.exercises.items
			.flatMap((exercise) => exercise.sets.items.map((set) => ({ ...set, name: exercise.name })))
			.sort((a, b) => (a.exerciseOrder ?? 0) - (b.exerciseOrder ?? 0));
		expect(sets).toMatchObject([
			{ reps: 0, weight: 0, name: second, exerciseOrder: 0 },
			{ reps: 0, weight: 0, name: first, exerciseOrder: 1 },
		]);
		expect(yield* page.getByRole("button", { exact: true, name: "Resume workout" }).count).toBe(0);
	}).pipe(PlaywrightSpawner.withBrowser),
);

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
		yield* page.getByRole("link", { exact: true, name: "All Workouts" }).click();
		yield* page.waitForURL(`${getFrontendUrl()}/v/p/ryot/fitness/all-workouts`);
		yield* page.getByRole("button", { exact: true, name: "Resume workout" }).click();
		yield* page.waitForURL(`${getFrontendUrl()}/p/ryot/fitness/workout-editor`);
		yield* frame.getByRole("textbox", { exact: true, name: "Name" }).waitFor({ state: "visible" });
		yield* page.reload;
		yield* frame.getByRole("textbox", { exact: true, name: "Name" }).waitFor({ state: "visible" });
		expect(yield* frame.getByRole("textbox", { exact: true, name: "Name" }).inputValue()).toBe(
			`${name} repeated`,
		);
		yield* frame.getByRole("button", { exact: true, name: "Confirm" }).click();
		yield* frame.getByRole("button", { exact: true, name: "Finish" }).click();
		yield* frame.getByRole("button", { exact: true, name: "Save workout" }).click();
		yield* page.waitForURL((url) => url.pathname.startsWith("/e/"));
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
		yield* page.waitForURL((url) => url.pathname.startsWith("/e/"));
		yield* frame
			.getByRole("heading", { level: 1, exact: true, name: `${name} edited` })
			.waitFor({ state: "visible" });
		const savedId = requirePresent(
			new URL(page.url()).pathname.split("/").at(-1),
			"Expected a saved workout URL",
		);
		const beforeCorrection = yield* readWorkoutDetails(client, savedId);
		yield* frame.getByRole("button", { exact: true, name: "More workout actions" }).click();
		yield* frame.getByRole("menuitem", { exact: true, name: "Adjust time" }).click();
		const correction = frame.getByRole("dialog", { exact: true, name: "Adjust workout time" });
		yield* correction.getByLabel("End time", { exact: true }).fill("2030-01-01T00:00");
		yield* correction.getByRole("button", { exact: true, name: "Save time correction" }).click();
		yield* correction.waitFor({ state: "hidden" });
		const corrected = yield* readWorkoutDetails(client, savedId);
		expect(corrected.startedAt).toBe(beforeCorrection.startedAt);
		expect(corrected.endedAt).not.toBe(beforeCorrection.endedAt);
		expect(corrected.activeDuration).toBe(beforeCorrection.activeDuration);
		expect(
			corrected.exercises.items.flatMap(({ sets }) =>
				sets.items.map(({ id, confirmedAt }) => ({ id, confirmedAt })),
			),
		).toEqual(
			beforeCorrection.exercises.items.flatMap(({ sets }) =>
				sets.items.map(({ id, confirmedAt }) => ({ id, confirmedAt })),
			),
		);
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
		yield* frame.getByRole("button", { exact: true, name: "Add" }).click();
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
		yield* frame.getByText("No active draft.", { exact: true }).waitFor({ state: "visible" });
		yield* page.goto(`${getFrontendUrl()}/e/${workoutTemplateId}`);
		yield* frame.getByRole("button", { exact: false, name: "Edit template" }).click();
		yield* frame
			.getByText("Editing a saved workout.", { exact: false })
			.count.pipe(Effect.map((count) => expect(count).toBe(0)));
		yield* frame
			.getByText("Plan a reusable session.", { exact: false })
			.waitFor({ state: "visible" });
	}).pipe(PlaywrightSpawner.withBrowser),
);
