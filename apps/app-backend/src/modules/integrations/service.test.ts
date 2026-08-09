import { describe, expect, it } from "@effect/vitest";
import type { CurrentUserValue } from "@ryot/contract/auth-middleware";
import {
	IntegrationRequestError,
	integrationCommonPropertyNames,
} from "@ryot/contract/modules/integrations/schemas";
import { SandboxScriptId, UserId } from "@ryot/contract/schema/brands";
import { Effect, Layer } from "effect";
import { WorkflowEngine } from "effect/unstable/workflow/WorkflowEngine";

import { ProKeyService } from "#lib/infrastructure/pro-key";
import { assertExitFails } from "#lib/test-utils/assertions";
import { databaseLayer, makeWorkflowEngine } from "#lib/test-utils/effect";
import { ImportsService } from "#modules/imports/service";
import {
	IntegrationProviderCatalog,
	type RegisteredIntegrationProvider,
} from "#modules/plugins/integration-provider-catalog";
import { PluginRuntimeResolver } from "#modules/plugins/runtime-resolver";

import { IntegrationsRepository } from "./repository";
import {
	integrationCommonSchema,
	IntegrationsService,
	validateProgressThresholds,
} from "./service";
import { makeIntegration } from "./test-support";

const user: CurrentUserValue = {
	image: null,
	name: "Test User",
	email: "user@example.com",
	id: UserId.make("user-id"),
	preferences: { allowNsfw: false, language: null, disableIntegrations: false },
};

const mockProKey = (isValidated: boolean) =>
	Layer.mock(ProKeyService)({ isValidated: Effect.succeed(isValidated) });

const makeIntegrationsServiceLayer = (available = true) =>
	IntegrationsService.layer.pipe(
		Layer.provideMerge(
			Layer.mock(PluginRuntimeResolver)({
				isSystemPluginAvailableToUser: () => Effect.succeed(available),
			}),
		),
	);

const integrationsServiceLayer = makeIntegrationsServiceLayer();

describe("validateProgressThresholds", () => {
	it("returns null for valid thresholds", () => {
		expect(validateProgressThresholds(2, 95)).toBeNull();
		expect(validateProgressThresholds(0, 100)).toBeNull();
		expect(validateProgressThresholds(50, 50)).toBeNull();
	});

	it("rejects minimumProgress below 0", () => {
		expect(validateProgressThresholds(-1, 95)).toEqual({
			value: -1,
			field: "minimumProgress",
			code: "progress-out-of-range",
		});
	});

	it("rejects minimumProgress above 100", () => {
		expect(validateProgressThresholds(101, 101)).toEqual({
			value: 101,
			field: "minimumProgress",
			code: "progress-out-of-range",
		});
	});

	it("rejects maximumProgress above 100", () => {
		expect(validateProgressThresholds(2, 101)).toEqual({
			value: 101,
			field: "maximumProgress",
			code: "progress-out-of-range",
		});
	});

	it("rejects minimum greater than maximum", () => {
		expect(validateProgressThresholds(96, 95)).toEqual({
			minimumProgress: 96,
			maximumProgress: 95,
			code: "invalid-progress-range",
		});
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
				pluginId: "media",
				compiledFormat: 1,
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
			const layer = integrationsServiceLayer.pipe(
				Layer.provideMerge(
					Layer.mergeAll(
						databaseLayer,
						providerCatalog,
						mockProKey(false),
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
				expect(providers.map(({ requiresProKey }) => requiresProKey)).toEqual([
					false,
					false,
					false,
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
		const layer = integrationsServiceLayer.pipe(
			Layer.provideMerge(
				Layer.mergeAll(
					databaseLayer,
					mockProKey(false),
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

	it.effect.each([
		{ isValidated: true, expected: true },
		{ isValidated: false, expected: false },
	])(
		"marks a requiresProKey provider creatable only when the pro key is validated ($isValidated)",
		({ isValidated, expected }) => {
			const proGatedPush = {
				lot: "push",
				slug: "pro-push",
				name: "Pro push",
				scriptSlug: null,
				pluginSlug: "media",
				requiresProKey: true,
				settingsSchema: { fields: {} },
				description: "Pro-gated push provider",
			} satisfies RegisteredIntegrationProvider;
			const layer = integrationsServiceLayer.pipe(
				Layer.provideMerge(
					Layer.mergeAll(
						databaseLayer,
						mockProKey(isValidated),
						Layer.mock(ImportsService, {}),
						Layer.mock(IntegrationsRepository, {}),
						Layer.succeed(WorkflowEngine, makeWorkflowEngine()),
						Layer.mock(IntegrationProviderCatalog, {
							find: () => null,
							findOwned: () => null,
							list: () => [proGatedPush],
							resolveOwned: () => null,
						}),
					),
				),
			);

			return Effect.gen(function* () {
				const providers = yield* (yield* IntegrationsService).listIntegrationProviders();

				expect(providers).toMatchObject([{ requiresProKey: true, isCreatable: expected }]);
			}).pipe(Effect.provide(layer));
		},
	);
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
		const layer = integrationsServiceLayer.pipe(
			Layer.provideMerge(
				Layer.mergeAll(
					databaseLayer,
					repository,
					providerCatalog,
					mockProKey(true),
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
		const layer = integrationsServiceLayer.pipe(
			Layer.provideMerge(
				Layer.mergeAll(
					databaseLayer,
					repository,
					providerCatalog,
					mockProKey(true),
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

			expect(error).toMatchObject({
				reason: { code: "provider-not-found", provider: "shared-provider" },
			});
			expect(updated).toBe(false);
		}).pipe(Effect.provide(layer));
	});

	it.effect(
		"fails with pro-key-required when the existing provider requires an unvalidated key",
		() => {
			const registered = {
				lot: "sink",
				name: "Pro sink",
				slug: "pro-sink",
				pluginSlug: "media",
				requiresProKey: true,
				settingsSchema: { fields: {} },
				scriptSlug: "integration.pro-sink",
				description: "Pro-gated sink provider",
			} satisfies RegisteredIntegrationProvider;
			const existing = makeIntegration({ lot: "sink", pluginSlug: "media", provider: "pro-sink" });
			const repository = Layer.mock(IntegrationsRepository)({
				getForUser: () => Effect.succeed(existing),
				updateForUser: () => Effect.die("update should not be reached"),
			});
			const providerCatalog = Layer.mock(IntegrationProviderCatalog)({
				find: () => registered,
				list: () => [registered],
				findOwned: () => registered,
				resolveOwned: () => ({ provider: registered, script: Effect.succeed(null) }),
			});
			const layer = integrationsServiceLayer.pipe(
				Layer.provideMerge(
					Layer.mergeAll(
						databaseLayer,
						repository,
						providerCatalog,
						mockProKey(false),
						Layer.mock(ImportsService, {}),
						Layer.succeed(WorkflowEngine, makeWorkflowEngine()),
					),
				),
			);

			return Effect.gen(function* () {
				const service = yield* IntegrationsService;
				const exit = yield* Effect.exit(
					service.update(existing.userId, existing.id, { isDisabled: true }),
				);

				assertExitFails(
					exit,
					new IntegrationRequestError({
						reason: { code: "pro-key-required", provider: "pro-sink" },
					}),
				);
			}).pipe(Effect.provide(layer));
		},
	);
});

describe("create", () => {
	it.effect("fails with pro-key-required when the provider requires an unvalidated key", () => {
		const registered = {
			lot: "sink",
			name: "Pro sink",
			slug: "pro-sink",
			pluginSlug: "media",
			requiresProKey: true,
			settingsSchema: { fields: {} },
			scriptSlug: "integration.pro-sink",
			description: "Pro-gated sink provider",
		} satisfies RegisteredIntegrationProvider;
		const providerCatalog = Layer.mock(IntegrationProviderCatalog)({
			find: () => registered,
			list: () => [registered],
			findOwned: () => registered,
			resolveOwned: () => ({ provider: registered, script: Effect.succeed(null) }),
		});
		const repository = Layer.mock(IntegrationsRepository)({
			createForUser: () => Effect.die("create should not be reached"),
		});
		const layer = integrationsServiceLayer.pipe(
			Layer.provideMerge(
				Layer.mergeAll(
					databaseLayer,
					repository,
					providerCatalog,
					mockProKey(false),
					Layer.mock(ImportsService, {}),
					Layer.succeed(WorkflowEngine, makeWorkflowEngine()),
				),
			),
		);

		return Effect.gen(function* () {
			const service = yield* IntegrationsService;
			const exit = yield* Effect.exit(
				service.create(user, { provider: "pro-sink", providerSpecifics: {} }),
			);

			assertExitFails(
				exit,
				new IntegrationRequestError({ reason: { code: "pro-key-required", provider: "pro-sink" } }),
			);
		}).pipe(Effect.provide(layer));
	});
});

describe("installation availability", () => {
	it.effect("rejects webhook enqueue for an unavailable system installation", () => {
		const integration = makeIntegration({ lot: "sink", pluginSlug: "media", provider: "kodi" });
		const registered = {
			lot: "sink",
			slug: "kodi",
			name: "Kodi",
			pluginSlug: "media",
			description: "Kodi sink",
			settingsSchema: { fields: {} },
			scriptSlug: "integration.kodi",
		} satisfies RegisteredIntegrationProvider;
		const layer = makeIntegrationsServiceLayer(false).pipe(
			Layer.provideMerge(
				Layer.mergeAll(
					databaseLayer,
					mockProKey(true),
					Layer.mock(IntegrationsRepository)({
						getByIdAnyUser: () => Effect.succeed(integration),
					}),
					Layer.mock(IntegrationProviderCatalog)({
						find: () => registered,
						list: () => [registered],
						findOwned: () => registered,
						resolveOwned: () => null,
					}),
					Layer.mock(ImportsService)({
						createRunForIntegration: () => Effect.die("run should not be created"),
					}),
					Layer.succeed(WorkflowEngine, makeWorkflowEngine()),
				),
			),
		);

		return Effect.gen(function* () {
			const service = yield* IntegrationsService;
			const error = yield* Effect.flip(
				service.handleWebhook({ payload: {}, integrationId: integration.id }),
			);
			expect(error).toMatchObject({
				_tag: "IntegrationNotFoundError",
				reason: { code: "integration-not-found", integrationId: integration.id },
			});
		}).pipe(Effect.provide(layer));
	});

	it.effect("skips scheduled yank runs for an unavailable system installation", () => {
		const integration = makeIntegration({ lot: "yank", pluginSlug: "media", provider: "komga" });
		const layer = makeIntegrationsServiceLayer(false).pipe(
			Layer.provideMerge(
				Layer.mergeAll(
					databaseLayer,
					mockProKey(true),
					Layer.mock(IntegrationsRepository)({
						listEnabledYankIntegrations: () => Effect.succeed([integration]),
					}),
					Layer.mock(IntegrationProviderCatalog)({
						list: () => [],
						find: () => null,
						findOwned: () => null,
						resolveOwned: () => null,
					}),
					Layer.mock(ImportsService)({
						createRunForIntegration: () => Effect.die("run should not be created"),
					}),
					Layer.succeed(WorkflowEngine, makeWorkflowEngine()),
				),
			),
		);

		return Effect.gen(function* () {
			const service = yield* IntegrationsService;
			expect(yield* service.prepareYankRuns(null)).toEqual([]);
		}).pipe(Effect.provide(layer));
	});
});

describe("integrationCommonSchema", () => {
	it("only declares fields the manifest validator reserves", () => {
		const declared = (["yank", "sink", "push"] as const).flatMap((lot) =>
			Object.keys(integrationCommonSchema(lot).fields),
		);

		expect(declared.filter((field) => !integrationCommonPropertyNames.has(field))).toEqual([]);
	});
});

describe("syncAll", () => {
	it.effect("dispatches a user-scoped integration sync", () => {
		let captured: Parameters<WorkflowEngine["Service"]["execute"]>[1] | undefined;
		const engine = makeWorkflowEngine({
			execute: (_workflow, options) => {
				captured = options;
				return Effect.succeed(options.executionId);
			},
		});
		const layer = integrationsServiceLayer.pipe(
			Layer.provideMerge(
				Layer.mergeAll(
					databaseLayer,
					mockProKey(false),
					Layer.mock(ImportsService, {}),
					Layer.mock(IntegrationsRepository, {}),
					Layer.mock(IntegrationProviderCatalog, {
						list: () => [],
						find: () => null,
						findOwned: () => null,
						resolveOwned: () => null,
					}),
					Layer.succeed(WorkflowEngine, engine),
				),
			),
		);
		const userId = UserId.make("sync-user");

		return Effect.gen(function* () {
			const result = yield* (yield* IntegrationsService).syncAll(userId);

			expect(result.executionId).toMatch(/^integration-sync-/);
			expect(captured).toMatchObject({
				discard: true,
				executionId: result.executionId,
				payload: { userId, executionId: result.executionId },
			});
		}).pipe(Effect.provide(layer));
	});
});
