import { Effect } from "effect";
import { Playwright, PlaywrightSpawner } from "effect-playwright";

import { createAuthenticatedClient, getEntity } from "~/fixtures/kernel";
import {
	createExerciseEntityFixture,
	openFitnessPage,
	readWorkoutDetails,
	renameDraft,
	saveDraft,
	workoutEditorProServer,
} from "~/fixtures/plugins/fitness";
import { signInThroughHostedOAuth } from "~/support/browser";
import { expect, it } from "~/support/effect-test";

it.live(
	"creates, edits and starts templates with media and preserves confirmed sets on replacement",
	() =>
		Effect.gen(function* () {
			const { apiUrl, origin: frontendUrl } = yield* workoutEditorProServer;
			const { email, client, password } = yield* createAuthenticatedClient(apiUrl);
			const name = `Template acceptance ${crypto.randomUUID()}`;
			const exerciseName = `Bench ${name}`;
			const replacementName = `Press ${name}`;
			yield* createExerciseEntityFixture(client, { name: exerciseName });
			const replacement = yield* createExerciseEntityFixture(client, { name: replacementName });
			const page = yield* (yield* Playwright.Browser).newPage();
			yield* signInThroughHostedOAuth(page, email, password, { frontendUrl });
			const frame = yield* openFitnessPage(
				page,
				"/v/p/ryot/fitness/all-workout-templates",
				frontendUrl,
			);
			yield* frame.getByRole("button", { name: "Add", exact: true }).click();
			yield* renameDraft(frame, "Template details", name);
			yield* frame.getByRole("button", { exact: true, name: "Add exercises" }).click();
			const picker = frame.getByRole("dialog", {
				exact: true,
				includeHidden: true,
				name: "Add exercises",
			});
			yield* picker.getByRole("checkbox", { exact: true, name: exerciseName }).check();
			yield* picker.getByRole("button", { exact: true, name: "Add 1 exercise" }).click();
			yield* picker.waitFor({ state: "hidden" });
			const exercise = frame.getByRole("region", { exact: true, name: exerciseName });
			yield* exercise.getByRole("textbox", { exact: true, name: "Set 1 reps" }).fill("8");
			yield* exercise.getByRole("textbox", { exact: true, name: "Set 1 weight (kg)" }).fill("40");
			yield* exercise
				.getByRole("button", { exact: true, name: "Set 1, Normal. Set options" })
				.click();
			const setOptions = frame.getByRole("dialog", { exact: true, name: "Set 1" });
			yield* setOptions
				.getByRole("textbox", { exact: true, name: "Rest after this set" })
				.fill("0");
			yield* setOptions
				.getByRole("textbox", { exact: true, name: "Set note" })
				.fill("Keep the planned note");
			yield* setOptions.getByRole("button", { exact: true, name: "Done" }).click();
			yield* frame.getByRole("button", { exact: true, name: "Attachments (0)" }).click();
			const attachments = frame.getByRole("dialog", {
				exact: true,
				name: "Attachments for template",
			});
			yield* attachments
				.getByLabel("Upload image", { exact: true })
				.setInputFiles({
					name: "workout.svg",
					mimeType: "image/svg+xml",
					buffer: Buffer.from(
						'<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="blue"/></svg>',
					),
				});
			yield* attachments
				.getByRole("img", { exact: true, name: "template image 1" })
				.waitForFunction((image) => image instanceof HTMLImageElement && image.naturalWidth > 0);
			yield* attachments.press("Escape");
			yield* page.reload;
			yield* frame
				.getByRole("button", { exact: true, name: "Attachments (1)" })
				.waitFor({ state: "visible" });
			const templateId = yield* saveDraft(page, frame, { name, confirm: "Save template" });
			yield* frame.getByRole("button", { exact: true, name: "Edit template" }).click();
			yield* renameDraft(frame, "Template details", `${name} edited`);
			yield* saveDraft(page, frame, { name: `${name} edited`, confirm: "Save template" });
			const savedTemplate = yield* getEntity(client, templateId);
			expect(savedTemplate.name).toBe(`${name} edited`);
			expect(savedTemplate.properties).toMatchObject({
				images: [{ type: "s3", key: expect.any(String) }],
			});
			yield* frame.getByRole("button", { exact: true, name: "Edit template" }).click();
			yield* frame.getByRole("button", { exact: true, name: "Attachments (1)" }).click();
			yield* attachments.getByRole("button", { exact: true, name: "Remove image 1" }).click();
			yield* attachments.press("Escape");
			yield* frame.getByRole("button", { exact: true, name: "Discard changes" }).click();
			yield* frame
				.getByRole("dialog", { exact: true, name: "Discard changes?" })
				.getByRole("button", { exact: true, name: "Discard changes" })
				.click();
			yield* frame
				.getByText("No workout in progress", { exact: true })
				.waitFor({ state: "visible" });
			expect((yield* getEntity(client, templateId)).properties["images"]).toEqual(
				savedTemplate.properties["images"],
			);
			yield* page.goto(`${frontendUrl}/e/${templateId}`);
			yield* frame
				.getByRole("img", { exact: true, name: `${name} edited image 1` })
				.waitForFunction((image) => image instanceof HTMLImageElement && image.naturalWidth > 0);
			yield* frame.getByRole("button", { exact: true, name: "Start workout" }).click();
			yield* renameDraft(frame, "Workout details", `${name} performed`);
			yield* exercise.getByRole("button", { exact: true, name: "Complete set 1" }).click();
			expect(yield* exercise.textContent()).toContain("1/1 done");
			yield* exercise.getByRole("button", { exact: true, name: `${exerciseName} actions` }).click();
			yield* frame.getByRole("menuitem", { exact: true, name: "Replace exercise" }).click();
			const replace = frame.getByRole("dialog", { exact: true, name: `Replace ${exerciseName}` });
			yield* replace.getByRole("radio", { exact: true, name: replacementName }).click();
			yield* replace.getByRole("button", { exact: true, name: "Replace exercise" }).click();
			const replaced = frame.getByRole("region", { exact: true, name: replacementName });
			yield* replaced
				.getByRole("button", { exact: true, name: `Expand ${replacementName}` })
				.click();
			expect(
				yield* replaced
					.getByRole("textbox", { exact: true, name: "Set 1 weight (kg)" })
					.inputValue(),
			).toBe("40");
			yield* replaced
				.getByRole("button", { exact: true, pressed: true, name: "Complete set 1" })
				.waitFor({ state: "visible" });
			const workoutId = yield* saveDraft(page, frame, {
				review: "Finish",
				confirm: "Save workout",
				name: `${name} performed`,
			});
			const saved = yield* readWorkoutDetails(client, workoutId);
			expect(saved.exercises.items).toMatchObject([
				{
					id: replacement.exerciseId,
					sets: { items: [{ reps: 8, weight: 40, note: "Keep the planned note" }] },
				},
			]);
			yield* frame
				.getByRole("link", { exact: false, name: `Template: ${name} edited` })
				.waitFor({ state: "visible" });
			yield* frame.getByRole("button", { exact: true, name: "More workout actions" }).click();
			yield* frame.getByRole("menuitem", { exact: true, name: "Create template" }).click();
			yield* renameDraft(frame, "Template details", `${name} cloned`);
			yield* saveDraft(page, frame, { name: `${name} cloned`, confirm: "Save template" });
		}).pipe(PlaywrightSpawner.withBrowser),
);
