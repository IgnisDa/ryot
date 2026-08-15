import { PluginSlug } from "@ryot-app/contract/schema/brands";
import { Effect } from "effect";

import {
	createAuthenticatedClient,
	fixtureClientPluginPackage,
	fixtureClientPluginPackageWithSemanticFailure,
	installPrivatePluginPackage,
	settledPrivateInstallation,
} from "~/fixtures/kernel";
import { assertTaggedError } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

const uniquePluginSlug = (purpose: string) =>
	PluginSlug.make(`e2e-client-${purpose}-${crypto.randomUUID()}`);

describe("client plugin semantic compilation", () => {
	it.live("rejects a fresh private plugin with semantically invalid client TSX", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const pluginSlug = uniquePluginSlug("semantic-invalid");
			const pluginPackage = yield* fixtureClientPluginPackageWithSemanticFailure(pluginSlug);

			const failure = yield* Effect.flip(
				installPrivatePluginPackage({ client, config: {}, pluginPackage }),
			);

			assertTaggedError(failure, "PluginRequestError");
			expect(failure).toMatchObject({
				reason: {
					code: "compilation-failed",
					diagnostics: [
						{
							line: 1,
							code: "TS2322",
							phase: "compile",
							severity: "error",
							file: "client/index.tsx",
						},
					],
				},
			});
			expect(
				(yield* client.call((contract) => contract.plugins.list())).map(({ slug }) => slug),
			).not.toContain(pluginSlug);
		}),
	);

	it.live("installs a valid typed private client plugin through the upload path", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const pluginSlug = uniquePluginSlug("typed-valid");
			const pluginPackage = yield* fixtureClientPluginPackage("A", "", pluginSlug);

			yield* installPrivatePluginPackage({ client, config: {}, pluginPackage });
			const installation = yield* settledPrivateInstallation(client, pluginSlug);

			expect(installation).toMatchObject({ health: "ready", slug: pluginSlug, isDisabled: false });
			expect(installation.sourceHash).toMatch(/^[0-9a-f]{64}$/);
		}),
	);
});
