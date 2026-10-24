import { reminderReadinessRecipe } from "@ryot-app/ryotql-recipes/reminders";
import { DateTime, Effect } from "effect";
import { Playwright, PlaywrightSpawner } from "effect-playwright";

import { createAuthenticatedClient } from "~/fixtures/kernel/auth";
import { exportAndDownloadBackup, restoreBackup } from "~/fixtures/kernel/backups";
import { createCollection } from "~/fixtures/kernel/collections";
import {
	createReminder,
	listReminders,
	reminderSubmission,
	runReminderScan,
} from "~/fixtures/kernel/reminders";
import { executeRyotQLRecipe } from "~/fixtures/kernel/ryotql";
import { createExerciseEntityFixture } from "~/fixtures/plugins/fitness";
import { mediaPluginFrame } from "~/fixtures/plugins/media/frame";
import { seedGlobalMovieWithCollection } from "~/fixtures/plugins/media/media";
import { assertCompleted, requirePresent } from "~/support/assertions";
import { signInThroughHostedOAuth } from "~/support/browser";
import { expect, it } from "~/support/effect-test";
import { getFrontendUrl } from "~/support/harness-target";

const visible = (locator: Playwright.Locator) => locator.waitFor({ state: "visible" });

it.live("manages entity reminders from media and fitness pages", () =>
	Effect.gen(function* () {
		const frontendUrl = getFrontendUrl();
		const { email, client, password } = yield* createAuthenticatedClient();
		const suffix = crypto.randomUUID();
		const media = yield* seedGlobalMovieWithCollection(client, {
			movieName: `Reminder movie ${suffix}`,
			siblingName: `Reminder sibling ${suffix}`,
			collectionName: `Reminder collection ${suffix}`,
		});
		const { exerciseId } = yield* createExerciseEntityFixture(client, {
			name: `Reminder exercise ${suffix}`,
		});
		const scheduledDateTime = DateTime.addDuration(yield* DateTime.now, 86_400_000);
		const wallTime = `${DateTime.formatIso(scheduledDateTime).slice(0, 19)}.${String(
			DateTime.toParts(scheduledDateTime).millisecond,
		).padStart(3, "0")}`;
		const dueAt = `${wallTime}Z`;
		const message = `Review this reminder ${suffix}`;
		const editedMessage = `Updated reminder ${suffix}`;

		const page = yield* (yield* Playwright.Browser).newPage({
			viewport: { width: 1280, height: 900 },
		});
		yield* signInThroughHostedOAuth(page, email, password);

		yield* page.goto(`${frontendUrl}/e/${media.movie.id}`);
		const mediaIframe = mediaPluginFrame(page, { visible: true });
		const mediaFrame = mediaIframe.contentFrame();
		yield* visible(
			mediaFrame.getByRole("heading", { level: 1, exact: true, name: media.movie.name }),
		);
		yield* mediaFrame.getByRole("button", { exact: true, name: "Reminders" }).click();
		const mediaHost = page.getByRole("dialog", { exact: true, name: "Reminders" });
		yield* visible(mediaHost.getByRole("button", { exact: true, name: "Close reminders" }));
		expect(yield* mediaIframe.getAttribute("inert")).not.toBeNull();
		yield* mediaHost.getByRole("button", { exact: true, name: "Close reminders" }).click();
		yield* mediaHost.waitFor({ state: "hidden" });
		expect(yield* mediaIframe.getAttribute("inert")).toBeNull();
		yield* mediaFrame.getByRole("button", { exact: true, name: "Reminders" }).click();
		yield* visible(mediaHost);
		yield* mediaHost.getByRole("button", { exact: true, name: "Close reminders" }).click();
		yield* mediaHost.waitFor({ state: "hidden" });

		yield* page.goto(`${frontendUrl}/e/${exerciseId}`);
		const fitnessIframe = page.locator("iframe:visible");
		const fitnessFrame = fitnessIframe.contentFrame();
		yield* visible(
			fitnessFrame.getByRole("heading", {
				level: 1,
				exact: true,
				name: `Reminder exercise ${suffix}`,
			}),
		);
		yield* fitnessFrame.getByRole("button", { exact: true, name: "Reminders" }).click();
		const host = page.getByRole("dialog", { exact: true, name: "Reminders" });
		yield* visible(host.getByRole("button", { exact: true, name: "Close reminders" }));
		expect(yield* fitnessIframe.getAttribute("inert")).not.toBeNull();

		yield* host.getByRole("button", { exact: true, name: "New reminder" }).click();
		const editor = page.getByRole("dialog", { exact: true, name: "Schedule reminder" });
		yield* visible(editor);
		yield* editor.getByLabel("Message", { exact: true }).fill(message);
		yield* editor.getByLabel("Date and time", { exact: true }).fill(wallTime);
		yield* editor.getByRole("button", { name: /^Timezone:/ }).click();
		const timezones = page.getByRole("dialog", { exact: true, name: "Timezone" });
		yield* timezones.getByLabel("Search Timezone", { exact: true }).fill("UTC");
		yield* timezones.getByRole("radio", { exact: true, name: "UTC" }).click();
		yield* editor.getByRole("button", { exact: true, name: "Schedule reminder" }).click();
		yield* editor.waitFor({ state: "hidden" });
		yield* visible(host.getByText(message, { exact: true }));
		expect(
			(yield* listReminders(client)).items.find((reminder) => reminder.message === message),
		).toMatchObject({ dueAt, message, timezone: "UTC", state: "scheduled", entityId: exerciseId });

		yield* host.getByRole("button", { exact: true, name: "Edit" }).click();
		const editDialog = page.getByRole("dialog", { exact: true, name: "Edit reminder" });
		yield* visible(editDialog);
		yield* editDialog.getByLabel("Message", { exact: true }).fill(editedMessage);
		yield* editDialog.getByRole("button", { exact: true, name: "Save reminder" }).click();
		yield* editDialog.waitFor({ state: "hidden" });
		yield* visible(host.getByText(editedMessage, { exact: true }));
		expect(
			(yield* listReminders(client)).items.find((reminder) => reminder.message === editedMessage),
		).toMatchObject({
			dueAt,
			timezone: "UTC",
			state: "scheduled",
			entityId: exerciseId,
			message: editedMessage,
		});

		yield* host.getByRole("button", { exact: true, name: "Close reminders" }).click();
		yield* host.waitFor({ state: "hidden" });
		expect(yield* fitnessIframe.getAttribute("inert")).toBeNull();
		yield* fitnessFrame.getByRole("button", { exact: true, name: "Reminders" }).click();
		yield* visible(host);
		yield* host.getByRole("button", { exact: true, name: "Close reminders" }).click();
		yield* host.waitFor({ state: "hidden" });

		const travelPage = yield* (yield* Playwright.Browser).newPage({
			timezoneId: "Asia/Tokyo",
			viewport: { width: 1280, height: 900 },
		});
		yield* signInThroughHostedOAuth(travelPage, email, password);
		yield* travelPage.goto(`${frontendUrl}/settings/reminders`);
		yield* visible(travelPage.getByRole("heading", { exact: true, name: "Reminders" }));
		yield* travelPage.getByRole("button", { exact: true, name: "Edit" }).click();
		const travelEditor = travelPage.getByRole("dialog", { exact: true, name: "Edit reminder" });
		yield* visible(travelEditor);
		expect(
			yield* travelEditor.getByRole("button", { exact: true, name: "Timezone: UTC" }).isVisible(),
		).toBe(true);
		yield* travelEditor.getByRole("button", { exact: true, name: "Save reminder" }).click();
		yield* travelEditor.waitFor({ state: "hidden" });
		expect(
			(yield* listReminders(client)).items.find((reminder) => reminder.message === editedMessage),
		).toMatchObject({
			dueAt,
			timezone: "UTC",
			state: "scheduled",
			entityId: exerciseId,
			message: editedMessage,
		});
		yield* travelPage.close;

		yield* page.goto(`${frontendUrl}/settings/reminders`);
		yield* visible(page.getByRole("heading", { exact: true, name: "Reminders" }));
		yield* visible(page.getByText(editedMessage, { exact: true }));
		yield* visible(page.getByRole("link", { exact: true, name: `Reminder exercise ${suffix}` }));
		yield* page.getByRole("button", { exact: true, name: "Cancel reminder" }).click();
		yield* page.getByRole("radio", { exact: true, name: "History" }).click();
		yield* visible(page.getByText(editedMessage, { exact: true }));
		yield* visible(page.getByText(/^Cancelled/));
		yield* page.getByRole("button", { exact: true, name: "Remove history" }).click();
		yield* page.getByText(editedMessage, { exact: true }).waitFor({ state: "hidden" });
		yield* visible(page.getByText("No reminders in this view.", { exact: true }));
		const remaining = yield* listReminders(client);
		expect(remaining.items.some((reminder) => reminder.message === editedMessage)).toBe(false);
	}).pipe(PlaywrightSpawner.withBrowser),
);

it.live("restores an imported reminder as needs-scheduling until it is rescheduled", () =>
	Effect.gen(function* () {
		const source = yield* createAuthenticatedClient();
		const entity = yield* createCollection(source.client);
		const originalDueAt = DateTime.formatIso(DateTime.addDuration(yield* DateTime.now, 86_400_000));
		const message = `Backup reminder ${crypto.randomUUID()}`;
		yield* createReminder(source.client, {
			...(yield* reminderSubmission),
			message,
			replaces: null,
			timezone: "UTC",
			entityId: entity.id,
			parentEntityId: null,
			dueAt: originalDueAt,
		});

		const { bytes } = yield* exportAndDownloadBackup(source.client);
		const destination = yield* createAuthenticatedClient();
		const readinessBefore = yield* executeRyotQLRecipe(
			destination.client,
			reminderReadinessRecipe(),
		);
		expect(readinessBefore.enabledChannels).toBe(0);
		const { run } = yield* restoreBackup(destination.client, bytes);
		assertCompleted(run, "reminder backup restore");
		const remindersAfterRestore = yield* listReminders(destination.client);
		expect(remindersAfterRestore.items).toHaveLength(1);
		const importedReminder = requirePresent(
			remindersAfterRestore.items.find((reminder) => reminder.message === message),
			"Restored reminder was not found",
		);
		expect(importedReminder).toMatchObject({
			message,
			dueAt: null,
			timezone: null,
			state: "needs-scheduling",
			originalSchedule: { dueAt: originalDueAt },
		});

		yield* runReminderScan(destination.client);
		const remindersAfterScan = yield* listReminders(destination.client);
		const scannedReminder = requirePresent(
			remindersAfterScan.items.find(({ id }) => id === importedReminder.id),
			"Reminder disappeared after the scan",
		);
		expect(scannedReminder).toMatchObject({
			message,
			dueAt: null,
			timezone: null,
			id: importedReminder.id,
			state: "needs-scheduling",
			originalSchedule: { dueAt: originalDueAt },
		});
		const readinessAfterRestore = yield* executeRyotQLRecipe(
			destination.client,
			reminderReadinessRecipe(),
		);
		expect(readinessAfterRestore.enabledChannels).toBe(0);
		expect(readinessAfterRestore.subscriptionEnabled).toBe(readinessBefore.subscriptionEnabled);

		const page = yield* (yield* Playwright.Browser).newPage({
			viewport: { width: 1280, height: 900 },
		});
		yield* signInThroughHostedOAuth(page, destination.email, destination.password);
		yield* page.goto(`${getFrontendUrl()}/settings/reminders`);
		yield* page.getByRole("radio", { exact: true, name: "Needs scheduling" }).click();
		yield* visible(page.getByText(message, { exact: true }));
		yield* page.getByRole("button", { exact: true, name: "Schedule reminder" }).click();
		const editor = page.getByRole("dialog", { exact: true, name: "Schedule reminder" });
		yield* visible(editor.getByText(/Original schedule:/));
		const messageField = editor.getByLabel("Message", { exact: true });
		expect(yield* messageField.inputValue()).toBe(message);
		const dateTimeField = editor.getByLabel("Date and time", { exact: true });
		expect(yield* dateTimeField.inputValue()).toBe("");

		const scheduledDateTime = DateTime.addDuration(yield* DateTime.now, 172_800_000);
		const wallTime = `${DateTime.formatIso(scheduledDateTime).slice(0, 19)}.${String(
			DateTime.toParts(scheduledDateTime).millisecond,
		).padStart(3, "0")}`;
		const dueAt = `${wallTime}Z`;
		yield* editor.getByRole("button", { name: /^Timezone:/ }).click();
		const timezones = page.getByRole("dialog", { exact: true, name: "Timezone" });
		yield* timezones.getByLabel("Search Timezone", { exact: true }).fill("UTC");
		yield* timezones.getByRole("radio", { exact: true, name: "UTC" }).click();
		yield* dateTimeField.fill(wallTime);
		yield* editor.getByRole("button", { exact: true, name: "Schedule reminder" }).click();
		yield* editor.waitFor({ state: "hidden" });
		yield* page.getByText(message, { exact: true }).waitFor({ state: "hidden" });
		yield* visible(page.getByText("No reminders in this view.", { exact: true }));

		const readinessAfterSchedule = yield* executeRyotQLRecipe(
			destination.client,
			reminderReadinessRecipe(),
		);
		expect(readinessAfterSchedule.enabledChannels).toBe(0);
		expect(readinessAfterSchedule.subscriptionEnabled).toBe(readinessBefore.subscriptionEnabled);
		const upcoming = page.getByRole("radio", { exact: true, name: "Upcoming" });
		yield* upcoming.click();
		yield* upcoming.waitForFunction((radio) => radio.getAttribute("aria-checked") === "true");
		yield* visible(page.getByText(message, { exact: true }));
		expect(yield* page.getByText(message, { exact: true }).count).toBe(1);
		yield* visible(
			page.getByTestId("shell-content").getByRole("link", { exact: true, name: entity.name }),
		);

		const remindersAfterSchedule = yield* listReminders(destination.client);
		const rescheduledReminder = requirePresent(
			remindersAfterSchedule.items.find(
				(reminder) => reminder.message === message && reminder.state === "scheduled",
			),
			"Rescheduled reminder was not found",
		);
		const cancelledReminder = requirePresent(
			remindersAfterSchedule.items.find(({ id }) => id === importedReminder.id),
			"Imported reminder was not found after rescheduling",
		);
		expect(rescheduledReminder.id).not.toBe(importedReminder.id);
		expect(rescheduledReminder).toMatchObject({
			dueAt,
			message,
			timezone: "UTC",
			state: "scheduled",
			entityId: importedReminder.entityId,
		});
		expect(cancelledReminder).toMatchObject({
			state: "cancelled",
			id: importedReminder.id,
			replacementId: rescheduledReminder.id,
		});
	}).pipe(PlaywrightSpawner.withBrowser),
);
