import { randomUuid } from "@ryot-app/testing/random";
import { Effect } from "effect";
import { Playwright, PlaywrightSpawner } from "effect-playwright";

import { createAuthenticatedClient, createCollection } from "~/fixtures/kernel";
import { signInThroughHostedOAuth } from "~/support/browser";
import { expect, it } from "~/support/effect-test";
import { getFrontendUrl } from "~/support/harness-target";

const definition = (text: string) => ({
	pluginDependencies: {},
	entry: "client/page.tsx",
	queries: { queries: {} },
	files: [
		{
			path: "client/page.tsx",
			content: Buffer.from(`export default function Page() { return <h2>${text}</h2>; }`).toString(
				"base64",
			),
		},
	],
});

for (const mode of ["live", "snapshot"] as const) {
	it.live(`shares a ${mode} collection and stops at revocation`, () =>
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
			if (mode === "snapshot") {
				yield* sheet.getByRole("button", { exact: true, name: "Mode: Live" }).click();
				yield* owner
					.getByRole("dialog", { exact: true, name: "Mode" })
					.getByRole("radio", { exact: true, name: "Snapshot" })
					.click();
			}
			yield* sheet.getByRole("button", { name: "Publish and create link" }).click();
			const linkField = sheet.getByRole("textbox", { name: "New link" });
			yield* linkField.waitFor({ state: "visible" });
			const link = yield* linkField.inputValue();
			expect(link).toContain(`/share/`);

			const visitor = yield* browser.newPage();
			yield* visitor.goto(link);
			const shared = visitor.locator("iframe").contentFrame();
			if (mode === "live") {
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
			} else {
				yield* shared
					.getByText("This snapshot shows only the first page captured when it was published.")
					.waitFor({ state: "visible" });
				yield* shared
					.getByText(`Alpha ${suffix}`, { exact: true })
					.first()
					.waitFor({ state: "visible" });
				expect(yield* shared.getByRole("link", { name: `Open Alpha ${suffix}` }).count).toBe(0);
				expect(yield* shared.getByRole("searchbox").count).toBe(0);
				expect(yield* shared.getByRole("button", { name: /Load more/ }).count).toBe(0);
			}

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
}

it.live("renders an authored page anonymously and freezes snapshot code until refresh", () =>
	Effect.gen(function* () {
		const { client } = yield* createAuthenticatedClient();
		const suffix = yield* randomUuid;
		const authored = yield* client.call((api) =>
			api.pageAuthoring.create({
				payload: {
					name: `Shared ${suffix}`,
					slug: `shared-${suffix}`,
					definition: definition("Original code"),
				},
			}),
		);
		yield* client.call((api) =>
			api.pageAuthoring.publish({ payload: { pageId: authored.pageId, expectedDraftRevision: 1 } }),
		);
		const browser = yield* Playwright.Browser;
		const visits = [];
		for (const mode of ["live", "snapshot"] as const) {
			const publication = yield* client.call((api) =>
				api.publications.create({
					payload: {
						mode,
						title: mode,
						icon: "book",
						arguments: {},
						description: null,
						showOwnerName: false,
						page: { kind: "page", pageId: authored.pageId },
					},
				}),
			);
			const link = yield* client.call((api) =>
				api.publications.createLink({
					payload: { expiresAt: null, label: "Visitors", publicationId: publication.publicationId },
				}),
			);
			const visitor = yield* browser.newPage();
			yield* visitor.goto(`${getFrontendUrl()}/share/${publication.publicationId}#${link.secret}`);
			yield* visitor
				.locator("iframe")
				.contentFrame()
				.getByRole("heading", { name: "Original code" })
				.waitFor({ state: "visible" });
			visits.push({ mode, visitor, publicationId: publication.publicationId });
		}
		yield* client.call((api) =>
			api.pageAuthoring.replaceDraft({
				payload: {
					pageId: authored.pageId,
					expectedDraftRevision: 1,
					definition: definition("Current code"),
				},
			}),
		);
		yield* client.call((api) =>
			api.pageAuthoring.publish({ payload: { pageId: authored.pageId, expectedDraftRevision: 2 } }),
		);
		for (const visit of visits) {
			yield* visit.visitor.reload;
			yield* visit.visitor
				.locator("iframe")
				.contentFrame()
				.getByRole("heading", { name: visit.mode === "live" ? "Current code" : "Original code" })
				.waitFor({ state: "visible" });
			if (visit.mode === "snapshot") {
				yield* client.call((api) =>
					api.publications.republish({
						payload: {
							icon: "book",
							arguments: {},
							mode: "snapshot",
							title: "snapshot",
							description: null,
							showOwnerName: false,
							publicationId: visit.publicationId,
							page: { kind: "page", pageId: authored.pageId },
						},
					}),
				);
				yield* visit.visitor.reload;
				yield* visit.visitor
					.locator("iframe")
					.contentFrame()
					.getByRole("heading", { name: "Current code" })
					.waitFor({ state: "visible" });
			}
		}
	}).pipe(PlaywrightSpawner.withBrowser),
);
