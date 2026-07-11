import { IntegrationId, UserId } from "@ryot/contract/schema/brands";
import { expect, it } from "vitest";

import type { RegisteredIntegrationProvider } from "#modules/plugins/integration-provider-catalog";

import { redactIntegrationForClient, type RegisteredProviderLookup } from "./client-redaction";
import type { IntegrationRecord } from "./repository";

const integration = (): IntegrationRecord => ({
	lot: "yank",
	name: "Test integration",
	isDisabled: false,
	minimumProgress: 2,
	maximumProgress: 95,
	syncOwnership: false,
	lastFinishedAt: null,
	provider: "test-provider",
	userId: UserId.make("user-1"),
	createdAt: "2026-07-27T00:00:00.000Z",
	updatedAt: "2026-07-27T00:00:00.000Z",
	id: IntegrationId.make("integration-1"),
	extraSettings: { disableOnContinuousErrors: false },
	providerSpecifics: { token: "secret-token", endpoint: "https://provider.test" },
});

const registered = (secret: boolean): RegisteredIntegrationProvider => ({
	lot: "yank",
	name: "Test provider",
	slug: "test-provider",
	pluginSlug: "media",
	description: "Test yank",
	scriptSlug: "integration.test-provider",
	settingsSchema: {
		fields: {
			endpoint: { type: "string", label: "Endpoint", description: "Server URL" },
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
		endpoint: "https://provider.test",
	});
	expect(record.providerSpecifics).toMatchObject({ token: "secret-token" });
});

it("returns credentials when a registry-known provider does not mark them secret", () => {
	expect(
		redactIntegrationForClient(lookup(registered(false)), integration()).providerSpecifics,
	).toMatchObject({ token: "secret-token" });
});

it("keeps only a string kind when the registry provider is unavailable", () => {
	const providerSpecifics = {
		kind: "test-kind",
		token: "secret-token",
		password: "secret-password",
	};
	const record = { ...integration(), providerSpecifics };

	expect(redactIntegrationForClient(lookup(null), record).providerSpecifics).toEqual({
		kind: "test-kind",
	});
	expect(providerSpecifics).toEqual({
		kind: "test-kind",
		token: "secret-token",
		password: "secret-password",
	});
});

it("removes all provider settings without a string kind when the registry provider is unavailable", () => {
	const providerSpecifics = { kind: 1, token: "secret-token" };
	const record = { ...integration(), providerSpecifics };

	expect(redactIntegrationForClient(lookup(null), record).providerSpecifics).toEqual({});
	expect(providerSpecifics).toEqual({ kind: 1, token: "secret-token" });
});
