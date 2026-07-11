import { IntegrationId, UserId } from "@ryot/contract/schema/brands";
import { expect, it } from "vitest";

import type { RegisteredIntegrationProvider } from "#modules/plugins/integration-provider-catalog";

import { redactIntegrationForClient, type RegisteredProviderLookup } from "./client-redaction";
import type { IntegrationRecord } from "./repository";

const integration = (): IntegrationRecord => ({
	lot: "yank",
	name: "Plex",
	isDisabled: false,
	minimumProgress: 2,
	maximumProgress: 95,
	syncOwnership: false,
	lastFinishedAt: null,
	provider: "plex_yank",
	userId: UserId.make("user-1"),
	createdAt: "2026-07-27T00:00:00.000Z",
	updatedAt: "2026-07-27T00:00:00.000Z",
	id: IntegrationId.make("integration-1"),
	extraSettings: { disableOnContinuousErrors: false },
	providerSpecifics: { kind: "plex_yank", token: "secret-token", baseUrl: "https://plex.test" },
});

const registered = (secret: boolean): RegisteredIntegrationProvider => ({
	lot: "yank",
	name: "Plex",
	slug: "plex_yank",
	pluginSlug: "media",
	description: "Plex yank",
	scriptSlug: "media.plex",
	settingsSchema: {
		fields: {
			baseUrl: { type: "string", label: "Base URL", description: "Server URL" },
			token: {
				type: "string",
				label: "Token",
				description: "API token",
				...(secret ? { secret: true } : {}),
			},
		},
	},
});

const lookup =
	(provider: RegisteredIntegrationProvider | null): RegisteredProviderLookup =>
	() =>
		provider;

it("omits secret settings keys and keeps the rest for a registry-known provider", () => {
	const record = integration();

	expect(redactIntegrationForClient(lookup(registered(true)), record).providerSpecifics).toEqual({
		kind: "plex_yank",
		baseUrl: "https://plex.test",
	});
	expect(record.providerSpecifics).toMatchObject({ token: "secret-token" });
});

it("returns credentials verbatim when no registry provider marks a field secret", () => {
	expect(
		redactIntegrationForClient(lookup(registered(false)), integration()).providerSpecifics,
	).toMatchObject({ token: "secret-token" });
	expect(redactIntegrationForClient(lookup(null), integration()).providerSpecifics).toMatchObject({
		token: "secret-token",
	});
});
