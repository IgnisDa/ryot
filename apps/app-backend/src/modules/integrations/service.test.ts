import { describe, expect, it } from "@effect/vitest";
import { SandboxScriptId } from "@ryot/contract/schema/brands";
import { Effect, Layer } from "effect";
import { WorkflowEngine } from "effect/unstable/workflow/WorkflowEngine";

import { databaseLayer, makeWorkflowEngine } from "#lib/test-utils/effect";
import { ImportsService } from "#modules/imports/service";
import {
	IntegrationProviderCatalog,
	type RegisteredIntegrationProvider,
} from "#modules/plugins/integration-provider-catalog";

import { IntegrationsRepository } from "./repository";
import { IntegrationsService, validateProgressThresholds } from "./service";
import { makeIntegration } from "./test-support";

describe("validateProgressThresholds", () => {
	it("returns null for valid thresholds", () => {
		expect(validateProgressThresholds(2, 95)).toBeNull();
		expect(validateProgressThresholds(0, 100)).toBeNull();
		expect(validateProgressThresholds(50, 50)).toBeNull();
	});

	it("rejects minimumProgress below 0", () => {
		expect(validateProgressThresholds(-1, 95)).toMatch(/minimumProgress/);
	});

	it("rejects minimumProgress above 100", () => {
		expect(validateProgressThresholds(101, 101)).toMatch(/minimumProgress/);
	});

	it("rejects maximumProgress above 100", () => {
		expect(validateProgressThresholds(2, 101)).toMatch(/maximumProgress/);
	});

	it("rejects minimum greater than maximum", () => {
		expect(validateProgressThresholds(96, 95)).toMatch(/minimumProgress must not exceed/);
	});
});

describe("client endpoints", () => {
	it.effect(
		"lists provider schemas and derives creatability from lot and script availability",
		() => {
			const yank = {
				lot: "yank",
				slug: "komga",
				name: "Komga",
				pluginSlug: "media",
				description: "Komga yank",
				settingsSchema: { fields: {} },
				scriptSlug: "integration.komga",
			} satisfies RegisteredIntegrationProvider;
			const inactiveSink = {
				lot: "sink",
				slug: "kodi",
				name: "Kodi",
				pluginSlug: "media",
				description: "Kodi sink",
				scriptSlug: "integration.kodi",
				settingsSchema: { fields: {} },
			} satisfies RegisteredIntegrationProvider;
			const push = {
				lot: "push",
				slug: "radarr",
				name: "Radarr",
				scriptSlug: null,
				pluginSlug: "media",
				description: "Radarr push",
				settingsSchema: { fields: {} },
			} satisfies RegisteredIntegrationProvider;
			const now = new Date(0);
			const activeScript = {
				metadata: {},
				name: "Komga",
				createdAt: now,
				updatedAt: now,
				source: "source",
				providerId: null,
				compiledFormat: 1,
				pluginSlug: "media",
				compiledCode: "compiled",
				slug: "integration.komga",
				contentHash: "content-hash",
				id: SandboxScriptId.make("active-script"),
			};
			const providerCatalog = Layer.mock(IntegrationProviderCatalog)({
				find: () => null,
				findOwned: () => null,
				list: () => [yank, inactiveSink, push],
				resolveOwned: (slug) => ({
					provider: slug === yank.slug ? yank : inactiveSink,
					script: slug === yank.slug ? Effect.succeed(activeScript) : Effect.succeed(null),
				}),
			});
			const layer = IntegrationsService.layer.pipe(
				Layer.provideMerge(
					Layer.mergeAll(
						databaseLayer,
						providerCatalog,
						Layer.mock(ImportsService, {}),
						Layer.mock(IntegrationsRepository, {}),
						Layer.succeed(WorkflowEngine, makeWorkflowEngine()),
					),
				),
			);

			return Effect.gen(function* () {
				const providers = yield* (yield* IntegrationsService).listIntegrationProviders();

				expect(providers.map(({ slug, isCreatable }) => [slug, isCreatable])).toEqual([
					["komga", true],
					["kodi", false],
					["radarr", true],
				]);
				expect(providers[0]?.commonSchema.fields).toMatchObject({
					name: { type: "string" },
					isDisabled: { type: "boolean", defaultValue: false },
					minimumProgress: { type: "number", defaultValue: 2 },
					maximumProgress: { type: "number", defaultValue: 95 },
					syncOwnership: { type: "boolean", defaultValue: false },
					disableOnContinuousErrors: { type: "boolean", defaultValue: false },
				});
				expect(providers[0]?.commonSchema.fields["minimumProgress"]?.validation).toEqual({
					minimum: 0,
					maximum: 100,
				});
				expect(providers[2]?.commonSchema.fields).not.toHaveProperty("minimumProgress");
				expect(providers[2]?.commonSchema.fields).not.toHaveProperty("syncOwnership");
				expect(providers[0]).not.toHaveProperty("scriptSlug");
			}).pipe(Effect.provide(layer));
		},
	);

	it.effect("gets an owned integration through client redaction", () => {
		const integration = makeIntegration({
			provider: "komga",
			providerSpecifics: { kind: "komga", baseUrl: "https://komga.test", token: "secret" },
		});
		const registered = {
			lot: "yank",
			slug: "komga",
			name: "Komga",
			description: "Komga yank",
			scriptSlug: "integration.komga",
			pluginSlug: integration.pluginSlug,
			settingsSchema: {
				fields: {
					kind: { type: "string", label: "Kind", description: "Kind" },
					baseUrl: { type: "string", label: "Base URL", description: "Base URL" },
					token: { type: "string", label: "Token", description: "Token", secret: true },
				},
			},
		} satisfies RegisteredIntegrationProvider;
		const layer = IntegrationsService.layer.pipe(
			Layer.provideMerge(
				Layer.mergeAll(
					databaseLayer,
					Layer.mock(ImportsService, {}),
					Layer.mock(IntegrationsRepository, {
						getForUser: () => Effect.succeed(integration),
					}),
					Layer.mock(IntegrationProviderCatalog, {
						find: () => null,
						list: () => [registered],
						findOwned: () => registered,
						resolveOwned: () => null,
					}),
					Layer.succeed(WorkflowEngine, makeWorkflowEngine()),
				),
			),
		);

		return Effect.gen(function* () {
			const listed = yield* (yield* IntegrationsService).getForClient(
				integration.userId,
				integration.id,
			);

			expect(listed.providerSpecifics).toEqual({
				kind: "komga",
				baseUrl: "https://komga.test",
			});
		}).pipe(Effect.provide(layer));
	});
});

describe("update", () => {
	it.effect("preserves a stored secret omitted from a provider settings update", () => {
		const registered = {
			lot: "yank",
			pluginSlug: "media",
			name: "Audiobookshelf",
			slug: "audiobookshelf",
			description: "Test yank",
			scriptSlug: "integration.audiobookshelf",
			settingsSchema: {
				fields: {
					kind: {
						type: "enum",
						label: "Provider kind",
						validation: { required: true },
						description: "Integration provider discriminator",
						choices: { kind: "static", values: [{ value: "audiobookshelf" }] },
					},
					baseUrl: {
						type: "string",
						label: "Base URL",
						validation: { required: true },
						description: "Audiobookshelf instance URL",
					},
					token: {
						secret: true,
						type: "string",
						label: "Token",
						validation: { required: true },
						description: "Audiobookshelf access token",
					},
				},
			},
		} satisfies RegisteredIntegrationProvider;
		let state = makeIntegration({
			lot: "yank",
			provider: "audiobookshelf",
			providerSpecifics: {
				token: "stored-token",
				kind: "audiobookshelf",
				baseUrl: "https://old.example.com",
			},
		});
		const repository = Layer.mock(IntegrationsRepository)({
			getForUser: () => Effect.succeed(state),
			updateForUser: (input) => {
				state = {
					...state,
					providerSpecifics: input.providerSpecifics ?? state.providerSpecifics,
				};
				return Effect.succeed(state);
			},
		});
		const providerCatalog = Layer.mock(IntegrationProviderCatalog)({
			find: () => registered,
			list: () => [registered],
			findOwned: () => registered,
			resolveOwned: () => ({ provider: registered, script: Effect.succeed(null) }),
		});
		const layer = IntegrationsService.layer.pipe(
			Layer.provideMerge(
				Layer.mergeAll(
					databaseLayer,
					repository,
					providerCatalog,
					Layer.mock(ImportsService, {}),
					Layer.succeed(WorkflowEngine, makeWorkflowEngine()),
				),
			),
		);

		return Effect.gen(function* () {
			const service = yield* IntegrationsService;
			const updated = yield* service.update(state.userId, state.id, {
				providerSpecifics: {
					kind: "audiobookshelf",
					baseUrl: "https://new.example.com",
				},
			});

			expect(updated.providerSpecifics).toEqual({
				token: "stored-token",
				kind: "audiobookshelf",
				baseUrl: "https://new.example.com",
			});
			expect(state.providerSpecifics).toEqual(updated.providerSpecifics);
		}).pipe(Effect.provide(layer));
	});

	it.effect("does not expose stored settings to a replacement provider owner", () => {
		const existing = makeIntegration({
			provider: "shared-provider",
			pluginSlug: "original-owner",
			providerSpecifics: { token: "stored-token" },
		});
		let updated = false;
		const replacement = {
			lot: "yank",
			name: "Replacement",
			slug: "shared-provider",
			settingsSchema: { fields: {} },
			pluginSlug: "replacement-owner",
			description: "Replacement provider",
			scriptSlug: "replacement.integration",
		} satisfies RegisteredIntegrationProvider;
		const repository = Layer.mock(IntegrationsRepository)({
			getForUser: () => Effect.succeed(existing),
			updateForUser: () => {
				updated = true;
				return Effect.succeed(existing);
			},
		});
		const providerCatalog = Layer.mock(IntegrationProviderCatalog)({
			findOwned: () => null,
			find: () => replacement,
			resolveOwned: () => null,
			list: () => [replacement],
		});
		const layer = IntegrationsService.layer.pipe(
			Layer.provideMerge(
				Layer.mergeAll(
					databaseLayer,
					repository,
					providerCatalog,
					Layer.mock(ImportsService, {}),
					Layer.succeed(WorkflowEngine, makeWorkflowEngine()),
				),
			),
		);

		return Effect.gen(function* () {
			const service = yield* IntegrationsService;
			const error = yield* Effect.flip(
				service.update(existing.userId, existing.id, {
					providerSpecifics: { token: "replacement-token" },
				}),
			);

			expect(error.message).toBe("Integration provider 'shared-provider' is not registered");
			expect(updated).toBe(false);
		}).pipe(Effect.provide(layer));
	});
});
