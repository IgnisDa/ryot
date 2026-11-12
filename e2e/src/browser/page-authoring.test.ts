import { SavedViewId } from "@ryot-app/contract/schema/brands";
import { pageRecipe, pagesRecipe } from "@ryot-app/ryotql-recipes/pages";
import { randomUuid } from "@ryot-app/testing/random";
import { Effect, Fiber, Option, Stream } from "effect";
import { Playwright, PlaywrightSpawner } from "effect-playwright";

import { createAuthenticatedClient } from "~/fixtures/kernel";
import { executeRyotQLRecipe } from "~/fixtures/kernel/ryotql";
import { requirePresent } from "~/support/assertions";
import { signInThroughHostedOAuth } from "~/support/browser";
import { expect, it } from "~/support/effect-test";
import { getFrontendUrl } from "~/support/harness-target";

const source = (
	text: string,
) => `import { PluginScreenFrame } from "@ryot-app/plugin-client-sdk/screen";
export default function Page() { return <PluginScreenFrame title="Authored page"><h2>${text}</h2></PluginScreenFrame>; }`;

it.live(
	"authors a page with diagnostics, read-only preview, publication, navigation and reference protection",
	() =>
		Effect.gen(function* () {
			const { email, client, password } = yield* createAuthenticatedClient();
			const suffix = yield* randomUuid;
			const name = `Page ${suffix}`;
			const marker = `Published content ${suffix}`;
			const browser = yield* Playwright.Browser;
			const owner = yield* browser.newPage();
			yield* signInThroughHostedOAuth(owner, email, password);
			yield* owner.goto(`${getFrontendUrl()}/settings/pages`);
			expect(
				yield* owner.getByRole("link", { name: "Read the pages guide" }).getAttribute("href"),
			).toBe("https://docs.ryot.io/concepts/pages.html");
			yield* owner.getByRole("button", { exact: true, name: "New page" }).click();
			yield* owner.getByLabel("Name", { exact: true }).fill(name);
			yield* owner.getByLabel("Slug", { exact: true }).fill(`page-${suffix}`);
			yield* owner
				.getByLabel("Paste source", { exact: true })
				.fill("export default function Page() { return <div>invalid; }");
			yield* owner.getByRole("button", { exact: true, name: "Add pasted file" }).click();
			yield* owner.getByRole("button", { exact: true, name: "Create draft" }).click();
			yield* owner.getByRole("button", { exact: true, name: "Compile draft" }).click();
			yield* owner.getByRole("list", { name: "Compile diagnostics" }).waitFor({ state: "visible" });
			expect(yield* owner.getByRole("button", { name: "Preview compiled draft" }).count).toBe(0);

			const chooser = yield* owner
				.eventStream("filechooser")
				.pipe(Stream.runHead, Effect.forkChild({ startImmediately: true }));
			yield* owner.getByRole("button", { exact: true, name: "Upload file" }).click();
			const picked = Option.getOrThrow(yield* Fiber.join(chooser));
			yield* picked.setFiles({
				name: "page.tsx",
				mimeType: "text/plain",
				buffer: Buffer.from(source(marker)),
			});
			yield* owner.getByRole("button", { exact: true, name: "Save draft" }).click();
			yield* owner.getByRole("button", { exact: true, name: "Compile draft" }).click();
			yield* owner.getByRole("button", { exact: true, name: "Preview compiled draft" }).click();
			yield* owner
				.locator("iframe")
				.contentFrame()
				.getByRole("heading", { exact: true, name: marker })
				.waitFor({ state: "visible" });
			const previewUrl = owner.url();
			expect(previewUrl).toContain("draftRevision=2");
			yield* owner.goto(`${getFrontendUrl()}/settings/pages`);
			yield* owner.getByRole("button", { exact: true, name: `Manage ${name}` }).click();
			yield* owner.getByRole("button", { exact: true, name: "Publish" }).click();
			const icons = owner.getByRole("radiogroup", { name: "View icon" });
			yield* owner.getByLabel("Search icons", { exact: true }).fill("no-such-icon");
			yield* owner.getByText("No icons match.", { exact: true }).waitFor({ state: "visible" });
			yield* owner.getByLabel("Search icons", { exact: true }).fill("dumb");
			expect(yield* icons.getByRole("radio").count).toBe(1);
			yield* icons.getByRole("radio", { exact: true, name: "dumbbell" }).click();
			expect(
				yield* icons
					.getByRole("radio", { exact: true, name: "dumbbell" })
					.getAttribute("aria-checked"),
			).toBe("true");
			yield* owner.getByRole("button", { exact: true, name: "Create view and open" }).click();
			yield* owner
				.locator("iframe")
				.contentFrame()
				.getByRole("heading", { exact: true, name: marker })
				.waitFor({ state: "visible" });
			const viewLink = owner.getByRole("link", { name, exact: true }).first();
			yield* viewLink.waitFor({ state: "visible" });
			expect(yield* viewLink.locator('[data-app-icon="dumbbell"]').count).toBe(1);
			const viewId = requirePresent(
				owner.url().split("/v/c/")[1],
				"Expected a custom saved-view route",
			);
			yield* owner.goto(`${getFrontendUrl()}/settings/pages`);
			yield* owner.getByRole("button", { exact: true, name: `Manage ${name}` }).click();
			yield* owner
				.getByLabel("Paste source", { exact: true })
				.fill(source(`Draft changes ${suffix}`));
			yield* owner.getByRole("button", { exact: true, name: "Add pasted file" }).click();
			yield* owner.getByRole("button", { exact: true, name: "Grant write access" }).click();
			yield* owner.getByRole("button", { exact: true, name: "Revoke write access" }).click();
			yield* owner
				.getByRole("button", { exact: true, name: "Grant write access" })
				.waitFor({ state: "visible" });
			expect(yield* owner.getByRole("button", { name: "Preview compiled draft" }).count).toBe(0);
			yield* owner.getByRole("button", { exact: true, name: "Save draft" }).click();
			yield* owner.getByText("Draft saved.", { exact: true }).waitFor({ state: "visible" });
			yield* owner.goto(previewUrl);
			yield* owner
				.getByRole("heading", { exact: true, name: "Preview unavailable" })
				.waitFor({ state: "visible" });
			yield* owner.goto(`${getFrontendUrl()}/v/c/${viewId}`);
			yield* owner
				.locator("iframe")
				.contentFrame()
				.getByRole("heading", { exact: true, name: marker })
				.waitFor({ state: "visible" });
			yield* owner.goto(`${getFrontendUrl()}/settings/pages`);
			yield* owner.getByRole("button", { exact: true, name: `Manage ${name}` }).click();
			yield* owner.getByRole("button", { exact: true, name: "Delete page" }).click();
			const dialog = owner.getByRole("dialog", { name: "Delete this page?" });
			yield* dialog.getByRole("button", { exact: true, name: "Delete page" }).click();
			yield* dialog
				.getByText(
					"This page is used by a saved view or publication. Remove those references before deleting it.",
					{ exact: true },
				)
				.waitFor({ state: "visible" });
			const pages = yield* executeRyotQLRecipe(client, pagesRecipe, {});
			const page = requirePresent(
				pages.items.find((candidate) => candidate.name === name),
				"Expected authored page",
			);
			const views = yield* client.call((api) =>
				api.savedViews.delete({
					payload: { reference: { kind: "custom", savedViewId: SavedViewId.make(viewId) } },
				}),
			);
			expect(views.id).toBe(SavedViewId.make(viewId));
			yield* dialog.getByRole("button", { exact: true, name: "Delete page" }).click();
			yield* owner
				.getByRole("button", { exact: true, name: "New page" })
				.waitFor({ state: "visible" });
			expect(yield* executeRyotQLRecipe(client, pageRecipe, { pageId: page.id })).toBeUndefined();
		}).pipe(PlaywrightSpawner.withBrowser),
);

it.live("keeps local changes on a stale draft and requires explicit reload", () =>
	Effect.gen(function* () {
		const { email, client, password } = yield* createAuthenticatedClient();
		const suffix = yield* randomUuid;
		const definition = {
			pluginDependencies: {},
			entry: "client/page.tsx",
			queries: { queries: {} },
			files: [
				{
					path: "client/page.tsx",
					content: Buffer.from(source("Initial draft")).toString("base64"),
				},
			],
		};
		const page = yield* client.call((api) =>
			api.pageAuthoring.create({
				payload: { definition, name: `Conflict ${suffix}`, slug: `conflict-${suffix}` },
			}),
		);
		const browser = yield* Playwright.Browser;
		const owner = yield* browser.newPage();
		yield* signInThroughHostedOAuth(owner, email, password);
		yield* owner.goto(`${getFrontendUrl()}/settings/pages`);
		yield* owner.getByRole("button", { exact: true, name: `Manage Conflict ${suffix}` }).click();
		yield* owner.getByLabel("Entry file", { exact: true }).waitFor({ state: "visible" });
		yield* client.call((api) =>
			api.pageAuthoring.replaceDraft({
				payload: { definition, pageId: page.pageId, expectedDraftRevision: 1 },
			}),
		);
		yield* owner.getByLabel("Paste source", { exact: true }).fill(source("Local draft"));
		yield* owner.getByRole("button", { exact: true, name: "Add pasted file" }).click();
		yield* owner.getByRole("button", { exact: true, name: "Save draft" }).click();
		yield* owner
			.getByText(
				"This draft changed elsewhere. Reload the latest draft before saving again. Your changes have not been saved.",
				{ exact: true },
			)
			.waitFor({ state: "visible" });
		expect(yield* owner.getByRole("button", { exact: true, name: "Save draft" }).isDisabled()).toBe(
			true,
		);
		expect(
			(yield* executeRyotQLRecipe(client, pageRecipe, { pageId: page.pageId }))?.draftRevision,
		).toBe(2);
		yield* owner
			.getByRole("button", { exact: true, name: "Reload latest draft (discard local changes)" })
			.click();
		yield* owner.getByText(/Draft 2/).waitFor({ state: "visible" });
		yield* owner.getByRole("button", { exact: true, name: "Compile draft" }).click();
		yield* owner
			.getByRole("button", { exact: true, name: "Preview compiled draft" })
			.waitFor({ state: "visible" });
	}).pipe(PlaywrightSpawner.withBrowser),
);
