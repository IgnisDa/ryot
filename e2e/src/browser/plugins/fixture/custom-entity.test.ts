import { networkInterfaces } from "node:os";

import { pluginPath, savedViewPath } from "@ryot-app/contract/modules/plugins/navigation";
import { EntitySchemaSlug } from "@ryot-app/contract/schema/brands";
import { randomUuid } from "@ryot-app/testing/random";
import { Effect } from "effect";
import { Playwright, PlaywrightSpawner } from "effect-playwright";

import { createAuthenticatedClient } from "~/fixtures/kernel/auth";
import { installFixtureClientPlugin } from "~/fixtures/kernel/client-plugin";
import { getEntity } from "~/fixtures/kernel/entities";
import { requirePresent } from "~/support/assertions";
import { pluginFrame, signInThroughHostedOAuth } from "~/support/browser";
import { expect, it } from "~/support/effect-test";
import { startIsolatedApiServer } from "~/support/isolated-harness";

it.live("creates an all-field-controls item from a saved view on plain HTTP", () =>
	Effect.gen(function* () {
		const frontendHost = requirePresent(
			Object.values(networkInterfaces())
				.flat()
				.find((address) => address?.family === "IPv4" && !address.internal)?.address,
			"Plain HTTP browser tests need a non-loopback IPv4 address",
		);
		const { target } = yield* startIsolatedApiServer({ frontendHost, label: "Plain HTTP" });
		const { frontendUrl } = target;
		const { email, client, password } = yield* createAuthenticatedClient(target);
		const installation = yield* installFixtureClientPlugin(client);
		const name = `Field controls ${yield* randomUuid}`;
		const page = yield* (yield* Playwright.Browser).newPage({
			viewport: { width: 1280, height: 900 },
		});
		yield* signInThroughHostedOAuth(page, email, password, { frontendUrl });
		expect(yield* page.evaluate(() => window.isSecureContext)).toBe(false);
		const viewPath = savedViewPath({
			kind: "plugin",
			slug: "all-field-controls",
			packageId: installation.packageId,
		});
		yield* page.goto(`${frontendUrl}${viewPath}`);
		const frame = pluginFrame(page);
		yield* frame.getByRole("button", { name: "Add", exact: true }).click();
		const provider = page.getByRole("dialog", { exact: true, name: "Add from a provider" });
		yield* provider.getByLabel("Search providers").fill(name);
		yield* provider.getByRole("button", { exact: true, name: "Create custom" }).click();
		const createPath = pluginPath(installation.packageId, "/all-field-controls/new");
		yield* page.waitForURL((url) => url.pathname === createPath);
		yield* provider.waitFor({ state: "hidden" });
		const form = frame.getByRole("form", { exact: true, name: "New All field controls" });
		const nameInput = form.getByLabel("Name", { exact: true });
		yield* nameInput.waitFor({ state: "visible" });
		expect(yield* form.evaluate(() => window.isSecureContext)).toBe(false);
		expect(yield* nameInput.inputValue()).toBe(name);
		yield* form.getByLabel("Text", { exact: true }).fill("Dedicated page item");
		yield* form.getByLabel("Decimal", { exact: true }).fill("1.5");
		yield* form.getByLabel("Integer", { exact: true }).fill("2");
		yield* form.getByRole("button", { exact: true, name: "Save" }).click();
		yield* page.waitForURL((url) => url.pathname.startsWith("/e/"));
		const entityId = yield* page.evaluate(() => location.pathname.slice("/e/".length));
		const entity = yield* getEntity(client, entityId);
		expect(entity.name).toBe(name);
		expect(entity.entitySchemaSlug).toBe(EntitySchemaSlug.make("all-field-controls"));
		expect(entity.entitySchemaPluginId).toBe(installation.pluginId);
		expect(entity.properties).toMatchObject({
			integer: 2,
			decimal: 1.5,
			text: "Dedicated page item",
		});
		yield* page.goto(`${frontendUrl}${viewPath}`);
		yield* frame.getByText(name, { exact: true }).waitFor({ state: "visible" });
	}).pipe(PlaywrightSpawner.withBrowser),
);
