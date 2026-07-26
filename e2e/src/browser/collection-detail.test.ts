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
		const summary = detail.getByRole("region", { name: "Collection summary" });
		yield* summary.waitFor({ state: "visible" });
		yield* summary.getByText("1 total", { exact: true }).waitFor({ state: "visible" });
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

it.live("browses collection members with membership properties", () =>
	Effect.gen(function* () {
		const frontendUrl = getFrontendUrl();
		const { email, client, password } = yield* createAuthenticatedClient();
		const id = crypto.randomUUID();
		const collectionName = `Browser collection ${id}`;
		const alphaName = `Alpha member ${id}`;
		const zuluName = `Zulu member ${id}`;
		const collection = yield* createCollection(client, {
			name: collectionName,
			membershipPropertiesSchema: {
				fields: {
					notes: { position: 1, type: "string", label: "Notes", description: "Notes" },
					rating: { position: 0, type: "integer", label: "Rating", description: "Rating" },
					template: {
						position: 2,
						type: "boolean",
						label: "Template",
						description: "Uses the collection template",
					},
				},
			},
		});
		const alpha = yield* createCollection(client, { name: alphaName });
		const zulu = yield* createCollection(client, { name: zuluName });
		yield* client.call((contract) =>
			contract.collections.createMembership({
				payload: {
					entityId: alpha.id,
					collectionId: collection.id,
					properties: { rating: 5, template: true, notes: "First member" },
				},
			}),
		);
		yield* client.call((contract) =>
			contract.collections.createMembership({
				payload: {
					entityId: zulu.id,
					collectionId: collection.id,
					properties: { rating: 3, template: false, notes: "Second member" },
				},
			}),
		);

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
		const summary = detail.getByRole("region", { name: "Collection summary" });
		yield* summary.waitFor({ state: "visible" });
		yield* summary.getByText("2 total", { exact: true }).waitFor({ state: "visible" });
		yield* summary.getByText("2 Collections", { exact: true }).waitFor({ state: "visible" });
		expect(yield* detail.getByRole("button", { name: "Add", exact: true }).count).toBe(0);

		yield* detail.getByRole("radio", { name: "Table view" }).click();
		const rows = detail.locator("tbody tr");
		yield* rows.nth(1).waitFor({ state: "visible" });
		expect(yield* detail.getByRole("columnheader").allInnerTexts()).toEqual([
			"Name",
			"Type",
			"Rating",
			"Notes",
			"Template",
		]);
		expect(yield* rows.nth(0).locator("td").allInnerTexts()).toEqual([
			alphaName,
			"Collections",
			"5",
			"First member",
			"Yes",
		]);
		expect(yield* rows.nth(1).locator("td").allInnerTexts()).toEqual([
			zuluName,
			"Collections",
			"3",
			"Second member",
			"No",
		]);

		const search = detail.getByRole("searchbox", { name: `Search ${collectionName}` });
		yield* search.fill("Alpha");
		yield* page.waitForURL((url) => url.searchParams.get("search") === "Alpha");
		yield* detail.getByText(alphaName, { exact: true }).waitFor({ state: "visible" });
		yield* detail.getByText(zuluName, { exact: true }).waitFor({ state: "hidden" });

		yield* search.fill("");
		yield* page.waitForURL((url) => url.searchParams.get("search") === null);
		yield* detail.getByText(zuluName, { exact: true }).waitFor({ state: "visible" });

		yield* detail.getByRole("button", { name: "Sort results: Collection order" }).click();
		yield* detail.getByRole("radio", { name: "Name Z-A" }).click();
		yield* page.waitForURL((url) => url.searchParams.get("sort") === "name-desc");
		yield* rows.nth(0).getByText(zuluName, { exact: true }).waitFor({ state: "visible" });
		yield* rows.nth(1).getByText(alphaName, { exact: true }).waitFor({ state: "visible" });
	}).pipe(PlaywrightSpawner.withBrowser, Effect.provide(browserLayer)),
);
