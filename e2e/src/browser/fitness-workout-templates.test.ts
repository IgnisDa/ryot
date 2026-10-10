import { Effect } from "effect";
import { Playwright, PlaywrightSpawner } from "effect-playwright";

import { createAuthenticatedClient, getEntity } from "~/fixtures/kernel";
import {
	createExerciseEntityFixture,
	readWorkoutDetails,
	workoutEditorProServer,
} from "~/fixtures/plugins/fitness";
import { requirePresent } from "~/support/assertions";
import { signInThroughHostedOAuth } from "~/support/browser";
import { expect, it } from "~/support/effect-test";

it.live(
	"creates, edits and starts templates with media and preserves confirmed sets on replacement",
	() =>
		Effect.gen(function* () {
			const { apiUrl, frontendUrl } = yield* workoutEditorProServer;
			const { email, client, password } = yield* createAuthenticatedClient(apiUrl);
			const name = `Template acceptance ${crypto.randomUUID()}`;
			const exerciseName = `Bench ${name}`;
			const replacementName = `Press ${name}`;
			yield* createExerciseEntityFixture(client, { name: exerciseName });
			const replacement = yield* createExerciseEntityFixture(client, { name: replacementName });
			const page = yield* (yield* Playwright.Browser).newPage();
			yield* signInThroughHostedOAuth(page, email, password, { frontendUrl });
			yield* page.goto(`${frontendUrl}/v/p/ryot/fitness/all-workout-templates`);
			const frame = page.locator("iframe:visible").contentFrame();
			yield* frame.getByRole("button", { name: "Add", exact: true }).click();
			yield* frame.getByRole("textbox", { exact: true, name: "Name" }).fill(name);
			yield* frame.getByRole("button", { exact: true, name: "Add exercises" }).click();
			const picker = frame.getByRole("dialog", { exact: true, name: "Choose exercises" });
			yield* picker.getByRole("checkbox", { exact: true, name: exerciseName }).check();
			yield* picker.getByRole("button", { exact: true, name: "Add 1 exercise" }).click();
			const exercise = frame.getByRole("region", { exact: true, name: exerciseName });
			yield* exercise.getByRole("textbox", { exact: true, name: "Set 1 reps" }).fill("8");
			yield* exercise.getByRole("textbox", { exact: true, name: "Set 1 weight (kg)" }).fill("40");
			yield* exercise.getByText("Notes and RPE", { exact: false }).click();
			yield* exercise.getByRole("textbox", { exact: true, name: "Set 1 rest seconds" }).fill("0");
			yield* exercise
				.getByRole("textbox", { exact: true, name: "Set 1 note" })
				.fill("Keep the planned note");
			yield* frame.getByRole("button", { exact: true, name: "Template attachments (0)" }).click();
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
				.getByRole("button", { exact: true, name: "Template attachments (1)" })
				.waitFor({ state: "visible" });
			yield* frame.getByRole("button", { exact: true, name: "Save" }).click();
			yield* frame.getByRole("button", { exact: true, name: "Save template" }).click();
			yield* page.waitForURL((url) => url.pathname.startsWith("/e/"));
			yield* frame
				.getByRole("heading", { name, level: 1, exact: true })
				.waitFor({ state: "visible" });
			const templateId = requirePresent(
				new URL(page.url()).pathname.split("/").at(-1),
				"Expected the template URL",
			);
			yield* frame.getByRole("button", { exact: true, name: "Edit template" }).click();
			yield* frame.getByRole("textbox", { exact: true, name: "Name" }).fill(`${name} edited`);
			yield* frame.getByRole("button", { exact: true, name: "Save" }).click();
			yield* frame.getByRole("button", { exact: true, name: "Save template" }).click();
			yield* page.waitForURL((url) => url.pathname.startsWith("/e/"));
			yield* frame
				.getByRole("heading", { level: 1, exact: true, name: `${name} edited` })
				.waitFor({ state: "visible" });
			const savedTemplate = yield* getEntity(client, templateId);
			expect(savedTemplate.name).toBe(`${name} edited`);
			expect(savedTemplate.properties).toMatchObject({
				images: [{ type: "s3", key: expect.any(String) }],
			});
			yield* frame.getByRole("button", { exact: true, name: "Edit template" }).click();
			yield* frame.getByRole("button", { exact: true, name: "Template attachments (1)" }).click();
			yield* attachments.getByRole("button", { exact: true, name: "Remove image 1" }).click();
			yield* attachments.press("Escape");
			yield* frame.getByRole("button", { exact: true, name: "Cancel and discard" }).click();
			yield* frame.getByRole("button", { exact: true, name: "Discard draft" }).click();
			yield* frame.getByText("No active draft.", { exact: true }).waitFor({ state: "visible" });
			expect((yield* getEntity(client, templateId)).properties["images"]).toEqual(
				savedTemplate.properties["images"],
			);
			yield* page.goto(`${frontendUrl}/e/${templateId}`);
			yield* frame
				.getByRole("img", { exact: true, name: `${name} edited image 1` })
				.waitForFunction((image) => image instanceof HTMLImageElement && image.naturalWidth > 0);
			yield* frame.getByRole("button", { exact: true, name: "Start workout" }).click();
			yield* frame.getByRole("textbox", { exact: true, name: "Name" }).fill(`${name} performed`);
			yield* exercise.getByRole("button", { exact: true, name: "Confirm" }).click();
			yield* exercise.getByRole("button", { exact: true, name: "Replace" }).click();
			const replace = frame.getByRole("dialog", { exact: true, name: `Replace ${exerciseName}` });
			yield* replace.getByRole("checkbox", { exact: true, name: replacementName }).check();
			yield* replace.getByRole("button", { exact: true, name: "Replace exercise" }).click();
			const replaced = frame.getByRole("region", { exact: true, name: replacementName });
			expect(
				yield* replaced
					.getByRole("textbox", { exact: true, name: "Set 1 weight (kg)" })
					.inputValue(),
			).toBe("40");
			yield* replaced
				.getByRole("button", { exact: true, name: "Unconfirm" })
				.waitFor({ state: "visible" });
			yield* frame.getByRole("button", { exact: true, name: "Finish" }).click();
			yield* frame.getByRole("button", { exact: true, name: "Save workout" }).click();
			yield* page.waitForURL((url) => url.pathname.startsWith("/e/"));
			yield* frame
				.getByRole("heading", { level: 1, exact: true, name: `${name} performed` })
				.waitFor({ state: "visible" });
			const workoutId = requirePresent(
				new URL(page.url()).pathname.split("/").at(-1),
				"Expected the workout URL",
			);
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
			yield* frame.getByRole("textbox", { exact: true, name: "Name" }).fill(`${name} cloned`);
			yield* frame.getByRole("button", { exact: true, name: "Save" }).click();
			yield* frame.getByRole("button", { exact: true, name: "Save template" }).click();
			yield* page.waitForURL((url) => url.pathname.startsWith("/e/"));
			yield* frame
				.getByRole("heading", { level: 1, exact: true, name: `${name} cloned` })
				.waitFor({ state: "visible" });
		}).pipe(PlaywrightSpawner.withBrowser),
);
