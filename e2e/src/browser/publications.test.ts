import { randomUuid } from "@ryot-app/testing/random";
import { Effect } from "effect";
import { Playwright, PlaywrightSpawner } from "effect-playwright";

import { createAuthenticatedClient, createCollection } from "~/fixtures/kernel";
import { signInThroughHostedOAuth } from "~/support/browser";
import { expect, it } from "~/support/effect-test";
import { getFrontendUrl } from "~/support/harness-target";

it.live("shares a collection, lets a visitor open an item, and stops at revocation", () =>
	Effect.gen(function* () {
		const { email, client, password } = yield* createAuthenticatedClient();
		const suffix = yield* randomUuid;
		const shelf = yield* createCollection(client, { name: `Shelf ${suffix}` });
		for (const name of ["Alpha", "Beta"]) {
			const member = yield* createCollection(client, { name: `${name} ${suffix}` });
			yield* client.call((api) =>
				api.collections.createMembership({
					payload: { entityId: member.id, collectionId: shelf.id },
				}),
			);
		}
		const browser = yield* Playwright.Browser;
		const owner = yield* browser.newPage();
		yield* signInThroughHostedOAuth(owner, email, password);
		yield* owner.goto(`${getFrontendUrl()}/e/${shelf.id}`);
		yield* owner
			.locator("iframe")
			.contentFrame()
			.getByRole("button", { exact: true, name: "Share" })
			.first()
			.click();
		const sheet = owner.getByRole("dialog", { name: "Share" });
		yield* sheet.getByRole("button", { name: "Publish and create link" }).click();
		const linkField = sheet.getByRole("textbox", { name: "New link" });
		yield* linkField.waitFor({ state: "visible" });
		const link = yield* linkField.inputValue();
		expect(link).toContain(`/share/`);

		const visitor = yield* browser.newPage();
		yield* visitor.goto(link);
		const shared = visitor.locator("iframe").contentFrame();
		yield* shared.getByText("2 items", { exact: true }).waitFor({ state: "visible" });
		yield* shared
			.getByRole("link", { name: `Open Alpha ${suffix}` })
			.first()
			.click();
		yield* shared
			.getByRole("heading", { name: `Alpha ${suffix}` })
			.first()
			.waitFor({ state: "visible" });
		yield* shared.getByRole("button", { name: "All items" }).first().click();
		yield* shared.getByText(`Beta ${suffix}`).first().waitFor({ state: "visible" });

		yield* owner.reload;
		yield* owner
			.locator("iframe")
			.contentFrame()
			.getByRole("button", { exact: true, name: "Share" })
			.first()
			.click();
		yield* owner
			.getByRole("dialog", { name: "Share" })
			.getByRole("button", { exact: true, name: "Revoke" })
			.click();
		yield* owner
			.getByRole("dialog", { name: "Revoke this link?" })
			.getByRole("button", { name: "Revoke link" })
			.click();
		yield* owner
			.getByRole("dialog", { name: "Share" })
			.getByText("Revoked")
			.waitFor({ state: "visible" });

		yield* visitor.reload;
		yield* visitor.getByText("Link revoked").waitFor({ state: "visible" });
	}).pipe(PlaywrightSpawner.withBrowser),
);
