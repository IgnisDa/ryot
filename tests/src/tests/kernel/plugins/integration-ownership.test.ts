import type { ContractPayload } from "@ryot/contract/client";
import { Effect } from "effect";

import {
	createAuthenticatedClient,
	createIntegration,
	deleteIntegration,
	installTestIntegrationProvider,
	uninstallTestPluginStrict,
} from "~/fixtures";
import { assertTaggedError } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

type PluginManifest = ContractPayload<"plugins", "install">["manifest"];

const settingsSchema = {
	unknownKeys: "strict",
	fields: { endpoint: { type: "string", label: "Endpoint", description: "Provider URL" } },
} satisfies PluginManifest["integrationProviders"][number]["settingsSchema"];

describe("plugin integration ownership", () => {
	it.live("blocks uninstall until its integration is deleted", () =>
		Effect.gen(function* () {
			const { plugin, providerSlug } = yield* Effect.acquireRelease(
				installTestIntegrationProvider(settingsSchema),
				({ plugin: installed }) => uninstallTestPluginStrict(installed).pipe(Effect.orDie),
			);
			const { client } = yield* createAuthenticatedClient();
			const created = yield* Effect.acquireRelease(
				createIntegration(client, {
					provider: providerSlug,
					providerSpecifics: { endpoint: "https://provider.example.com" },
				}),
				({ id }) =>
					deleteIntegration(client, id).pipe(
						Effect.catchTag("NotFound", () => Effect.void),
						Effect.asVoid,
						Effect.orDie,
					),
			);

			const conflict = yield* Effect.flip(uninstallTestPluginStrict(plugin));
			assertTaggedError(conflict, "Conflict");
			expect(conflict.message).toContain("integrations reference it");

			yield* deleteIntegration(client, created.id);
			yield* uninstallTestPluginStrict(plugin);
			expect(plugin.active).toBe(false);
		}),
	);
});
