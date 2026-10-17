import { Effect } from "effect";

import {
	checkClientPageFreshness,
	createAuthenticatedClient,
	installNamespacePackage,
	pluginNamespacePackages,
	updateNamespacePackage,
} from "~/fixtures/kernel";
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
});
