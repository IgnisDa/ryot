import { pluginPath, savedViewPath } from "@ryot-app/contract/modules/plugins/navigation";
import { Effect } from "effect";
import { Playwright, PlaywrightSpawner } from "effect-playwright";

import {
	createAuthenticatedClient,
	adminHeaders,
	getApiClient,
	getSavedView,
	installTestSupportSystemPlugin,
	checkClientPageFreshness,
	installNamespacePackage,
	pluginNamespacePackages,
	updateNamespacePackage,
	pollUntil,
} from "~/fixtures/kernel";
import { signInThroughHostedOAuth } from "~/support/browser";
import { assert, describe, expect, it } from "~/support/effect-test";
import { getFrontendUrl } from "~/support/harness-target";

describe("Whiskey namespace workspaces", () => {
	for (const viewport of [
		{ width: 1280, height: 900 },
		{ width: 390, height: 844 },
	]) {
		it.live(
			`keeps contributor identity, operations, views and storage separate at ${viewport.width}px`,
			() =>
				Effect.gen(function* () {
					const user = yield* createAuthenticatedClient();
					const packages = pluginNamespacePackages({ compose: true });
					const b = yield* installNamespacePackage(user.client, packages.b);
					const a = yield* installNamespacePackage(user.client, packages.a);
					const aView = { slug: "all-bottles", pluginId: a.pluginId, kind: "plugin" as const };
					const bView = { slug: "all-bottles", pluginId: b.pluginId, kind: "plugin" as const };
					yield* user.client.call((contract) =>
						contract.savedViews.update({ payload: { isHidden: true, reference: aView } }),
					);
					expect((yield* getSavedView(user.client, aView)).isHidden).toBe(true);
					expect((yield* getSavedView(user.client, bView)).isHidden).toBe(false);
					yield* user.client.call((contract) =>
						contract.savedViews.update({ payload: { isHidden: false, reference: aView } }),
					);
					for (const [installed, reference] of [
						[a, aView],
						[b, bView],
					] as const) {
						yield* user.client.call((contract) =>
							contract.plugins.setHomeView({
								payload: { savedView: reference },
								params: { installationId: installed.id },
							}),
						);
					}
					const originalView = yield* user.client.call((contract) =>
						contract.clientPages.prepare({
							payload: { target: { reference: aView, kind: "saved-view" } },
						}),
					);
					assert(originalView.identity.kind === "plugin-saved-view");
					expect(
						originalView.identity.contributors.filter(
							(contributor) => contributor.kind === "plugin",
						),
					).toEqual(
						expect.arrayContaining([
							expect.objectContaining({
								pluginId: a.pluginId,
								installationId: a.id,
								packageId: packages.a.manifest.metadata.packageId,
							}),
							expect.objectContaining({
								pluginId: b.pluginId,
								installationId: b.id,
								packageId: packages.b.manifest.metadata.packageId,
							}),
						]),
					);
					expect(originalView.identity.operationTargets).toEqual(
						expect.arrayContaining([
							{
								pluginId: a.pluginId,
								installationId: a.id,
								sourceHash: a.installation.sourceHash,
								packageId: packages.a.manifest.metadata.packageId,
							},
							{
								pluginId: b.pluginId,
								installationId: b.id,
								sourceHash: b.installation.sourceHash,
								packageId: packages.b.manifest.metadata.packageId,
							},
						]),
					);
					const browser = yield* Playwright.Browser;
					const page = yield* browser.newPage({ viewport });
					yield* signInThroughHostedOAuth(page, user.email, user.password);
					yield* page.goto(`${getFrontendUrl()}${pluginPath(a.installation.packageId)}`);
					const frame = page.locator("iframe").filter({ visible: true }).contentFrame();
					const alice = frame.getByTestId("catalog-A1");
					const bob = frame.getByTestId("catalog-B1");
					yield* alice.waitFor({ state: "visible" });
					yield* bob.waitFor({ state: "visible" });
					expect(yield* alice.getByTestId("contributor-owner").textContent()).toBe(a.pluginId);
					expect(yield* bob.getByTestId("contributor-owner").textContent()).toBe(b.pluginId);
					yield* alice
						.getByTestId("bottle-names")
						.getByText("A1 bottle", { exact: true })
						.waitFor({ state: "visible" });
					yield* bob
						.getByTestId("bottle-names")
						.getByText("B1 bottle", { exact: true })
						.waitFor({ state: "visible" });
					yield* alice.getByRole("button", { exact: true, name: "Store A1" }).click();
					yield* bob.getByRole("button", { exact: true, name: "Store B1" }).click();
					for (const [catalog, label] of [
						[alice, "A1"],
						[bob, "B1"],
					] as const) {
						yield* catalog.getByRole("button", { exact: true, name: `Invoke ${label}` }).click();
						yield* catalog
							.getByTestId("operation-result")
							.getByText(label, { exact: true })
							.waitFor({ state: "visible" });
						expect(yield* catalog.getByTestId("storage-value").textContent()).toBe(label);
					}
					yield* page.goto(`${getFrontendUrl()}${pluginPath(b.installation.packageId)}`);
					const bFrame = page.locator("iframe").filter({ visible: true }).contentFrame();
					yield* bFrame.getByTestId("catalog-B1").waitFor({ state: "visible" });
					yield* pollUntil(
						"B device storage hydration",
						bFrame
							.getByTestId("catalog-B1")
							.getByTestId("storage-value")
							.textContent()
							.pipe(Effect.map((value) => (value === "B1" ? true : null))),
					);
					expect(
						yield* bFrame.getByTestId("catalog-B1").getByTestId("storage-value").textContent(),
					).toBe("B1");
					yield* updateNamespacePackage(user.client, a, packages.a2);
					const updatedView = yield* user.client.call((contract) =>
						contract.clientPages.prepare({
							payload: { target: { reference: aView, kind: "saved-view" } },
						}),
					);
					assert(updatedView.identity.kind === "plugin-saved-view");
					expect(updatedView.identity.savedViewId).toBe(originalView.identity.savedViewId);
					yield* page.goto(`${getFrontendUrl()}${pluginPath(a.installation.packageId)}`);
					const updated = page.locator("iframe").filter({ visible: true }).contentFrame();
					yield* updated.getByTestId("catalog-A2").waitFor({ state: "visible" });
					yield* pollUntil(
						"A device storage survives upgrade",
						updated
							.getByTestId("catalog-A2")
							.getByTestId("storage-value")
							.textContent()
							.pipe(Effect.map((value) => (value === "A1" ? true : null))),
					);
					expect(
						yield* updated.getByTestId("catalog-A2").getByTestId("storage-value").textContent(),
					).toBe("A1");
					yield* updated
						.getByTestId("catalog-A2")
						.getByRole("button", { exact: true, name: "Invoke A2" })
						.click();
					yield* pollUntil(
						"A uses its upgraded operation",
						updated
							.getByTestId("catalog-A2")
							.getByTestId("operation-result")
							.textContent()
							.pipe(Effect.map((value) => (value === "A2" ? true : null))),
					);
					yield* updated
						.getByTestId("catalog-B1")
						.getByRole("button", { exact: true, name: "Invoke B1" })
						.click();
					yield* pollUntil(
						"B operation remains independent",
						updated
							.getByTestId("catalog-B1")
							.getByTestId("operation-result")
							.textContent()
							.pipe(Effect.map((value) => (value === "B1" ? true : null))),
					);
					yield* page.goto(
						`${getFrontendUrl()}${savedViewPath({ kind: "plugin", slug: "all-bottles", packageId: b.installation.packageId })}`,
					);
					yield* page
						.locator("iframe")
						.filter({ visible: true })
						.contentFrame()
						.getByTestId("catalog-B1")
						.waitFor({ state: "visible" });
					expect(new URL(page.url()).pathname).toBe(
						savedViewPath({
							kind: "plugin",
							slug: "all-bottles",
							packageId: b.installation.packageId,
						}),
					);
					const contributor = yield* installNamespacePackage(user.client, packages.contributor);
					const aliasComposition = yield* user.client.call((contract) =>
						contract.clientPages.prepare({
							payload: {
								target: {
									path: "/",
									search: "",
									kind: "plugin-route",
									packageId: contributor.installation.packageId,
								},
							},
						}),
					);
					expect(
						aliasComposition.identity.contributors
							.filter((candidate) => candidate.kind === "plugin")
							.map(({ pluginId }) => pluginId)
							.sort(),
					).toEqual([a.pluginId, b.pluginId, contributor.pluginId].sort());
					yield* page.goto(`${getFrontendUrl()}${pluginPath(contributor.installation.packageId)}`);
					const contributorFrame = page.locator("iframe").filter({ visible: true }).contentFrame();
					yield* contributorFrame.getByTestId("catalog-Contributor").waitFor({ state: "visible" });
					yield* contributorFrame.getByTestId("catalog-A2").waitFor({ state: "visible" });
					expect(
						yield* contributorFrame
							.getByTestId("catalog-A2")
							.getByTestId("contributor-owner")
							.textContent(),
					).toBe(a.pluginId);
					yield* page.goto(`${getFrontendUrl()}${pluginPath(a.installation.packageId)}`);
					const system = yield* installTestSupportSystemPlugin(packages.claim);
					yield* Effect.addFinalizer(() =>
						getApiClient()
							.call(
								(contract) =>
									contract.testSupport.uninstallSystemPlugin({
										params: { pluginId: system.pluginId, activationId: system.activationId },
									}),
								adminHeaders(),
							)
							.pipe(Effect.ignore),
					);
					expect((yield* checkClientPageFreshness(user.client, updatedView.identity)).current).toBe(
						false,
					);
					yield* page.reload;
					yield* page
						.getByRole("heading", { level: 1 })
						.filter({ visible: true })
						.waitFor({ state: "visible" });
					expect(new URL(page.url()).pathname).toBe(pluginPath(a.installation.packageId));
					expect(yield* page.locator("iframe").filter({ visible: true }).count).toBe(0);
					yield* page.close;
				}).pipe(PlaywrightSpawner.withBrowser),
		);
	}
});
