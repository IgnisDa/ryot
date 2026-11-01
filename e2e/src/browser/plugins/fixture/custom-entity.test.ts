import { pluginPath, savedViewPath } from "@ryot-app/contract/modules/plugins/navigation";
import { randomUuid } from "@ryot-app/testing/random";
import { Effect } from "effect";
import { Playwright, PlaywrightSpawner } from "effect-playwright";

import { createAuthenticatedClient } from "~/fixtures/kernel/auth";
import { installFixtureClientPlugin } from "~/fixtures/kernel/client-plugin";
import { getEntity } from "~/fixtures/kernel/entities";
import { signInThroughHostedOAuth } from "~/support/browser";
import { expect, it } from "~/support/effect-test";
import { getFrontendUrl } from "~/support/harness-target";

it.live("creates an all-field-controls item on a dedicated page from the saved view", () =>
	Effect.gen(function* () {
		const { email, client, password } = yield* createAuthenticatedClient();
		const installation = yield* installFixtureClientPlugin(client);
		const name = `Field controls ${yield* randomUuid}`;
		const page = yield* (yield* Playwright.Browser).newPage({
			viewport: { width: 1280, height: 900 },
		});
		yield* signInThroughHostedOAuth(page, email, password);
		const viewPath = savedViewPath({
			kind: "plugin",
			slug: "all-field-controls",
			packageId: installation.packageId,
		});
		yield* page.goto(`${getFrontendUrl()}${viewPath}`);
		yield* page
			.locator("iframe:visible")
			.contentFrame()
			.getByRole("button", { name: "Add", exact: true })
			.click();
		const provider = page.getByRole("dialog", { exact: true, name: "Add from a provider" });
		yield* provider.getByLabel("Search providers").fill(name);
		yield* provider.getByRole("button", { exact: true, name: "Create custom" }).click();
		const createPath = pluginPath(installation.packageId, "/all-field-controls/new");
		yield* page.waitForURL((url) => url.pathname === createPath);
		yield* provider.waitFor({ state: "hidden" });
		const form = page
			.locator("iframe:visible")
			.contentFrame()
			.getByRole("form", { exact: true, name: "New All field controls" });
		const nameInput = form.getByLabel("Name", { exact: true });
		yield* nameInput.waitFor({ state: "visible" });
		expect(yield* nameInput.inputValue()).toBe(name);
		yield* form.getByLabel("Text", { exact: true }).fill("Dedicated page item");
		yield* form.getByLabel("Decimal", { exact: true }).fill("1.5");
		yield* form.getByLabel("Integer", { exact: true }).fill("2");
		yield* form.getByRole("button", { exact: true, name: "Save" }).click();
		yield* page.waitForURL((url) => url.pathname.startsWith("/e/"));
		const entityId = yield* page.evaluate(() => location.pathname.slice("/e/".length));
		const entity = yield* getEntity(client, entityId);
		expect(entity.name).toBe(name);
		expect(entity.entitySchemaSlug).toBe("all-field-controls");
		expect(entity.entitySchemaPluginId).toBe(installation.pluginId);
		expect(entity.properties).toMatchObject({
			integer: 2,
			decimal: 1.5,
			text: "Dedicated page item",
		});
		yield* page.goto(`${getFrontendUrl()}${viewPath}`);
		yield* page
			.locator("iframe:visible")
			.contentFrame()
			.getByText(name, { exact: true })
			.waitFor({ state: "visible" });
	}).pipe(PlaywrightSpawner.withBrowser),
);
