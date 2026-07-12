import { IntegrationId } from "@ryot/contract/schema/brands";
import type { PluginManifest } from "@ryot/plugin-kit/manifest";
import { Effect } from "effect";

import {
	createAuthenticatedClient,
	createIntegration,
	deleteIntegration,
	getIntegration,
	installTestIntegrationProvider,
	listIntegrations,
	uninstallTestPluginStrict,
} from "~/fixtures";
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
	it.scopedLive("redacts nested secrets from every integration read response", () =>
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
			expect(created).not.toHaveProperty("providerSpecifics");

			const expectedCreatedSettings = {
				credentials: { username: "alice" },
				endpoint: "https://provider.example.com",
				accounts: [{ name: "primary" }, { name: "backup" }],
			};
			const fetched = yield* getIntegration(client, created.id);
			expect(fetched.providerSpecifics).toEqual(expectedCreatedSettings);

			const listed = requirePresent(
				(yield* listIntegrations(client)).find(({ id }) => id === created.id),
				"Expected dynamically installed provider integration in list",
			);
			expect(listed.providerSpecifics).toEqual(expectedCreatedSettings);

			const updated = yield* client.call((c) =>
				c.integrations.update({
					path: { integrationId: IntegrationId.make(created.id) },
					payload: {
						name: "Updated dynamic provider",
						providerSpecifics: {
							accounts: [{ name: "replacement", token: "update-token" }],
							credentials: { username: "bob", password: "update-password" },
						},
					},
				}),
			);
			expect(updated.name).toBe("Updated dynamic provider");
			expect(updated.providerSpecifics).toEqual({
				credentials: { username: "bob" },
				accounts: [{ name: "replacement" }],
				endpoint: "https://provider.example.com",
			});
		}),
	);
});
