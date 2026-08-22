import { PluginSlug } from "@ryot-app/contract/schema/brands";
import { Effect } from "effect";

import {
	createAuthenticatedClient,
	fixtureClientPluginPackage,
	installPrivatePluginPackage,
	settledPrivateInstallation,
} from "~/fixtures/kernel";
import { describe, expect, it } from "~/support/effect-test";

const uniquePluginSlug = (purpose: string) =>
	PluginSlug.make(`e2e-client-${purpose}-${crypto.randomUUID()}`);

describe("precompiled client plugin artifacts", () => {
	it.live("installs a valid typed private client plugin through the upload path", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const pluginSlug = uniquePluginSlug("typed-valid");
			const pluginPackage = yield* fixtureClientPluginPackage("A", "", pluginSlug);
			expect(pluginPackage.compiledScripts.length).toBeGreaterThan(0);
			expect(pluginPackage.compiledClient).toBeDefined();

			yield* installPrivatePluginPackage({ client, config: {}, pluginPackage });
			const installation = yield* settledPrivateInstallation(client, pluginSlug);

			expect(installation).toMatchObject({ health: "ready", slug: pluginSlug, isDisabled: false });
			expect(installation.sourceHash).toMatch(/^[0-9a-f]{64}$/);
		}),
	);
});
