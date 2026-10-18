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
	discardDraft,
	draftHeading,
	findFitnessEntitySchema,
	openFitnessPage,
	readWorkoutDetails,
	renameDraft,
	saveDraft,
	seedExerciseWorkout,
	submitDraft,
	updateExerciseOverrides,
} from "~/fixtures/plugins/fitness";
import { requirePresent } from "~/support/assertions";
import { pluginFrame, signInThroughHostedOAuth } from "~/support/browser";
import { expect, it } from "~/support/effect-test";
import { getFrontendUrl } from "~/support/harness-target";

const WORKOUT_DETAILS = "Workout details";

it.live("dismisses a workout overlay with an edge swipe without leaving the draft", () =>
	Effect.gen(function* () {
		const { email, password } = yield* createAuthenticatedClient();
		const page = yield* (yield* Playwright.Browser).newPage();
		yield* page.setViewportSize({ width: 390, height: 844 });
		yield* signInThroughHostedOAuth(page, email, password);
		const frame = yield* openFitnessPage(page, "/p/ryot/fitness/workouts/new");
		yield* frame.getByRole("button", { exact: false, name: "Edit workout details" }).click();
		const details = frame.getByRole("dialog", { exact: true, name: WORKOUT_DETAILS });
		yield* details.getByRole("textbox", { exact: true, name: "Name" }).fill("Swipe recovery");
		yield* details.getByRole("button", { exact: true, name: "Done" }).click();
		yield* frame.getByRole("button", { exact: true, name: "Add exercises" }).click();
		const picker = frame.getByRole("dialog", {
			exact: true,
			includeHidden: true,
			name: "Add exercises",
		});
		yield* picker.waitFor({ state: "visible" });
		yield* page.getByTestId("edge-gesture").waitFor({ state: "visible" });
		yield* page.use((raw) => raw.mouse.move(8, 400));
		yield* page.use((raw) => raw.mouse.down());
		yield* page.use((raw) => raw.mouse.move(240, 400, { steps: 12 }));
		yield* page.use((raw) => raw.mouse.up());
		yield* picker.waitFor({ state: "hidden" });
		yield* frame
			.getByRole("button", { exact: true, name: "Edit workout details, Swipe recovery" })
			.waitFor({ state: "visible" });
		yield* page
			.getByRole("dialog", { exact: true, name: "Navigation" })
			.waitFor({ state: "hidden" });
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
			const frame = yield* openFitnessPage(page, `/e/${workoutId}`);
			yield* frame.getByRole("button", { exact: true, name: "Edit" }).click();
			yield* renameDraft(frame, WORKOUT_DETAILS, editName);
		}
		const firstFrame = pluginFrame(first);
		yield* saveDraft(first, firstFrame, { name: `${name} first`, confirm: "Save workout" });
		const secondFrame = pluginFrame(second);
		yield* submitDraft(secondFrame, { confirm: "Save workout" });
		yield* secondFrame
			.getByText("This workout changed elsewhere", { exact: true })
			.waitFor({ state: "visible" });
		yield* draftHeading(secondFrame, `${name} second`).waitFor({ state: "visible" });
		expect((yield* readWorkoutDetails(client, workoutId)).name).toBe(`${name} first`);
	}).pipe(PlaywrightSpawner.withBrowser),
);

it.live("keeps independently saved zero measurements when the workout is discarded", () =>
	Effect.gen(function* () {
		const { email, client, password } = yield* createAuthenticatedClient();
		const metric = yield* createMeasurementMetric(client, { name: "Weight" });
		const page = yield* (yield* Playwright.Browser).newPage();
		yield* signInThroughHostedOAuth(page, email, password);
		const frame = yield* openFitnessPage(page, "/p/ryot/fitness/workouts/new");
		yield* frame.getByRole("button", { exact: true, name: "Log measurement" }).click();
		const measurement = frame.getByRole("dialog", { exact: true, name: "Log measurement" });
		yield* measurement.getByLabel("Weight (kg)", { exact: true }).fill("0");
		yield* measurement.getByLabel(/Comment\s*\(optional\)/).fill("Saved independently");
		yield* measurement.getByRole("button", { exact: true, name: "Save" }).click();
		yield* measurement.waitFor({ state: "hidden" });
		yield* discardDraft(frame);
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
		const frame = yield* openFitnessPage(page, "/v/p/ryot/fitness/all-workouts");
		yield* frame.getByRole("button", { exact: true, name: "Add" }).click();
		yield* renameDraft(frame, WORKOUT_DETAILS, name);
		yield* frame.getByRole("button", { exact: true, name: "Add exercises" }).click();
		const picker = frame.getByRole("dialog", {
			exact: true,
			includeHidden: true,
			name: "Add exercises",
		});
		for (const exerciseName of [first, second]) {
			yield* picker.getByRole("searchbox", { name: "Search exercises" }).fill(exerciseName);
			yield* picker.getByRole("checkbox", { exact: true, name: exerciseName }).check();
		}
		yield* picker.getByRole("button", { exact: true, name: "Add 2 exercises" }).click();
		yield* picker.waitFor({ state: "hidden" });
		for (const exerciseName of [first, second]) {
			const exercise = frame.getByRole("region", { exact: true, name: exerciseName });
			yield* exercise.getByRole("textbox", { exact: true, name: "Set 1 reps" }).fill("0");
			yield* exercise.getByRole("textbox", { exact: true, name: "Set 1 weight (kg)" }).fill("0");
			yield* exercise.getByRole("button", { exact: true, name: "Complete set 1" }).click();
			expect(yield* exercise.textContent()).toContain("1/1 done");
		}
		yield* frame.getByRole("button", { exact: true, name: "Reorder" }).click();
		const reorder = frame.getByRole("dialog", {
			exact: true,
			includeHidden: true,
			name: "Reorder exercises",
		});
		yield* reorder.getByRole("button", { exact: true, name: `Reorder ${second}` }).press("ArrowUp");
		yield* reorder.waitFor({ state: "hidden" });
		yield* page.goto(`${getFrontendUrl()}/settings/import-data`);
		yield* page.getByRole("button", { exact: true, name: "Resume workout" }).click();
		yield* draftHeading(frame, name).waitFor({ state: "visible" });
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
		yield* frame.getByRole("button", { exact: true, name: "Keep logging" }).last().click();
		yield* frame
			.getByRole("button", { exact: true, disabled: true, name: "Details" })
			.waitFor({ state: "visible" });
		const { pluginId } = yield* findFitnessEntitySchema(client, "workout");
		const recipe = workoutListRecipe({ limit: 100, reference: { pluginId, kind: "local" } });
		const committed = (yield* executeRyotQLRecipe(client, recipe)).items.filter(
			(item) => item.name === name,
		);
		expect(committed).toHaveLength(1);
		yield* page.reload;
		yield* frame.getByRole("button", { exact: true, name: "Retry save" }).click();
		yield* page.waitForURL((url) => url.pathname.startsWith("/e/"));
		yield* draftHeading(frame, name).waitFor({ state: "visible" });
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
		const frame = yield* openFitnessPage(page, `/e/${workoutId}`);
		yield* frame.getByRole("button", { exact: true, name: "Repeat workout" }).click();
		yield* renameDraft(frame, WORKOUT_DETAILS, `${name} repeated`);
		yield* page.getByRole("link", { exact: true, name: "All Workouts" }).click();
		yield* page.waitForURL(`${getFrontendUrl()}/v/p/ryot/fitness/all-workouts`);
		yield* page.getByRole("button", { exact: true, name: "Resume workout" }).click();
		yield* page.waitForURL(`${getFrontendUrl()}/p/ryot/fitness/workout-editor`);
		yield* draftHeading(frame, `${name} repeated`).waitFor({ state: "visible" });
		yield* page.reload;
		yield* draftHeading(frame, `${name} repeated`).waitFor({ state: "visible" });
		yield* frame.getByRole("button", { exact: true, name: "Complete set 1" }).click();
		yield* saveDraft(page, frame, {
			review: "Finish",
			confirm: "Save workout",
			name: `${name} repeated`,
		});
		yield* frame
			.getByRole("link", { exact: false, name: `Repeated from ${name}` })
			.waitFor({ state: "visible" });
		yield* frame.getByText("Active duration", { exact: true }).waitFor({ state: "visible" });
		yield* frame.getByRole("button", { exact: true, name: "Edit" }).click();
		yield* renameDraft(frame, WORKOUT_DETAILS, `${name} edited`);
		const savedId = yield* saveDraft(page, frame, {
			name: `${name} edited`,
			confirm: "Save workout",
		});
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
		const frame = yield* openFitnessPage(page, "/v/p/ryot/fitness/all-workouts");
		yield* frame.getByRole("button", { exact: true, name: "Add" }).click();
		yield* renameDraft(frame, WORKOUT_DETAILS, "Retained new workout");
		yield* page.goto(`${getFrontendUrl()}/e/${workoutTemplateId}`);
		yield* frame.getByRole("button", { exact: true, name: "Start workout" }).click();
		const guard = frame.getByRole("dialog", {
			exact: true,
			name: "You have a workout in progress",
		});
		yield* guard.waitFor({ state: "visible" });
		yield* guard.getByRole("button", { exact: true, name: "Resume workout" }).click();
		yield* draftHeading(frame, "Retained new workout").waitFor({ state: "visible" });
		yield* page.goto(`${getFrontendUrl()}/e/${workoutTemplateId}`);
		yield* frame.getByRole("button", { exact: true, name: "Start workout" }).click();
		yield* guard.getByRole("button", { exact: true, name: "Discard and start" }).click();
		yield* draftHeading(frame, name).waitFor({ state: "visible" });
		yield* discardDraft(frame);
		yield* frame.getByText("No workout in progress", { exact: true }).waitFor({ state: "visible" });
		yield* page.goto(`${getFrontendUrl()}/e/${workoutTemplateId}`);
		yield* frame.getByRole("button", { exact: false, name: "Edit template" }).click();
		yield* frame.getByText("Planning a template", { exact: true }).waitFor({ state: "visible" });
		expect(yield* frame.getByText("Editing a saved workout", { exact: true }).count).toBe(0);
	}).pipe(PlaywrightSpawner.withBrowser),
);
