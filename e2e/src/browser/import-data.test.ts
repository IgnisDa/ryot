import { Effect, Fiber, FileSystem, Option, Schema, Stream } from "effect";
import { Playwright, PlaywrightSpawner } from "effect-playwright";

import {
	createTestUser,
	importIssuesExportSchema,
	installTestHarvestHandleImportPlugin,
	installTestImportPinningPlugin,
	type InstalledTestPlugin,
	uninstallTestPlugin,
} from "~/fixtures/kernel";
import { signInThroughHostedOAuth } from "~/support/browser";
import { afterAll, assert, beforeAll, expect, it, runPromise } from "~/support/effect-test";
import { getFrontendUrl } from "~/support/harness-target";

const SUITE_ID = crypto.randomUUID();

const HARVEST_IMPORT_SOURCE = `e2e_harvest_handle_import_${SUITE_ID.replaceAll("-", "_")}`;

const SOURCE_NAME = "OpenScale";

const UPLOAD_LABEL = "OpenScale export";

const OPENSCALE_SAMPLE_CSV = `dateTime,weight,bmi,fat,water,muscle,comment
2026-04-01 08:00:00,75.0,22.5,15.0,60.0,40.0,Morning weight
2026-04-02 08:00:00,74.8,22.4,14.9,60.2,40.1,
2026-04-03 08:00:00,75.2,22.6,15.1,60.0,40.0,After lunch
`;

let email: string;
let password: string;
let slowImport: { plugin: InstalledTestPlugin; source: string } | undefined;
let harvestImport: InstalledTestPlugin | undefined;

const settingsSidebar = (page: Playwright.Page) => page.getByTestId("settings-sidebar");

const wizard = (page: Playwright.Page) => page.getByRole("dialog", { name: "Start an import" });

const importRow = (page: Playwright.Page) =>
	page.getByRole("link", { name: new RegExp(`Open the ${SOURCE_NAME} import from`) });

const openImportData = (page: Playwright.Page) =>
	Effect.gen(function* () {
		yield* page.goto(`${getFrontendUrl()}/settings/preferences`);
		yield* settingsSidebar(page).waitFor({ state: "visible" });
		yield* settingsSidebar(page).getByRole("link", { name: "Import data" }).click();
		yield* page.waitForURL((url) => url.pathname === "/settings/import-data");
		yield* page.getByRole("heading", { level: 1, name: "Import data" }).waitFor();
	});

/**
 * The schema form opens a detached `<input type="file">` on click, so the chooser has to be
 * awaited from the page's event stream rather than filled through a locator.
 */
const attachExport = (page: Playwright.Page) =>
	Effect.gen(function* () {
		const chooser = yield* page
			.eventStream("filechooser")
			.pipe(Stream.runHead, Effect.forkChild({ startImmediately: true }));
		yield* wizard(page)
			.getByRole("button", { name: `Choose a file for ${UPLOAD_LABEL}` })
			.click();
		const picked = Option.getOrThrow(yield* Fiber.join(chooser));
		yield* picked.setFiles({
			mimeType: "text/csv",
			name: "openscale-export.csv",
			buffer: Buffer.from(OPENSCALE_SAMPLE_CSV, "utf8"),
		});
		yield* wizard(page).getByText("Ready to import").waitFor({ state: "visible" });
	});

const startOpenScaleImport = (page: Playwright.Page) =>
	Effect.gen(function* () {
		yield* page.getByRole("button", { name: "Start an import" }).first().click();
		yield* wizard(page).waitFor({ state: "visible" });
		yield* page.waitForURL((url) => url.searchParams.get("start") === "true");

		yield* wizard(page).getByLabel("Search services").fill(SOURCE_NAME);
		yield* wizard(page)
			.getByRole("button", { name: `Import from ${SOURCE_NAME}` })
			.click();
		yield* wizard(page).getByRole("heading", { name: SOURCE_NAME }).waitFor();

		yield* wizard(page).getByRole("button", { name: "Where do I find this file?" }).click();
		yield* wizard(page)
			.getByRole("link", { name: "Open the export guide" })
			.waitFor({ state: "visible" });

		yield* attachExport(page);
		yield* wizard(page).getByRole("button", { name: "Continue" }).click();
		yield* wizard(page).getByText("CSV file").waitFor({ state: "visible" });
		yield* wizard(page).getByRole("button", { name: "Start import" }).click();
		yield* wizard(page).waitFor({ state: "hidden" });
	});

const startImportFromSource = (page: Playwright.Page, sourceName: string) =>
	Effect.gen(function* () {
		yield* page.getByRole("button", { name: "Start an import" }).first().click();
		yield* wizard(page).waitFor({ state: "visible" });
		yield* wizard(page).getByLabel("Search services").fill(sourceName);
		yield* wizard(page)
			.getByRole("button", { name: `Import from ${sourceName}` })
			.click();
		const continueButton = wizard(page).getByRole("button", { name: "Continue" });
		if ((yield* continueButton.count) > 0) {
			yield* continueButton.click();
		}
		yield* wizard(page).getByRole("button", { name: "Start import" }).click();
		yield* wizard(page).waitFor({ state: "hidden" });
	});

const startSlowImport = (page: Playwright.Page) =>
	startImportFromSource(page, "E2E import pinning");

const withImportsBrowser = <E, R>(run: (page: Playwright.Page) => Effect.Effect<void, E, R>) =>
	Effect.gen(function* () {
		const browser = yield* Playwright.Browser;
		const page = yield* browser.newPage({ viewport: { width: 1280, height: 800 } });
		yield* signInThroughHostedOAuth(page, email, password);
		yield* run(page);
	});

beforeAll(() =>
	runPromise(
		Effect.gen(function* () {
			slowImport = yield* installTestImportPinningPlugin;
			harvestImport = yield* installTestHarvestHandleImportPlugin(101, HARVEST_IMPORT_SOURCE);
			const user = yield* createTestUser();
			email = user.email;
			password = user.password;
		}),
	),
);

afterAll(() => slowImport && runPromise(uninstallTestPlugin(slowImport.plugin)));
afterAll(() => harvestImport && runPromise(uninstallTestPlugin(harvestImport)));

it.live("starts, follows and deletes an import from settings", () =>
	withImportsBrowser((page) =>
		Effect.gen(function* () {
			yield* openImportData(page);
			yield* page.getByText("No imports yet").waitFor({ state: "visible" });

			yield* startOpenScaleImport(page);

			const row = importRow(page);
			yield* row.waitFor({ state: "visible" });
			yield* row.click();
			yield* page.waitForURL((url) => url.pathname.startsWith("/settings/import-data/"));
			yield* page.getByRole("heading", { level: 1, name: SOURCE_NAME }).waitFor();

			yield* page
				.getByText("Completed", { exact: true })
				.waitFor({ timeout: 60_000, state: "visible" });
			expect(
				yield* page.getByText(
					"measurements: 3 created · 0 updated · 0 unchanged · 0 skipped · 0 unsuccessful",
					{ exact: true },
				).count,
			).toBe(1);
			yield* page.getByRole("heading", { name: "Record issues" }).waitFor({ state: "hidden" });

			yield* page.getByRole("button", { name: "Import actions" }).click();
			yield* page.getByRole("menuitem", { name: "Delete record" }).click();
			const confirmation = page.getByRole("dialog");
			yield* confirmation.waitFor({ state: "visible" });
			yield* confirmation.getByRole("button", { name: "Delete record" }).click();

			yield* page.waitForURL((url) => url.pathname === "/settings/import-data");
			yield* page.getByText("No imports yet").waitFor({ state: "visible" });
			expect(yield* importRow(page).count).toBe(0);
		}),
	).pipe(PlaywrightSpawner.withBrowser),
);

it.live("downloads failures beyond the first page from an import detail", () =>
	withImportsBrowser((page) =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			yield* openImportData(page);
			yield* startImportFromSource(page, "E2E harvest handle import");

			const row = page.getByRole("link", {
				name: /Open the E2E harvest handle import import from just now/,
			});
			yield* row.waitFor({ state: "visible" });
			yield* row.click();
			yield* page.getByRole("heading", { level: 1, name: "E2E harvest handle import" }).waitFor();
			yield* page.getByRole("button", { name: "Show more record issues" }).waitFor();

			const downloadFiber = yield* page
				.eventStream("download")
				.pipe(Stream.runHead, Effect.forkChild({ startImmediately: true }));
			yield* page.getByRole("button", { name: "Download issues" }).click();
			const download = Option.getOrThrow(yield* Fiber.join(downloadFiber));
			expect(download.suggestedFilename()).toMatch(/^ryot-import-issues-.+\.json$/);
			const path = Option.getOrThrow(yield* download.path);
			assert.isNotNull(path);
			const bytes = yield* fs.readFile(path);
			const report = yield* Schema.decodeEffect(Schema.fromJsonString(importIssuesExportSchema))(
				new TextDecoder().decode(bytes),
			);
			expect(report.issues).toHaveLength(101);
			expect(report.issues.map(({ attribution }) => attribution?.sourceLabel)).toContain(
				"Harvest fixture 101",
			);
		}),
	).pipe(PlaywrightSpawner.withBrowser),
);

it.live("keeps the wizard in the URL so closing it returns to the list", () =>
	withImportsBrowser((page) =>
		Effect.gen(function* () {
			yield* openImportData(page);
			yield* page.getByRole("button", { name: "Start an import" }).first().click();
			yield* wizard(page).waitFor({ state: "visible" });

			yield* wizard(page).getByLabel("Search services").fill(`nomatch${SUITE_ID}`);
			yield* wizard(page).getByText("Nothing matches that").waitFor({ state: "visible" });

			yield* wizard(page).getByRole("button", { name: "Close the import wizard" }).click();
			yield* wizard(page).waitFor({ state: "hidden" });
			yield* page.waitForURL((url) => !url.searchParams.has("start"));
		}),
	).pipe(PlaywrightSpawner.withBrowser),
);

it.live("requires confirmation, cancels, and deletes a slow import", () =>
	withImportsBrowser((page) =>
		Effect.gen(function* () {
			yield* openImportData(page);
			yield* startSlowImport(page);
			const live = page.getByRole("link", {
				name: /Open the E2E import pinning import in progress/,
			});
			yield* live.waitFor({ state: "visible" });
			yield* live.click();
			yield* page.getByRole("heading", { level: 1, name: "E2E import pinning" }).waitFor();

			yield* page.getByRole("button", { name: "Import actions" }).click();
			yield* page.getByRole("menuitem", { name: "Cancel import" }).click();
			const confirmation = page.getByRole("dialog", { name: "Cancel this import?" });
			yield* confirmation.waitFor({ state: "visible" });
			yield* confirmation.getByText(/Items already added stay in your library/).waitFor();
			const action = confirmation.getByRole("button", { name: "Cancel import" });
			expect(yield* action.isDisabled()).toBe(true);
			const phrase = confirmation.getByRole("textbox", {
				name: 'Type "Cancel this import" to confirm',
			});
			yield* phrase.fill("cancel this import");
			expect(yield* action.isDisabled()).toBe(true);
			yield* phrase.fill("Cancel this import");
			expect(yield* action.isDisabled()).toBe(false);
			yield* action.click();

			yield* page.getByText("Cancelling").waitFor({ timeout: 30_000, state: "visible" });
			yield* page
				.getByText("Cancelled", { exact: true })
				.waitFor({ timeout: 60_000, state: "visible" });
			yield* page.getByText(/Items already added remain in your library/).waitFor();

			yield* page.getByRole("button", { name: "Import actions" }).click();
			yield* page.getByRole("menuitem", { name: "Delete record" }).click();
			const deletion = page.getByRole("dialog", { name: "Delete this import record?" });
			yield* deletion.getByRole("button", { name: "Delete record" }).click();
			yield* page.waitForURL((url) => url.pathname === "/settings/import-data");
			const deleted = page.getByRole("link", { name: /Open the E2E import pinning import from/ });
			yield* deleted.waitFor({ state: "hidden" });
			expect(yield* deleted.count).toBe(0);
		}),
	).pipe(PlaywrightSpawner.withBrowser),
);
