import type { PluginManifest } from "@ryot-app/contract/modules/plugins/manifest";
import { IntegrationId } from "@ryot-app/contract/schema/brands";
import { integrationRecipe } from "@ryot-app/ryotql-recipes/integrations";
import { Effect, Option } from "effect";

import {
	createAuthenticatedClient,
	createIntegration,
	deleteIntegration,
	executeRyotQLRecipe,
	installTestIntegrationProvider,
	uninstallTestPluginStrict,
} from "~/fixtures/kernel";
import { requirePresent } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

const settingsSchema = {
	unknownKeys: "strict",
	fields: {
		endpoint: { type: "string", label: "Endpoint", description: "Provider URL" },
		credentials: {
			type: "object",
			label: "Credentials",
			unknownKeys: "strict",
			description: "Account credentials",
			properties: {
				username: { type: "string", label: "Username", description: "Account name" },
				password: {
					secret: true,
					type: "string",
					label: "Password",
					description: "Account password",
				},
			},
		},
		accounts: {
			type: "array",
			label: "Accounts",
			description: "Provider accounts",
			items: {
				type: "object",
				label: "Account",
				unknownKeys: "strict",
				description: "Provider account",
				properties: {
					name: { label: "Name", type: "string", description: "Account label" },
					token: { secret: true, type: "string", label: "Token", description: "Account token" },
				},
			},
		},
	},
} satisfies PluginManifest["integrationProviders"][number]["settingsSchema"];

describe("third-party integration provider redaction", () => {
	it.live("redacts nested secrets after integration writes are re-queried", () =>
		Effect.gen(function* () {
			const { providerSlug } = yield* Effect.acquireRelease(
				installTestIntegrationProvider(settingsSchema),
				({ plugin: installed }) => uninstallTestPluginStrict(installed).pipe(Effect.orDie),
			);
			const { client } = yield* createAuthenticatedClient();
			const created = yield* Effect.acquireRelease(
				createIntegration(client, {
					provider: providerSlug,
					name: "Dynamic provider",
					providerSpecifics: {
						endpoint: "https://provider.example.com",
						credentials: { username: "alice", password: "create-password" },
						accounts: [
							{ name: "primary", token: "create-primary-token" },
							{ name: "backup", token: "create-backup-token" },
						],
					},
				}),
				({ id }) => deleteIntegration(client, id).pipe(Effect.asVoid, Effect.orDie),
			);
			const listed = requirePresent(
				Option.getOrUndefined(
					yield* executeRyotQLRecipe(client, integrationRecipe({ id: created.id })),
				),
				"Expected created integration",
			);
			expect(listed.providerSpecifics).toEqual({
				credentials: { username: "alice" },
				endpoint: "https://provider.example.com",
				accounts: [{ name: "primary" }, { name: "backup" }],
			});
			const updated = yield* client.call((c) =>
				c.integrations.update({
					params: { integrationId: IntegrationId.make(created.id) },
					payload: {
						name: "Updated dynamic provider",
						providerSpecifics: {
							accounts: [{ name: "replacement", token: "update-token" }],
							credentials: { username: "bob", password: "update-password" },
						},
					},
				}),
			);
			expect(updated).toEqual({ id: created.id });
			const detail = requirePresent(
				Option.getOrUndefined(
					yield* executeRyotQLRecipe(client, integrationRecipe({ id: created.id })),
				),
				"Expected updated integration",
			);
			expect(detail.name).toBe("Updated dynamic provider");
			expect(detail.providerSpecifics).toEqual({
				credentials: { username: "bob" },
				accounts: [{ name: "replacement" }],
				endpoint: "https://provider.example.com",
			});
		}),
	);
});
