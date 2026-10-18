import { Effect, Schema } from "effect";
import { Playwright, PlaywrightSpawner } from "effect-playwright";

import { createAuthenticatedClient, createCollection } from "~/fixtures/kernel";
import { createExerciseEntityFixture } from "~/fixtures/plugins/fitness";
import { signInThroughHostedOAuth } from "~/support/browser";
import { expect, it } from "~/support/effect-test";
import { getFrontendUrl } from "~/support/harness-target";

const encodeFilter = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

it.live("reorders a kernel collection with keyboard and absolute-end controls", () =>
	Effect.gen(function* () {
		const { email, client, password } = yield* createAuthenticatedClient();
		const suffix = crypto.randomUUID();
		const collection = yield* createCollection(client, { name: `Order ${suffix}` });
		const members = yield* Effect.forEach(["Alpha", "Beta", "Gamma"], (name) =>
			createCollection(client, { name: `${name} ${suffix}` }),
		);
		for (const member of members) {
			yield* client.call((api) =>
				api.collections.createMembership({
					payload: { entityId: member.id, collectionId: collection.id },
				}),
			);
		}
		const browser = yield* Playwright.Browser;
		const page = yield* browser.newPage();
		yield* signInThroughHostedOAuth(page, email, password);
		yield* page.goto(`${getFrontendUrl()}/e/${collection.id}`);
		const detail = page.locator("iframe").contentFrame();
		yield* detail.getByRole("button", { exact: true, name: "Reorder" }).click();
		yield* detail
			.getByRole("button", { exact: true, name: `Reorder Gamma ${suffix}` })
			.press("ArrowDown");
		const order = detail.getByRole("list", { name: "Collection order" });
		yield* order
			.locator("li")
			.first()
			.getByText(`Beta ${suffix}`, { exact: true })
			.waitFor({ state: "visible" });
		yield* detail
			.getByRole("button", { exact: true, name: `Move Alpha ${suffix} to start` })
			.click();
		yield* order
			.locator("li")
			.first()
			.getByText(`Alpha ${suffix}`, { exact: true })
			.waitFor({ state: "visible" });
		yield* detail.getByRole("button", { exact: true, name: `Move Beta ${suffix} to end` }).click();
		yield* order
			.locator("li")
			.last()
			.getByText(`Beta ${suffix}`, { exact: true })
			.waitFor({ state: "visible" });
		yield* detail.getByRole("button", { exact: true, name: "Done" }).click();
		yield* detail.getByRole("radio", { name: "Table view" }).click();
		yield* detail
			.locator("tbody tr")
			.first()
			.getByText(`Alpha ${suffix}`, { exact: true })
			.waitFor({ state: "visible" });
		expect(yield* detail.locator("tbody tr td:first-child").allInnerTexts()).toEqual([
			`Alpha ${suffix}`,
			`Gamma ${suffix}`,
			`Beta ${suffix}`,
		]);
		yield* detail.getByRole("button", { exact: true, name: "Reorder" }).click();
		yield* order
			.getByRole("button", { exact: true, name: `Reorder Beta ${suffix}` })
			.waitFor({ state: "visible" });
		expect((yield* order.locator("li").allInnerTexts()).map((text) => text.trim())).toEqual([
			`Alpha ${suffix}`,
			`Gamma ${suffix}`,
			`Beta ${suffix}`,
		]);
	}).pipe(PlaywrightSpawner.withBrowser),
);

it.live("manages collection memberships without closing after each change", () =>
	Effect.gen(function* () {
		const frontendUrl = getFrontendUrl();
		const { email, client, password } = yield* createAuthenticatedClient();
		const id = crypto.randomUUID();
		const member = yield* createCollection(client, { name: `Member ${id}` });
		const collection = yield* createCollection(client, {
			name: `Collection ${id}`,
			fields: [{ type: "text", label: "Notes", required: true }],
		});
		yield* client.call((contract) =>
			contract.collections.createMembership({
				payload: {
					entityId: member.id,
					collectionId: collection.id,
					properties: { notes: "First note" },
				},
			}),
		);
		const browser = yield* Playwright.Browser;
		const page = yield* browser.newPage();
		yield* signInThroughHostedOAuth(page, email, password);
		yield* page.goto(`${frontendUrl}/e/${collection.id}`);
		const detail = page.locator("iframe").contentFrame();
		yield* detail.getByRole("radio", { name: "Table view" }).click();
		yield* detail.getByRole("button", { name: `Collection details for ${member.name}` }).click();
		const membership = page.getByRole("dialog", {
			exact: true,
			name: `Details in ${collection.name}`,
		});
		yield* membership.getByRole("textbox", { exact: true, name: "Notes" }).fill("Updated note");
		yield* membership.getByRole("button", { exact: true, name: "Save details" }).click();
		const manager = page.getByRole("dialog", {
			exact: true,
			name: `Collections for ${member.name}`,
		});
		yield* manager.waitFor({ state: "visible" });
		yield* manager
			.getByRole("button", { name: new RegExp(`${collection.name}.*Added`) })
			.waitFor({ state: "visible" });
		yield* manager.getByRole("button", { exact: true, name: "Done" }).click();
		yield* manager.waitFor({ state: "hidden" });
		yield* detail.getByText("Updated note", { exact: true }).waitFor({ state: "visible" });
		yield* detail.getByRole("button", { name: `Collection details for ${member.name}` }).click();
		yield* membership.getByRole("button", { exact: true, name: "Remove from collection" }).click();
		const confirmation = page.getByRole("dialog", {
			exact: true,
			name: `Remove from ${collection.name}?`,
		});
		yield* confirmation
			.getByRole("button", { exact: true, name: "Remove from collection" })
			.click();
		yield* manager.waitFor({ state: "visible" });
		yield* manager
			.getByRole("button", { exact: true, name: collection.name })
			.waitFor({ state: "visible" });
		yield* manager.getByRole("button", { exact: true, name: "Done" }).click();
		yield* detail
			.getByText("This collection is empty.", { exact: true })
			.waitFor({ state: "visible" });
	}).pipe(PlaywrightSpawner.withBrowser),
);

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
	}).pipe(PlaywrightSpawner.withBrowser),
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
	}).pipe(PlaywrightSpawner.withBrowser),
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
			fields: [
				{ type: "number", label: "Rating", required: false },
				{ type: "text", label: "Notes", required: false },
				{
					type: "boolean",
					required: false,
					label: "Template",
					description: "Uses the collection template",
				},
			],
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
			"Actions",
		]);
		expect(yield* rows.nth(0).locator("td").allInnerTexts()).toEqual([
			zuluName,
			"Collections",
			"3",
			"Second member",
			"No",
			"",
		]);
		expect(yield* rows.nth(1).locator("td").allInnerTexts()).toEqual([
			alphaName,
			"Collections",
			"5",
			"First member",
			"Yes",
			"",
		]);

		const search = detail.getByRole("searchbox", { name: `Search ${collectionName}` });
		yield* search.fill("Alpha");
		yield* page.waitForURL((url) => url.searchParams.get("search") === "Alpha");
		yield* detail.getByText(alphaName, { exact: true }).waitFor({ state: "visible" });
		yield* detail.getByText(zuluName, { exact: true }).waitFor({ state: "hidden" });

		yield* search.fill("");
		yield* page.waitForURL((url) => url.searchParams.get("search") === null);
		yield* detail.getByText(zuluName, { exact: true }).waitFor({ state: "visible" });

		yield* detail.getByRole("button", { name: /Filters/ }).click();
		yield* detail.getByRole("button", { name: "Sort results: Collection order" }).click();
		yield* detail.getByRole("radio", { name: "Name A-Z" }).click();
		yield* page.waitForURL((url) => url.searchParams.get("sort") === "name-asc");
		yield* rows.nth(0).getByText(alphaName, { exact: true }).waitFor({ state: "visible" });
		yield* rows.nth(1).getByText(zuluName, { exact: true }).waitFor({ state: "visible" });
	}).pipe(PlaywrightSpawner.withBrowser),
);

it.live("filters collection members by type and keeps the filter across reload", () =>
	Effect.gen(function* () {
		const frontendUrl = getFrontendUrl();
		const { email, client, password } = yield* createAuthenticatedClient();
		const id = crypto.randomUUID();
		const collection = yield* createCollection(client, { name: `Typed collection ${id}` });
		const nested = yield* createCollection(client, { name: `Nested collection ${id}` });
		const { exerciseId } = yield* createExerciseEntityFixture(client, {
			name: `Exercise member ${id}`,
		});
		for (const entityId of [nested.id, exerciseId]) {
			yield* client.call((contract) =>
				contract.collections.createMembership({
					payload: { entityId, collectionId: collection.id },
				}),
			);
		}

		const browser = yield* Playwright.Browser;
		const page = yield* browser.newPage({ viewport: { width: 1280, height: 800 } });
		yield* signInThroughHostedOAuth(page, email, password);
		yield* page.goto(`${frontendUrl}/e/${collection.id}`);
		const detail = page.locator("iframe").contentFrame();
		const member = (name: string) => detail.getByText(`${name} ${id}`, { exact: true }).first();
		yield* member("Nested collection").waitFor({ state: "visible" });
		yield* member("Exercise member").waitFor({ state: "visible" });

		const filtersDialog = detail.getByRole("dialog", { exact: true, name: "Filters" });
		yield* detail.getByRole("button", { name: /^Filters/ }).click();
		yield* filtersDialog.getByRole("button", { name: /^Add filter/ }).click();
		yield* detail.getByRole("radio", { exact: true, name: "Type" }).click();
		yield* filtersDialog.getByRole("button", { name: /^Type values/ }).click();
		yield* detail.getByRole("checkbox", { exact: true, name: "Collections" }).click();
		yield* detail
			.getByRole("dialog", { exact: true, name: "Type values" })
			.getByRole("button", { exact: true, name: "Close options" })
			.click();
		yield* page.keyboard.press("Escape");
		yield* filtersDialog.waitFor({ state: "hidden" });

		yield* detail.getByRole("button", { exact: true, name: "Filters, 1 active filter" }).waitFor();
		yield* member("Exercise member").waitFor({ state: "detached" });
		yield* member("Nested collection").waitFor({ state: "visible" });
		expect(new URL(page.url()).searchParams.get("filters")).not.toBeNull();

		yield* page.reload;
		const reloaded = page.locator("iframe").contentFrame();
		yield* reloaded
			.getByRole("button", { exact: true, name: "Filters, 1 active filter" })
			.waitFor();
		yield* reloaded
			.getByText(`Nested collection ${id}`, { exact: true })
			.first()
			.waitFor({ state: "visible" });
		expect(yield* reloaded.getByText(`Exercise member ${id}`, { exact: true }).count).toBe(0);
	}).pipe(PlaywrightSpawner.withBrowser),
);

it.live("filters collection members by a membership property from the URL", () =>
	Effect.gen(function* () {
		const frontendUrl = getFrontendUrl();
		const { email, client, password } = yield* createAuthenticatedClient();
		const id = crypto.randomUUID();
		const collection = yield* createCollection(client, {
			name: `Rated collection ${id}`,
			fields: [{ type: "number", label: "Rating", required: false }],
		});
		const high = yield* createCollection(client, { name: `High ${id}` });
		const low = yield* createCollection(client, { name: `Low ${id}` });
		for (const [entityId, rating] of [
			[high.id, 5],
			[low.id, 2],
		] as const) {
			yield* client.call((contract) =>
				contract.collections.createMembership({
					payload: { entityId, properties: { rating }, collectionId: collection.id },
				}),
			);
		}

		const browser = yield* Playwright.Browser;
		const page = yield* browser.newPage({ viewport: { width: 1280, height: 800 } });
		yield* signInThroughHostedOAuth(page, email, password);
		const filters = Buffer.from(
			encodeFilter({ value: 4, operator: "gte", field: "membership.rating" }),
		).toString("base64url");
		yield* page.goto(`${frontendUrl}/e/${collection.id}?filters=${filters}`);
		const detail = page.locator("iframe").contentFrame();
		yield* detail.getByText(`High ${id}`, { exact: true }).first().waitFor({ state: "visible" });
		yield* detail
			.getByRole("group", { name: "Active filters" })
			.getByText("Rating is at least 4")
			.waitFor({ state: "visible" });
		expect(yield* detail.getByText(`Low ${id}`, { exact: true }).count).toBe(0);
	}).pipe(PlaywrightSpawner.withBrowser),
);
