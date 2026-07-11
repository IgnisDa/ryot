import { Effect, Fiber, Option, Stream } from "effect";
import { Playwright, PlaywrightSpawner } from "effect-playwright";

import { createTestUser } from "~/fixtures/kernel";
import { browserLayer, signInThroughHostedOAuth } from "~/support/browser";
import { beforeAll, expect, it } from "~/support/effect-test";
import { getFrontendUrl } from "~/support/harness-target";

const RUN_SETTLE_TIMEOUT_MS = 90_000;

let email: string;
let password: string;

const settingsSidebar = (page: Playwright.Page) => page.getByTestId("settings-sidebar");

const wizard = (page: Playwright.Page) =>
	page.getByRole("dialog", { name: "Restore from a backup" });

const downloadButton = (page: Playwright.Page) =>
	page.getByRole("button", { name: /^Download the backup from / });

const deleteButton = (page: Playwright.Page) =>
	page.getByRole("button", { name: /^Delete the backup record from / });

const openBackups = (page: Playwright.Page) =>
	Effect.gen(function* () {
		yield* page.goto(`${getFrontendUrl()}/settings/preferences`);
		yield* settingsSidebar(page).waitFor({ state: "visible" });
		yield* settingsSidebar(page).getByRole("link", { name: "Backups" }).click();
		yield* page.waitForURL((url) => url.pathname === "/settings/backups");
		yield* page.getByRole("heading", { level: 1, name: "Backups" }).waitFor();
	});

/**
 * The file field opens a detached `<input type="file">` on click, so the chooser has to be awaited
 * from the page's event stream rather than filled through a locator.
 */
const attachArchive = (page: Playwright.Page) =>
	Effect.gen(function* () {
		const chooser = yield* page
			.eventStream("filechooser")
			.pipe(Stream.runHead, Effect.forkChild({ startImmediately: true }));
		yield* wizard(page).getByRole("button", { name: "Choose a file for Backup archive" }).click();
		const picked = Option.getOrThrow(yield* Fiber.join(chooser));
		yield* picked.setFiles({
			name: "ryot-backup.zip",
			mimeType: "application/zip",
			buffer: Buffer.from([80, 75, 5, 6, ...Array.from({ length: 18 }, () => 0)]),
		});
		yield* wizard(page).getByText("Ready to restore").waitFor({ state: "visible" });
	});

const withBackupsBrowser = <E, R>(run: (page: Playwright.Page) => Effect.Effect<void, E, R>) =>
	Effect.gen(function* () {
		const browser = yield* Playwright.Browser;
		const page = yield* browser.newPage({ viewport: { width: 1280, height: 800 } });
		yield* signInThroughHostedOAuth(page, email, password);
		yield* run(page);
	});

beforeAll(async () => {
	await Effect.runPromise(
		Effect.gen(function* () {
			const user = yield* createTestUser();
			email = user.email;
			password = user.password;
		}),
	);
});

it.live("creates, downloads and deletes a backup from settings", () =>
	withBackupsBrowser((page) =>
		Effect.gen(function* () {
			yield* openBackups(page);
			yield* page.getByText("No backups yet").waitFor({ state: "visible" });

			yield* page.getByRole("button", { name: "Create a backup" }).first().click();

			// The list polls until the export leaves a non-terminal status.
			yield* page
				.getByText("Ready to download")
				.waitFor({ state: "visible", timeout: RUN_SETTLE_TIMEOUT_MS });
			expect(yield* page.getByText("Backup", { exact: true }).count).toBe(1);

			const download = yield* page
				.eventStream("download")
				.pipe(Stream.runHead, Effect.forkChild({ startImmediately: true }));
			yield* downloadButton(page).click();
			const saved = Option.getOrThrow(yield* Fiber.join(download));
			expect(saved.suggestedFilename()).toMatch(/^ryot-backup-.+\.zip$/);

			yield* deleteButton(page).click();
			const confirmation = page.getByRole("dialog", { name: "Delete this backup record?" });
			yield* confirmation.waitFor({ state: "visible" });
			yield* confirmation.getByRole("button", { name: "Delete record" }).click();

			yield* page.getByText("No backups yet").waitFor({ state: "visible" });
			expect(yield* downloadButton(page).count).toBe(0);
		}),
	).pipe(PlaywrightSpawner.withBrowser, Effect.provide(browserLayer)),
);

it.live("keeps the restore wizard in the URL so closing it returns to the list", () =>
	withBackupsBrowser((page) =>
		Effect.gen(function* () {
			yield* openBackups(page);
			yield* page.getByRole("button", { name: "Restore from a backup" }).click();
			yield* wizard(page).waitFor({ state: "visible" });
			yield* page.waitForURL((url) => url.searchParams.get("restore") === "true");
			yield* wizard(page).getByText("Step 1 of 2 · Choose your backup file").waitFor();

			yield* attachArchive(page);
			yield* wizard(page).getByRole("button", { name: "Continue to confirm the restore" }).click();
			yield* wizard(page).getByText("Step 2 of 2 · Confirm the restore").waitFor();

			yield* wizard(page).getByRole("button", { name: "Close the restore wizard" }).click();
			yield* wizard(page).waitFor({ state: "hidden" });
			yield* page.waitForURL((url) => !url.searchParams.has("restore"));
		}),
	).pipe(PlaywrightSpawner.withBrowser, Effect.provide(browserLayer)),
);
