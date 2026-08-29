import { Effect, Fiber, Option, Stream } from "effect";
import { Playwright, PlaywrightSpawner } from "effect-playwright";

import { createTestUser } from "~/fixtures/kernel";
import { browserLayer, signInThroughHostedOAuth } from "~/support/browser";
import { beforeAll, expect, it } from "~/support/effect-test";
import { getFrontendUrl } from "~/support/frontend";

const SUITE_ID = crypto.randomUUID();

const SOURCE_NAME = "OpenScale";

const UPLOAD_LABEL = "OpenScale export";

const OPENSCALE_SAMPLE_CSV = `dateTime,weight,bmi,fat,water,muscle,comment
2026-04-01 08:00:00,75.0,22.5,15.0,60.0,40.0,Morning weight
2026-04-02 08:00:00,74.8,22.4,14.9,60.2,40.1,
2026-04-03 08:00:00,75.2,22.6,15.1,60.0,40.0,After lunch
`;

let email: string;
let password: string;

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

const withImportsBrowser = <E, R>(run: (page: Playwright.Page) => Effect.Effect<void, E, R>) =>
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

			// The detail polls until the run leaves a non-terminal status.
			yield* page.getByText("Completed").waitFor({ state: "visible", timeout: 60_000 });
			expect(yield* page.getByText("3 of 3 read · 3 added · 0 failed").count).toBe(1);
			yield* page.getByText("What could not be brought over").waitFor({ state: "hidden" });

			yield* page.getByRole("button", { name: "Import actions" }).click();
			yield* page.getByRole("menuitem", { name: "Delete record" }).click();
			const confirmation = page.getByRole("dialog");
			yield* confirmation.waitFor({ state: "visible" });
			yield* confirmation.getByRole("button", { name: "Delete record" }).click();

			yield* page.waitForURL((url) => url.pathname === "/settings/import-data");
			yield* page.getByText("No imports yet").waitFor({ state: "visible" });
			expect(yield* importRow(page).count).toBe(0);
		}),
	).pipe(PlaywrightSpawner.withBrowser, Effect.provide(browserLayer)),
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
	).pipe(PlaywrightSpawner.withBrowser, Effect.provide(browserLayer)),
);
