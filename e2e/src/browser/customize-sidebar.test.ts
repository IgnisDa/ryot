import { Effect } from "effect";
import type { Page } from "playwright";

import {
	buildSavedViewLayouts,
	createSavedView,
	createTestUser,
	fakeProviderDetailsResult,
	fakeProviderSearchResult,
	installTestProvider,
	makeEntitySchemaSlug,
	makeSession,
	uninstallTestProvider,
	type InstalledTestProvider,
} from "~/fixtures/kernel";
import { getApiUrl } from "~/support/api";
import { signInThroughHostedOAuth, withBrowser } from "~/support/browser";
import { afterAll, beforeAll, expect, it } from "~/support/effect-test";

const SUITE_ID = crypto.randomUUID();

const BETA = `Customize Beta ${SUITE_ID}`;
const ALPHA = `Customize Alpha ${SUITE_ID}`;
const GAMMA = `Customize Gamma ${SUITE_ID}`;
const PLUGIN_SLUG = `customize-sidebar-${SUITE_ID}`;
const PROVIDER_NAME = "Customize Sidebar Fake Provider";
const ENTITY_SCHEMA_SLUG = `customize-sidebar-record-${SUITE_ID}`;
const PROVIDER_SLUG = `${ENTITY_SCHEMA_SLUG}.customize-sidebar`;

let email: string;
let password: string;
let provider: InstalledTestProvider;

const sidebar = (page: Page) => page.getByTestId("desktop-sidebar");

const savedViewSection = (page: Page) =>
	sidebar(page)
		.locator("section")
		.filter({ has: page.getByRole("heading", { name: "Saved Views", exact: true }) });

// A fresh account already owns the builtin "All Collections" saved view, so every assertion is
// scoped to this suite's own views rather than to the whole section.
const sidebarSavedViews = async (page: Page) => {
	const innerTexts = await savedViewSection(page).getByRole("link").allInnerTexts();
	return innerTexts.filter((name) => name.includes(SUITE_ID));
};

const openPanel = async (page: Page) => {
	await page.getByRole("button", { name: /workspace,/ }).click();
	await page.getByRole("menuitem", { name: "Customize sidebar" }).click();
	await page.getByRole("heading", { name: "Customize sidebar" }).waitFor({ state: "visible" });
};

beforeAll(async () => {
	await Effect.runPromise(
		Effect.gen(function* () {
			const user = yield* createTestUser();
			email = user.email;
			password = user.password;
			const client = makeSession(getApiUrl(), { Authorization: `Bearer ${user.token}` });
			provider = yield* installTestProvider({
				client,
				name: PROVIDER_NAME,
				slug: PROVIDER_SLUG,
				pluginSlug: PLUGIN_SLUG,
				rootEntitySchemaSlug: ENTITY_SCHEMA_SLUG,
				search: fakeProviderSearchResult([]),
				details: fakeProviderDetailsResult({ name: "Customize sidebar record" }),
				entitySchemas: [
					{
						icon: "file",
						eventSchemas: [],
						slug: ENTITY_SCHEMA_SLUG,
						name: "Customize Sidebar Record",
						propertiesSchema: { fields: {} },
					},
				],
			});
			for (const name of [ALPHA, BETA, GAMMA]) {
				yield* createSavedView(client, {
					name,
					entitySchemaSlug: makeEntitySchemaSlug(ENTITY_SCHEMA_SLUG),
					layouts: buildSavedViewLayouts({}, [ENTITY_SCHEMA_SLUG]),
				});
			}
		}),
	);
});

afterAll(async () => {
	await Effect.runPromise(uninstallTestProvider(provider));
});

it.live("reorders and hides saved views, and keeps both across a reload", () =>
	Effect.gen(function* () {
		yield* withBrowser({ viewport: { width: 1280, height: 900 } }, ({ page }) =>
			Effect.gen(function* () {
				const { homeUrl } = yield* signInThroughHostedOAuth(page, email, password);
				yield* Effect.promise(async () => {
					expect(await sidebarSavedViews(page)).toEqual([ALPHA, BETA, GAMMA]);

					await openPanel(page);
					await page
						.getByRole("button", { name: `Reorder ${ALPHA}` })
						.waitFor({ state: "visible" });

					await page.getByRole("button", { name: `Reorder ${ALPHA}` }).focus();
					await page.keyboard.press("End");
					await page.getByRole("switch", { name: `Show ${BETA} in sidebar` }).click();
					await page.getByRole("button", { name: "Save sidebar changes" }).click();

					await page.waitForURL((url) => url.pathname === new URL(homeUrl).pathname);
					await expect.poll(() => sidebarSavedViews(page)).toEqual([GAMMA, ALPHA]);

					await page.reload();
					await page.getByTestId("authenticated-shell").waitFor({ state: "visible" });
					expect(await sidebarSavedViews(page)).toEqual([GAMMA, ALPHA]);
				});
			}),
		);
	}),
);

it.live("restores a hidden view from the panel", () =>
	Effect.gen(function* () {
		yield* withBrowser({ viewport: { width: 1280, height: 900 } }, ({ page }) =>
			Effect.gen(function* () {
				const { homeUrl } = yield* signInThroughHostedOAuth(page, email, password);
				yield* Effect.promise(async () => {
					await openPanel(page);
					await page.getByRole("switch", { name: `Show ${BETA} in sidebar` }).click();
					await page.getByRole("button", { name: "Save sidebar changes" }).click();

					await page.waitForURL((url) => url.pathname === new URL(homeUrl).pathname);
					await expect.poll(() => sidebarSavedViews(page)).toEqual([BETA, GAMMA, ALPHA]);
				});
			}),
		);
	}),
);

it.live("leaves the draft untouched when the customization is cancelled", () =>
	Effect.gen(function* () {
		yield* withBrowser({ viewport: { width: 1280, height: 900 } }, ({ page }) =>
			Effect.gen(function* () {
				const { homeUrl } = yield* signInThroughHostedOAuth(page, email, password);
				yield* Effect.promise(async () => {
					await openPanel(page);
					await page.getByRole("switch", { name: `Show ${GAMMA} in sidebar` }).click();
					await page.getByRole("button", { name: "Cancel sidebar customization" }).click();

					await page.getByRole("button", { name: "Discard", exact: true }).click();
					await page.waitForURL((url) => url.pathname === new URL(homeUrl).pathname);
					await expect.poll(() => sidebarSavedViews(page)).toEqual([BETA, GAMMA, ALPHA]);
				});
			}),
		);
	}),
);
