import { Effect } from "effect";

import {
	checkClientPageFreshness,
	createAuthenticatedClient,
	installNamespacePackage,
	pluginNamespacePackages,
	setPluginHomeView,
	updateNamespacePackage,
} from "~/fixtures/kernel";
import { requirePresent } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

describe("client page freshness E2E", () => {
	it.live(
		"stays current when an unrelated plugin is installed and stales when its own changes",
		() =>
			Effect.gen(function* () {
				const { client } = yield* createAuthenticatedClient();
				const packages = pluginNamespacePackages();
				const a = yield* installNamespacePackage(client, packages.a);
				const prepared = yield* client.call((contract) =>
					contract.pages.prepare({
						payload: {
							target: {
								path: "/",
								search: "",
								kind: "plugin-route",
								packageId: a.installation.packageId,
							},
						},
					}),
				);
				expect((yield* checkClientPageFreshness(client, prepared.identity)).current).toBe(true);

				yield* installNamespacePackage(client, packages.b);
				expect((yield* checkClientPageFreshness(client, prepared.identity)).current).toBe(true);

				yield* updateNamespacePackage(client, a, packages.a2);
				expect((yield* checkClientPageFreshness(client, prepared.identity)).current).toBe(false);
			}),
	);

	it.live("stales a direct route when its selected home view changes", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const packages = pluginNamespacePackages();
			const clientDefinition = requirePresent(
				packages.a.manifest.client,
				"Namespace package is missing its client definition",
			);
			const pluginPackage = {
				...packages.a,
				manifest: { ...packages.a.manifest, client: { ...clientDefinition, homeView: null } },
			};
			const installed = yield* installNamespacePackage(client, pluginPackage);
			const target = {
				path: "/",
				search: "",
				kind: "plugin-route" as const,
				packageId: installed.installation.packageId,
			};
			const route = yield* client.call((contract) =>
				contract.pages.prepare({ payload: { target } }),
			);
			expect(route.identity.kind).toBe("plugin-page");

			const home = { slug: "all-bottles", kind: "plugin" as const, pluginId: installed.pluginId };
			yield* setPluginHomeView(client, installed.id, home);
			expect((yield* checkClientPageFreshness(client, route.identity)).current).toBe(false);
			const selected = yield* client.call((contract) =>
				contract.pages.prepare({ payload: { target } }),
			);
			expect(selected.identity).toMatchObject({ target, kind: "plugin-saved-view" });
			expect(selected.context.target).toEqual({ reference: home, kind: "saved-view" });
			expect((yield* checkClientPageFreshness(client, selected.identity)).current).toBe(true);

			yield* setPluginHomeView(client, installed.id, null);
			expect((yield* checkClientPageFreshness(client, selected.identity)).current).toBe(false);
			expect((yield* checkClientPageFreshness(client, route.identity)).current).toBe(true);
		}),
	);
});
