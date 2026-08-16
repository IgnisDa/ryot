import { IntegrationId, UserId } from "@ryot-app/contract/schema/brands";
import { expect, it } from "vitest";

import type { RegisteredIntegrationProvider } from "#modules/plugins/integration-provider-catalog";

import { redactIntegrationForClient } from "./client-redaction";
import type { IntegrationRecord } from "./repository";

const integration = (): IntegrationRecord => ({
	lot: "yank",
	isDisabled: false,
	minimumProgress: 2,
	maximumProgress: 95,
	syncOwnership: false,
	lastFinishedAt: null,
	pluginSlug: "example",
	name: "Test integration",
	provider: "test-provider",
	userId: UserId.make("user-1"),
	createdAt: "2026-07-27T00:00:00.000Z",
	updatedAt: "2026-07-27T00:00:00.000Z",
	id: IntegrationId.make("integration-1"),
	pluginInstallationId: "example-installation",
	extraSettings: { disableOnContinuousErrors: false },
	providerSpecifics: { token: "secret-token", endpoint: "https://provider.test" },
});

const registered = (
	fields: RegisteredIntegrationProvider["settingsSchema"]["fields"],
): RegisteredIntegrationProvider => ({
	lot: "yank",
	pluginSlug: "example",
	name: "Test provider",
	pluginScope: "system",
	slug: "test-provider",
	description: "Test yank",
	settingsSchema: { fields },
	pluginId: "example-plugin-id",
	installationId: "example-installation",
	scriptSlug: "integration.test-provider",
	configContext: {
		kind: "revision",
		ownerUserId: null,
		configSchema: { fields: {} },
		pluginConfigRevisionId: null,
		pluginRevisionId: "example-revision-id",
	},
});

it("omits top-level secret settings and keeps nonsecret siblings", () => {
	const record = integration();
	const provider = registered({
		endpoint: { type: "string", label: "Endpoint", description: "Server URL" },
		token: { secret: true, type: "string", label: "Token", description: "API token" },
	});

	expect(redactIntegrationForClient(provider, record).providerSpecifics).toEqual({
		endpoint: "https://provider.test",
	});
	expect(record.providerSpecifics).toMatchObject({ token: "secret-token" });
});

it("returns credentials when a registry-known provider does not mark them secret", () => {
	const provider = registered({
		token: { type: "string", label: "Token", description: "API token" },
		endpoint: { type: "string", label: "Endpoint", description: "Server URL" },
	});

	expect(redactIntegrationForClient(provider, integration()).providerSpecifics).toMatchObject({
		token: "secret-token",
	});
});

it("omits nested object secrets and keeps nonsecret siblings", () => {
	const providerSpecifics = {
		endpoint: "https://provider.test",
		credentials: { username: "alice", password: "secret-password" },
	};
	const provider = registered({
		endpoint: { type: "string", label: "Endpoint", description: "Server URL" },
		credentials: {
			type: "object",
			label: "Credentials",
			description: "Provider credentials",
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
	});
	const record = { ...integration(), providerSpecifics };

	expect(redactIntegrationForClient(provider, record).providerSpecifics).toEqual({
		endpoint: "https://provider.test",
		credentials: { username: "alice" },
	});
});

it("omits secret array items and secrets inside array objects", () => {
	const providerSpecifics = {
		tokens: ["secret-one", "secret-two"],
		accounts: [
			{ name: "first", token: "secret-first" },
			{ name: "second", token: "secret-second" },
		],
	};
	const provider = registered({
		tokens: {
			type: "array",
			label: "Tokens",
			description: "API tokens",
			items: { secret: true, type: "string", label: "Token", description: "API token" },
		},
		accounts: {
			type: "array",
			label: "Accounts",
			description: "Provider accounts",
			items: {
				type: "object",
				label: "Account",
				description: "Provider account",
				properties: {
					name: { label: "Name", type: "string", description: "Account name" },
					token: { secret: true, type: "string", label: "Token", description: "API token" },
				},
			},
		},
	});
	const record = { ...integration(), providerSpecifics };

	expect(redactIntegrationForClient(provider, record).providerSpecifics).toEqual({
		tokens: [],
		accounts: [{ name: "first" }, { name: "second" }],
	});
});

it("does not mutate nested stored settings while redacting", () => {
	const providerSpecifics = {
		accounts: [{ name: "first", token: "secret-account" }],
		credentials: { label: "primary", token: "secret-token" },
	};
	const stored = structuredClone(providerSpecifics);
	const secret = {
		secret: true,
		type: "string",
		label: "Token",
		description: "API token",
	} as const;
	const provider = registered({
		credentials: {
			type: "object",
			label: "Credentials",
			description: "Provider credentials",
			properties: {
				token: secret,
				label: { type: "string", label: "Label", description: "Credential label" },
			},
		},
		accounts: {
			type: "array",
			label: "Accounts",
			description: "Provider accounts",
			items: {
				type: "object",
				label: "Account",
				description: "Provider account",
				properties: {
					token: secret,
					name: { label: "Name", type: "string", description: "Account name" },
				},
			},
		},
	});

	redactIntegrationForClient(provider, { ...integration(), providerSpecifics });

	expect(providerSpecifics).toEqual(stored);
});

it("keeps only a string kind when the registry provider is unavailable", () => {
	const providerSpecifics = {
		kind: "test-kind",
		token: "secret-token",
		password: "secret-password",
	};
	const record = { ...integration(), providerSpecifics };

	expect(redactIntegrationForClient(null, record).providerSpecifics).toEqual({ kind: "test-kind" });
	expect(providerSpecifics).toEqual({
		kind: "test-kind",
		token: "secret-token",
		password: "secret-password",
	});
});

it("removes all provider settings without a string kind when the registry provider is unavailable", () => {
	const providerSpecifics = { kind: 1, token: "secret-token" };
	const record = { ...integration(), providerSpecifics };

	expect(redactIntegrationForClient(null, record).providerSpecifics).toEqual({});
	expect(providerSpecifics).toEqual({ kind: 1, token: "secret-token" });
});
