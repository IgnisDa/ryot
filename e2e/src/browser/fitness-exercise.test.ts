import { Effect, Fiber, Option, Stream } from "effect";
import { Playwright, PlaywrightSpawner } from "effect-playwright";

import {
	createAuthenticatedClient,
	getEntity,
	pollUntil,
	seedPopulatedEntity,
} from "~/fixtures/kernel";
import {
	createExerciseEntityFixture,
	createWorkoutTemplateEntityFixture,
	findFitnessEntitySchema,
	openFitnessPage,
	readWorkoutDetails,
	seedExerciseWorkout,
} from "~/fixtures/plugins/fitness";
import { signInThroughHostedOAuth } from "~/support/browser";
import { expect, it } from "~/support/effect-test";
import { getFrontendUrl } from "~/support/harness-target";

const visible = (locator: Playwright.Locator) => locator.waitFor({ state: "visible" });

it.live("shows exercise history and manages private notes", () =>
	Effect.gen(function* () {
		const frontendUrl = getFrontendUrl();
		const { email, client, password } = yield* createAuthenticatedClient();
		const id = crypto.randomUUID();
		const { exerciseId } = yield* createExerciseEntityFixture(client, {
			name: `Detail bench ${id}`,
		});
		yield* seedExerciseWorkout(client, {
			exerciseId,
			name: `Push day ${id}`,
			endedAt: "2026-06-30T14:00:00.000Z",
			startedAt: "2026-06-30T13:00:00.000Z",
			sets: [
				{ properties: { reps: 8, weight: 90 }, occurredAt: "2026-06-30T13:00:00.000Z" },
				{ properties: { reps: 5, weight: 100 }, occurredAt: "2026-06-30T13:05:00.000Z" },
			],
		});

		const browser = yield* Playwright.Browser;
		const page = yield* browser.newPage();
		yield* signInThroughHostedOAuth(page, email, password);
		yield* page.goto(`${frontendUrl}/e/${exerciseId}`);
		const detail = page.locator("iframe").contentFrame();

		yield* visible(
			detail.getByRole("heading", { level: 1, exact: true, name: `Detail bench ${id}` }),
		);
		yield* visible(detail.getByRole("heading", { level: 2, exact: true, name: "Your history" }));
		yield* visible(detail.getByText("Total reps", { exact: true }));
		yield* visible(detail.getByText("13", { exact: true }));
		yield* visible(detail.getByRole("link", { exact: true, name: `Push day ${id}` }));

		yield* detail.getByLabel("New note").fill(`  Keep elbows tucked ${id}  `);
		yield* detail.getByRole("radio", { exact: true, name: "4 stars" }).click();
		yield* detail.getByRole("button", { exact: true, name: "Save note" }).click();
		yield* visible(detail.getByText(`Keep elbows tucked ${id}`, { exact: true }));
		yield* visible(detail.getByRole("img", { name: "Rated 4 of 5" }));

		yield* detail.getByRole("button", { exact: true, name: "Edit note" }).click();
		yield* detail.getByLabel("Edit note", { exact: true }).fill(`Wrist neutral ${id}`);
		yield* detail.getByRole("button", { exact: true, name: "Save" }).click();
		yield* visible(detail.getByText(`Wrist neutral ${id}`, { exact: true }));
		expect(yield* detail.getByText(`Keep elbows tucked ${id}`, { exact: true }).count).toBe(0);

		yield* detail.getByRole("button", { exact: true, name: "Delete note" }).click();
		yield* detail.getByRole("button", { exact: true, name: "Delete note" }).last().click();
		yield* detail.getByText(`Wrist neutral ${id}`, { exact: true }).waitFor({ state: "detached" });
		expect(yield* detail.getByText(`Wrist neutral ${id}`, { exact: true }).count).toBe(0);
	}).pipe(PlaywrightSpawner.withBrowser),
);

const openActionsMenu = (detail: Playwright.FrameLocator) =>
	detail.getByRole("button", { exact: true, name: "More exercise actions" }).click();

it.live("offers the same menu actions for global and custom exercises", () =>
	Effect.gen(function* () {
		const frontendUrl = getFrontendUrl();
		const { email, client, password } = yield* createAuthenticatedClient();
		const id = crypto.randomUUID();
		const { exerciseId: customId } = yield* createExerciseEntityFixture(client, {
			name: `Custom action ${id}`,
		});
		const { schema } = yield* findFitnessEntitySchema(client, "exercise");
		const global = yield* seedPopulatedEntity({
			providerId: null,
			name: `Global action ${id}`,
			entitySchema: schema.reference,
			externalId: `global-action-${id}`,
			properties: { kind: "reps_and_weight" },
		});

		const browser = yield* Playwright.Browser;
		const page = yield* browser.newPage();
		yield* signInThroughHostedOAuth(page, email, password);
		const detail = page.locator("iframe").contentFrame();

		for (const [exerciseId, name, editable] of [
			[customId, `Custom action ${id}`, true],
			[global.id, `Global action ${id}`, false],
		] as const) {
			yield* page.goto(`${frontendUrl}/e/${exerciseId}`);
			yield* visible(detail.getByRole("heading", { name, level: 1, exact: true }));
			expect(yield* detail.getByRole("button", { exact: true, name: "Edit" }).count).toBe(
				editable ? 1 : 0,
			);
			expect(
				yield* detail.getByRole("button", { exact: true, name: "Add to current workout" }).count,
			).toBe(0);
			yield* visible(detail.getByRole("button", { exact: true, name: "Add to collection" }));
			yield* openActionsMenu(detail);
			const items = [
				"Preferences",
				"Post a review",
				"Duplicate",
				...(editable ? ["Merge into…"] : []),
			];
			for (const item of items) {
				yield* visible(detail.getByRole("menuitem", { name: item, exact: true }));
			}
			expect(yield* detail.getByRole("menuitem").count).toBe(items.length);
		}
	}).pipe(PlaywrightSpawner.withBrowser),
);

it.live("adds the exercise to the current workout draft", () =>
	Effect.gen(function* () {
		const frontendUrl = getFrontendUrl();
		const { email, client, password } = yield* createAuthenticatedClient();
		const name = `Draft add ${crypto.randomUUID()}`;
		const { exerciseId } = yield* createExerciseEntityFixture(client, { name });

		const browser = yield* Playwright.Browser;
		const page = yield* browser.newPage();
		yield* signInThroughHostedOAuth(page, email, password);
		const frame = yield* openFitnessPage(page, "/p/ryot/fitness/workouts/new", frontendUrl);
		yield* visible(frame.getByRole("button", { exact: true, name: "Add exercises" }));

		yield* page.goto(`${frontendUrl}/e/${exerciseId}`);
		yield* visible(frame.getByRole("heading", { name, level: 1, exact: true }));
		yield* frame.getByRole("button", { exact: true, name: "Add to current workout" }).click();
		yield* visible(frame.getByRole("region", { name, exact: true }));
		expect(yield* frame.getByRole("region", { name, exact: true }).count).toBe(1);
	}).pipe(PlaywrightSpawner.withBrowser),
);

it.live("saves exercise preferences and focuses the note composer for a review", () =>
	Effect.gen(function* () {
		const frontendUrl = getFrontendUrl();
		const { email, client, password } = yield* createAuthenticatedClient();
		const name = `Preference ${crypto.randomUUID()}`;
		const { exerciseId } = yield* createExerciseEntityFixture(client, { name });

		const browser = yield* Playwright.Browser;
		const page = yield* browser.newPage();
		yield* signInThroughHostedOAuth(page, email, password);
		yield* page.goto(`${frontendUrl}/e/${exerciseId}`);
		const detail = page.locator("iframe").contentFrame();
		yield* visible(detail.getByRole("heading", { name, level: 1, exact: true }));

		yield* openActionsMenu(detail);
		yield* detail.getByRole("menuitem", { exact: true, name: "Preferences" }).click();
		const sheet = detail.getByRole("dialog", { exact: true, name: "Exercise preferences" });
		yield* sheet.getByRole("textbox", { exact: true, name: "Normal rest (seconds)" }).fill("45");
		yield* sheet.getByRole("button", { exact: true, name: "Save defaults" }).click();
		yield* sheet.waitFor({ state: "hidden" });

		yield* openActionsMenu(detail);
		yield* detail.getByRole("menuitem", { exact: true, name: "Preferences" }).click();
		yield* visible(sheet);
		expect(
			yield* sheet
				.getByRole("textbox", { exact: true, name: "Normal rest (seconds)" })
				.inputValue(),
		).toBe("45");
		yield* sheet.getByRole("button", { exact: true, name: "Cancel" }).click();
		yield* sheet.waitFor({ state: "hidden" });

		yield* openActionsMenu(detail);
		yield* detail.getByRole("menuitem", { exact: true, name: "Post a review" }).click();
		const composer = detail.getByLabel("New note");
		yield* visible(composer);
		expect(
			yield* composer.evaluate((element) => element === element.ownerDocument.activeElement),
		).toBe(true);
	}).pipe(PlaywrightSpawner.withBrowser),
);

const PIXEL_PNG = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==",
	"base64",
);

const fieldValue = (frame: Playwright.FrameLocator, label: string) =>
	frame.getByLabel(label, { exact: true }).inputValue();

it.live("duplicates an exercise into a pre-filled editor and adds it to the library", () =>
	Effect.gen(function* () {
		const frontendUrl = getFrontendUrl();
		const { email, client, password } = yield* createAuthenticatedClient();
		const id = crypto.randomUUID();
		const { exerciseId } = yield* createExerciseEntityFixture(client, { name: `Dup source ${id}` });

		const browser = yield* Playwright.Browser;
		const page = yield* browser.newPage();
		yield* signInThroughHostedOAuth(page, email, password);
		yield* page.goto(`${frontendUrl}/e/${exerciseId}`);
		const frame = page.locator("iframe:visible").contentFrame();
		yield* visible(frame.getByRole("heading", { level: 1, exact: true, name: `Dup source ${id}` }));
		yield* openActionsMenu(frame);
		yield* frame.getByRole("menuitem", { exact: true, name: "Duplicate" }).click();

		yield* visible(frame.getByLabel("Name", { exact: true }));
		expect(yield* fieldValue(frame, "Name")).toBe(`Dup source ${id}`);
		yield* frame.getByLabel("Name", { exact: true }).fill(`Dup copy ${id}`);
		yield* frame.getByRole("button", { exact: true, name: "Save" }).click();
		yield* visible(frame.getByRole("heading", { level: 1, exact: true, name: `Dup copy ${id}` }));

		yield* page.goto(`${frontendUrl}/p/ryot/fitness/workouts/new`);
		yield* frame.getByRole("button", { exact: true, name: "Add exercises" }).click();
		const picker = frame.getByRole("dialog", { exact: true, name: "Add exercises" });
		yield* visible(picker.getByRole("checkbox", { exact: true, name: `Dup copy ${id}` }));
	}).pipe(PlaywrightSpawner.withBrowser),
);

it.live("edits the name, targets, and images while keeping the kind read-only", () =>
	Effect.gen(function* () {
		const frontendUrl = getFrontendUrl();
		const { email, client, password } = yield* createAuthenticatedClient();
		const id = crypto.randomUUID();
		const { exerciseId } = yield* createExerciseEntityFixture(client, { name: `Edit me ${id}` });
		const { schema: targetSchema } = yield* findFitnessEntitySchema(client, "exercise-target");
		yield* seedPopulatedEntity({
			providerId: null,
			name: `Edit target ${id}`,
			properties: { kind: "muscle" },
			externalId: `edit-target-${id}`,
			entitySchema: targetSchema.reference,
		});

		const browser = yield* Playwright.Browser;
		const page = yield* browser.newPage();
		yield* signInThroughHostedOAuth(page, email, password);
		yield* page.goto(`${frontendUrl}/e/${exerciseId}`);
		const frame = page.locator("iframe:visible").contentFrame();
		yield* visible(frame.getByRole("heading", { level: 1, exact: true, name: `Edit me ${id}` }));
		yield* frame.getByRole("button", { exact: true, name: "Edit" }).click();

		yield* visible(frame.getByLabel("Name", { exact: true }));
		expect(
			yield* frame.getByRole("radio", { exact: true, name: "reps_and_weight" }).isDisabled(),
		).toBe(true);
		yield* frame.getByLabel("Name", { exact: true }).fill(`Edited ${id}`);

		yield* frame.getByRole("button", { exact: true, name: "Add Exercise Targets" }).click();
		const picker = page.getByRole("dialog", { exact: true, name: "Choose Exercise Target" });
		yield* picker.getByLabel("Search", { exact: true }).fill(`Edit target ${id}`);
		yield* picker.getByRole("button", { exact: true, name: `Edit target ${id}` }).click();
		yield* visible(frame.getByText(`Edit target ${id}`, { exact: true }));
		yield* frame.getByRole("radio", { exact: true, name: "primary" }).click();

		const chooser = yield* page
			.eventStream("filechooser")
			.pipe(Stream.runHead, Effect.forkChild({ startImmediately: true }));
		yield* frame.getByRole("button", { exact: true, name: "Add Images" }).click();
		const picked = Option.getOrThrow(yield* Fiber.join(chooser));
		yield* picked.setFiles({ name: "photo.png", buffer: PIXEL_PNG, mimeType: "image/png" });
		yield* visible(frame.getByRole("button", { exact: true, name: "Remove Images 2" }));

		yield* frame.getByRole("button", { exact: true, name: "Save" }).click();
		yield* visible(frame.getByRole("heading", { level: 1, exact: true, name: `Edited ${id}` }));

		yield* frame.getByRole("button", { exact: true, name: "Edit" }).click();
		yield* visible(frame.getByLabel("Name", { exact: true }));
		expect(yield* fieldValue(frame, "Name")).toBe(`Edited ${id}`);
		yield* visible(frame.getByText(`Edit target ${id}`, { exact: true }));
		yield* visible(frame.getByRole("button", { exact: true, name: "Remove Images 2" }));
		expect(
			yield* frame.getByRole("radio", { exact: true, name: "reps_and_weight" }).isDisabled(),
		).toBe(true);
	}).pipe(PlaywrightSpawner.withBrowser),
);

it.live("merges a custom exercise into another, moving history, records, and templates", () =>
	Effect.gen(function* () {
		const frontendUrl = getFrontendUrl();
		const { email, client, password } = yield* createAuthenticatedClient();
		const id = crypto.randomUUID();
		const { exerciseId: sourceId } = yield* createExerciseEntityFixture(client, {
			name: `Merge source ${id}`,
		});
		const { exerciseId: targetId } = yield* createExerciseEntityFixture(client, {
			name: `Merge target ${id}`,
		});
		const { workoutId } = yield* seedExerciseWorkout(client, {
			exerciseId: sourceId,
			name: `Merge push day ${id}`,
			endedAt: "2026-06-30T14:00:00.000Z",
			startedAt: "2026-06-30T13:00:00.000Z",
			sets: [
				{ properties: { reps: 8, weight: 90 }, occurredAt: "2026-06-30T13:00:00.000Z" },
				{ properties: { reps: 5, weight: 100 }, occurredAt: "2026-06-30T13:05:00.000Z" },
			],
		});
		yield* pollUntil(
			"records for the source workout",
			readWorkoutDetails(client, workoutId).pipe(
				Effect.map(({ exercises }) => {
					const sets = exercises.items.flatMap((exercise) => exercise.sets.items);
					return sets.length > 0 && sets.every((set) => set.recordStatus === "ready") ? sets : null;
				}),
			),
		);
		const { workoutTemplateId } = yield* createWorkoutTemplateEntityFixture(client, {
			exerciseId: sourceId,
		});

		const browser = yield* Playwright.Browser;
		const page = yield* browser.newPage();
		yield* signInThroughHostedOAuth(page, email, password);
		yield* page.goto(`${frontendUrl}/e/${sourceId}`);
		const frame = page.locator("iframe:visible").contentFrame();
		yield* visible(
			frame.getByRole("heading", { level: 1, exact: true, name: `Merge source ${id}` }),
		);
		yield* visible(frame.getByText("Personal bests", { exact: true }));
		yield* openActionsMenu(frame);
		yield* frame.getByRole("menuitem", { exact: true, name: "Merge into…" }).click();

		const picker = frame.getByRole("dialog", {
			exact: true,
			name: `Merge Merge source ${id} into…`,
		});
		yield* visible(picker.getByRole("radio", { exact: true, name: `Merge target ${id}` }));
		expect(
			yield* picker.getByRole("radio", { exact: true, name: `Merge source ${id}` }).count,
		).toBe(0);
		yield* picker.getByRole("radio", { exact: true, name: `Merge target ${id}` }).click();
		yield* picker.getByRole("button", { exact: true, name: "Merge into" }).click();
		const confirmation = frame.getByRole("dialog", { exact: true, name: "Merge exercise?" });
		yield* visible(confirmation);
		yield* confirmation.getByRole("button", { exact: true, name: "Merge" }).click();

		yield* visible(
			frame.getByRole("heading", { level: 1, exact: true, name: `Merge target ${id}` }),
		);
		yield* visible(frame.getByRole("link", { exact: true, name: `Merge push day ${id}` }));
		yield* visible(frame.getByText("13", { exact: true }));
		yield* pollUntil(
			"records for the moved sets",
			readWorkoutDetails(client, workoutId).pipe(
				Effect.map(({ exercises }) => {
					const sets = exercises.items.flatMap((exercise) => exercise.sets.items);
					return sets.length === 2 &&
						sets.every(
							(set) =>
								set.exerciseId === targetId &&
								set.recordStatus === "ready" &&
								set.personalBests?.includes("weight") !== undefined,
						)
						? sets
						: null;
				}),
			),
		);
		yield* page.reload;
		yield* visible(frame.getByText("Personal bests", { exact: true }));
		yield* visible(frame.getByText("Heaviest weight", { exact: true }));
		yield* visible(frame.getByText("100 kg", { exact: true }).first());

		const template = yield* getEntity(client, workoutTemplateId);
		expect(template.properties).toMatchObject({ exercises: [{ exerciseId: targetId }] });

		yield* page.goto(`${frontendUrl}/v/p/ryot/fitness/all-exercises`);
		yield* visible(frame.getByText(`Merge target ${id}`, { exact: true }));
		expect(yield* frame.getByText(`Merge source ${id}`, { exact: true }).count).toBe(0);
	}).pipe(PlaywrightSpawner.withBrowser),
);
