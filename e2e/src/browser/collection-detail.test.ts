import { Effect } from "effect";
import { Playwright, PlaywrightSpawner } from "effect-playwright";

import { createAuthenticatedClient, createCollection } from "~/fixtures/kernel";
import { browserLayer, signInThroughHostedOAuth } from "~/support/browser";
import { expect, it } from "~/support/effect-test";
import { getFrontendUrl } from "~/support/harness-target";

it.live("opens a kernel-owned collection instead of reporting an unavailable plugin", () =>
	Effect.gen(function* () {
		const frontendUrl = getFrontendUrl();
		const { email, client, password } = yield* createAuthenticatedClient();
		const memberName = `Member ${crypto.randomUUID()}`;
		const collectionName = `Collection ${crypto.randomUUID()}`;
		const member = yield* createCollection(client, { name: memberName });
		const collection = yield* createCollection(client, { name: collectionName });
		yield* client.call((contract) =>
			contract.collections.createMembership({
				payload: { entityId: member.id, collectionId: collection.id },
			}),
		);

		const browser = yield* Playwright.Browser;
		const page = yield* browser.newPage();
		yield* signInThroughHostedOAuth(page, email, password);
		yield* page.goto(`${frontendUrl}/e/${collection.id}`);
		yield* page.waitForURL(`${frontendUrl}/e/${collection.id}`);

		expect(
			yield* page.getByRole("heading", {
				level: 1,
				exact: true,
				name: "Required plugin unavailable",
			}).count,
		).toBe(0);

		const frame = page.locator("iframe");
		yield* frame.waitFor({ state: "visible" });
		const detail = frame.contentFrame();
		yield* detail
			.getByRole("heading", { level: 1, exact: true, name: collectionName })
			.waitFor({ state: "visible" });
		yield* detail
			.getByRole("heading", { level: 2, exact: true, name: "Collection summary" })
			.waitFor({ state: "visible" });
		yield* detail.getByText(memberName, { exact: true }).first().waitFor({ state: "visible" });
	}).pipe(PlaywrightSpawner.withBrowser, Effect.provide(browserLayer)),
);

it.live("shows an empty state for a collection without members", () =>
	Effect.gen(function* () {
		const frontendUrl = getFrontendUrl();
		const { email, client, password } = yield* createAuthenticatedClient();
		const collectionName = `Empty ${crypto.randomUUID()}`;
		const collection = yield* createCollection(client, { name: collectionName });

		const browser = yield* Playwright.Browser;
		const page = yield* browser.newPage();
		yield* signInThroughHostedOAuth(page, email, password);
		yield* page.goto(`${frontendUrl}/e/${collection.id}`);
		yield* page.waitForURL(`${frontendUrl}/e/${collection.id}`);

		const frame = page.locator("iframe");
		yield* frame.waitFor({ state: "visible" });
		const detail = frame.contentFrame();
		yield* detail
			.getByRole("heading", { level: 1, exact: true, name: collectionName })
			.waitFor({ state: "visible" });
		yield* detail
			.getByText("This collection is empty.", { exact: true })
			.waitFor({ state: "visible" });
	}).pipe(PlaywrightSpawner.withBrowser, Effect.provide(browserLayer)),
);
