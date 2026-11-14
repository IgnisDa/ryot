import { stringContaining } from "@ryot-app/testing/matchers";
import { randomUuid } from "@ryot-app/testing/random";
import { Effect } from "effect";
import { Playwright, PlaywrightSpawner } from "effect-playwright";

import {
	createAuthenticatedClient,
	createCollection,
	insertGlobalRelationship,
	listRelationshipSchemas,
	requireRelationshipSchemaBySlug,
} from "~/fixtures/kernel";
import { findMediaEntitySchema, seedMediaEntity } from "~/fixtures/plugins/media";
import { pluginFrame, signInThroughHostedOAuth } from "~/support/browser";
import { expect, it } from "~/support/effect-test";
import { getFrontendUrl } from "~/support/harness-target";

it.live("opens a collection's recommendations and searches them", () =>
	Effect.gen(function* () {
		const { email, client, password } = yield* createAuthenticatedClient();
		const suffix = yield* randomUuid;
		const { schema } = yield* findMediaEntitySchema(client, "book");
		const suggestion = requireRelationshipSchemaBySlug(
			yield* listRelationshipSchemas(client, {
				slugs: ["media-suggestion"],
				owner: schema.reference.owner,
			}),
			"media-suggestion",
			schema.reference.owner,
		).reference;
		const seedBook = (name: string) =>
			seedMediaEntity({
				userId: null,
				providerId: null,
				name: `${name} ${suffix}`,
				entitySchemaSlug: schema.id,
				properties: { images: [], isNsfw: false },
				externalId: `collection-recommendation-${name}-${suffix}`,
			});
		const [first, second, shared, single] = yield* Effect.all([
			seedBook("First Member"),
			seedBook("Second Member"),
			seedBook("Shared Pick"),
			seedBook("Single Pick"),
		]);
		const collection = yield* createCollection(client, { name: `Shelf ${suffix}` });
		for (const member of [first, second]) {
			yield* client.call((api) =>
				api.collections.createMembership({
					payload: { entityId: member.id, collectionId: collection.id },
				}),
			);
		}
		for (const [source, target] of [
			[first, shared],
			[second, shared],
			[first, single],
		] as const) {
			yield* insertGlobalRelationship({
				sourceEntityId: source.id,
				targetEntityId: target.id,
				relationshipSchema: suggestion,
			});
		}
		const browser = yield* Playwright.Browser;
		const page = yield* browser.newPage();
		yield* signInThroughHostedOAuth(page, email, password);
		yield* page.goto(`${getFrontendUrl()}/e/${collection.id}`);
		const frame = pluginFrame(page);
		yield* frame.getByRole("button", { exact: true, name: "Recommendations" }).click();
		yield* page.waitForURL(`**/collections/${collection.id}/recommendations`);
		const results = frame.getByRole("list", { name: "Recommendations" });
		yield* results
			.getByRole("link", { name: `Open Shared Pick ${suffix}` })
			.waitFor({ state: "visible" });
		expect(yield* results.getByRole("link").allInnerTexts()).toEqual<unknown>([
			stringContaining(`Shared Pick ${suffix}`),
			stringContaining(`Single Pick ${suffix}`),
		]);
		expect(yield* results.getByRole("link").first().innerText()).toContain("Book · Suggested by 2");
		expect(yield* results.getByRole("link").last().innerText()).not.toContain("Suggested by");
		yield* frame
			.getByText("Suggested by 2 titles in this collection", { exact: true })
			.waitFor({ state: "visible" });
		yield* frame
			.getByRole("searchbox", { name: "Search recommendations" })
			.fill(`Single Pick ${suffix}`);
		yield* page.waitForURL(/search=Single/);
		yield* results
			.getByRole("link", { name: `Open Shared Pick ${suffix}` })
			.waitFor({ state: "detached" });
		yield* results
			.getByRole("link", { name: `Open Single Pick ${suffix}` })
			.waitFor({ state: "visible" });
		expect(yield* results.getByRole("link").count).toBe(1);
	}).pipe(PlaywrightSpawner.withBrowser),
);
