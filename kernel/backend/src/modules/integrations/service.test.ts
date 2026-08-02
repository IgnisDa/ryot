import { describe, expect, it } from "@effect/vitest";
import type { CurrentUserValue } from "@ryot-app/contract/auth-middleware";
import {
	IntegrationRequestError,
	integrationCommonSchema,
	integrationCommonPropertyNames,
} from "@ryot-app/contract/modules/integrations/schemas";
import { IntegrationWebhookToken, UserId } from "@ryot-app/contract/schema/brands";
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

import { IntegrationsRepository } from "./repository";
import { IntegrationsService, validateProgressThresholds } from "./service";
import { makeIntegration, makeRun, testWebhookToken } from "./test-support";

const user: CurrentUserValue = {
	image: null,
	name: "Test User",
	email: "user@example.com",
	id: UserId.make("user-id"),
	preferences: { language: null, allowNsfw: false, disableIntegrations: false },
};

const mockProKey = (isValidated: boolean) =>
	Layer.mock(ProKeyService)({ isValidated: Effect.succeed(isValidated) });

const systemPlugin = (pluginSlug: string) =>
	({
		pluginSlug,
		pluginScope: "system",
		pluginId: `${pluginSlug}-plugin-id`,
		installationId: `${pluginSlug}-installation-id`,
		configContext: {
			kind: "revision",
			ownerUserId: null,
			configSchema: { fields: {} },
			pluginConfigRevisionId: null,
			pluginRevisionId: `${pluginSlug}-revision-id`,
		},
	}) satisfies Partial<RegisteredIntegrationProvider>;

const integrationsServiceLayer = IntegrationsService.layer;

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

describe("update", () => {
	it.effect("preserves a stored secret omitted from a provider settings update", () => {
		const registered = {
			lot: "yank",
			...systemPlugin("example"),
			name: "Mu",
			slug: "mu",
			description: "Test yank",
			scriptSlug: "integration.mu",
			settingsSchema: {
				fields: {
					baseUrl: {
						type: "string",
						label: "Base URL",
						validation: { required: true },
						description: "Mu instance URL",
					},
					token: {
						secret: true,
						type: "string",
						label: "Token",
						validation: { required: true },
						description: "Mu access token",
					},
					kind: {
						type: "enum",
						label: "Provider kind",
						validation: { required: true },
						description: "Integration provider discriminator",
						choices: { kind: "static", values: [{ value: "mu" }] },
					},
				},
			},
		} satisfies RegisteredIntegrationProvider;
		let state = makeIntegration({
			lot: "yank",
			provider: "mu",
			pluginSlug: "example",
			pluginInstallationId: "example-installation-id",
			providerSpecifics: { kind: "mu", token: "stored-token", baseUrl: "https://old.example.com" },
		});
		const repository = Layer.mock(IntegrationsRepository)({
			getForUser: () => Effect.succeed(state),
			getClientForUser: () => Effect.die("write must not read client detail"),
			updateForUser: (input) => {
				state = { ...state, providerSpecifics: input.providerSpecifics ?? state.providerSpecifics };
				return Effect.succeed({ id: state.id });
			},
		});
		const providerCatalog = Layer.mock(IntegrationProviderCatalog)({
			findForUser: () => Effect.succeed(registered),
			findOwnedForUser: () => Effect.succeed(registered),
			resolveOwnedForUser: () => Effect.succeed({ script: null, provider: registered }),
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
				providerSpecifics: { kind: "mu", baseUrl: "https://new.example.com" },
			});

			expect(updated).toEqual({ id: state.id });
			expect(state.providerSpecifics).toEqual({
				kind: "mu",
				token: "stored-token",
				baseUrl: "https://new.example.com",
			});
		}).pipe(Effect.provide(layer));
	});

	it.effect("does not expose stored settings to a replacement provider owner", () => {
		const existing = makeIntegration({
			provider: "shared-provider",
			pluginSlug: "original-owner",
			providerSpecifics: { token: "stored-token" },
			pluginInstallationId: "original-owner-installation-id",
		});
		let updated = false;
		const replacement = {
			lot: "yank",
			name: "Replacement",
			slug: "shared-provider",
			settingsSchema: { fields: {} },
			...systemPlugin("replacement-owner"),
			description: "Replacement provider",
			scriptSlug: "replacement.integration",
		} satisfies RegisteredIntegrationProvider;
		const repository = Layer.mock(IntegrationsRepository)({
			getForUser: () => Effect.succeed(existing),
			updateForUser: () => {
				updated = true;
				return Effect.succeed({ id: existing.id });
			},
		});
		const providerCatalog = Layer.mock(IntegrationProviderCatalog)({
			findOwnedForUser: () => Effect.succeed(null),
			findForUser: () => Effect.succeed(replacement),
			resolveOwnedForUser: () => Effect.succeed(null),
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
				requiresProKey: true,
				...systemPlugin("example"),
				settingsSchema: { fields: {} },
				scriptSlug: "integration.pro-sink",
				description: "Pro-gated sink provider",
			} satisfies RegisteredIntegrationProvider;
			const existing = makeIntegration({
				lot: "sink",
				provider: "pro-sink",
				pluginSlug: "example",
				pluginInstallationId: "example-installation-id",
			});
			const repository = Layer.mock(IntegrationsRepository)({
				getForUser: () => Effect.succeed(existing),
				updateForUser: () => Effect.die("update should not be reached"),
			});
			const providerCatalog = Layer.mock(IntegrationProviderCatalog)({
				findForUser: () => Effect.succeed(registered),
				findOwnedForUser: () => Effect.succeed(registered),
				resolveOwnedForUser: () => Effect.succeed({ script: null, provider: registered }),
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
						reason: { provider: "pro-sink", code: "pro-key-required" },
					}),
				);
			}).pipe(Effect.provide(layer));
		},
	);
});

describe("create", () => {
	it.effect("returns only the id without fetching client detail after persisting secrets", () => {
		const registered = {
			lot: "push",
			name: "Push",
			scriptSlug: null,
			slug: "example-push",
			...systemPlugin("example"),
			description: "Test push provider",
			settingsSchema: {
				fields: {
					token: { secret: true, type: "string", label: "Token", description: "API token" },
				},
			},
		} satisfies RegisteredIntegrationProvider;
		let storedSettings: Record<string, unknown> | undefined;
		const layer = integrationsServiceLayer.pipe(
			Layer.provideMerge(
				Layer.mergeAll(
					databaseLayer,
					mockProKey(true),
					Layer.mock(ImportsService, {}),
					Layer.succeed(WorkflowEngine, makeWorkflowEngine()),
					Layer.mock(IntegrationProviderCatalog, { findForUser: () => Effect.succeed(registered) }),
					Layer.mock(IntegrationsRepository, {
						getClientForUser: () => Effect.die("write must not read client detail"),
						createForUser: (input) => {
							storedSettings = input.providerSpecifics;
							return Effect.succeed({ id: makeIntegration().id });
						},
					}),
				),
			),
		);

		return Effect.gen(function* () {
			const result = yield* (yield* IntegrationsService).create(user, {
				provider: registered.slug,
				providerSpecifics: { token: "create-secret" },
			});
			expect(result).toEqual({ id: makeIntegration().id });
			expect(storedSettings).toEqual({ token: "create-secret" });
		}).pipe(Effect.provide(layer));
	});

	it.effect("fails with pro-key-required when the provider requires an unvalidated key", () => {
		const registered = {
			lot: "sink",
			name: "Pro sink",
			slug: "pro-sink",
			requiresProKey: true,
			...systemPlugin("example"),
			settingsSchema: { fields: {} },
			scriptSlug: "integration.pro-sink",
			description: "Pro-gated sink provider",
		} satisfies RegisteredIntegrationProvider;
		const providerCatalog = Layer.mock(IntegrationProviderCatalog)({
			findForUser: () => Effect.succeed(registered),
			findOwnedForUser: () => Effect.succeed(registered),
			resolveOwnedForUser: () => Effect.succeed({ script: null, provider: registered }),
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
				new IntegrationRequestError({ reason: { provider: "pro-sink", code: "pro-key-required" } }),
			);
		}).pipe(Effect.provide(layer));
	});
});

describe("installation availability", () => {
	it.effect("rejects webhook enqueue for an unavailable system installation", () => {
		const integration = makeIntegration({
			lot: "sink",
			provider: "kodi",
			pluginSlug: "example",
			pluginInstallationId: "example-installation-id",
		});
		const layer = integrationsServiceLayer.pipe(
			Layer.provideMerge(
				Layer.mergeAll(
					databaseLayer,
					mockProKey(true),
					Layer.mock(IntegrationsRepository)({
						getByWebhookToken: () => Effect.succeed(integration),
					}),
					Layer.mock(IntegrationProviderCatalog)({
						findForUser: () => Effect.succeed(null),
						findOwnedForUser: () => Effect.succeed(null),
						listResolvedForUser: () => Effect.succeed([]),
						resolveOwnedForUser: () => Effect.succeed(null),
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
				service.handleWebhook({
					rawBody: "{}",
					webhookToken: testWebhookToken,
					contentType: "application/json",
				}),
			);
			expect(error).toMatchObject({
				_tag: "IntegrationNotFoundError",
				reason: { code: "integration-not-found", integrationId: integration.id },
			});
		}).pipe(Effect.provide(layer));
	});

	it.effect("skips scheduled yank runs for an unavailable system installation", () => {
		const integration = makeIntegration({
			lot: "yank",
			provider: "theta",
			pluginSlug: "example",
			pluginInstallationId: "example-installation-id",
		});
		const layer = integrationsServiceLayer.pipe(
			Layer.provideMerge(
				Layer.mergeAll(
					databaseLayer,
					mockProKey(true),
					Layer.mock(IntegrationsRepository)({
						getUserDisableIntegrations: () => Effect.succeed(false),
						listEnabledYankIntegrations: () => Effect.succeed([integration]),
					}),
					Layer.mock(IntegrationProviderCatalog)({
						findForUser: () => Effect.succeed(null),
						findOwnedForUser: () => Effect.succeed(null),
						listResolvedForUser: () => Effect.succeed([]),
						resolveOwnedForUser: () => Effect.succeed(null),
					}),
					Layer.mock(ImportsService)({
						createRunForIntegrationIfIdle: () => Effect.die("run should not be created"),
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

describe("prepareYankRuns", () => {
	const yankIntegration = makeIntegration({
		lot: "yank",
		provider: "theta",
		pluginSlug: "example",
		pluginInstallationId: "example-installation-id",
	});
	const registeredYank: RegisteredIntegrationProvider = {
		...systemPlugin("example"),
		lot: "yank",
		name: "Theta",
		slug: "theta",
		description: "Theta",
		requiresProKey: false,
		scriptSlug: "theta-sync",
		settingsSchema: { fields: {} },
	};

	const layerFor = (
		createRunForIntegrationIfIdle: ImportsService["Service"]["createRunForIntegrationIfIdle"],
	) =>
		integrationsServiceLayer.pipe(
			Layer.provideMerge(
				Layer.mergeAll(
					databaseLayer,
					mockProKey(true),
					Layer.mock(IntegrationsRepository)({
						getUserDisableIntegrations: () => Effect.succeed(false),
						listEnabledYankIntegrations: () => Effect.succeed([yankIntegration]),
					}),
					Layer.mock(IntegrationProviderCatalog)({
						listResolvedForUser: () => Effect.succeed([{ script: null, provider: registeredYank }]),
					}),
					Layer.mock(ImportsService)({ createRunForIntegrationIfIdle }),
					Layer.succeed(WorkflowEngine, makeWorkflowEngine()),
				),
			),
		);

	it.effect("admits an idle yank integration as a yank-owned run", () => {
		let captured: Record<string, unknown> | undefined;
		const layer = layerFor((input) => {
			captured = input;
			return Effect.succeed(makeRun("completed"));
		});

		return Effect.gen(function* () {
			const service = yield* IntegrationsService;
			expect(yield* service.prepareYankRuns(null)).toEqual([
				{
					userId: yankIntegration.userId,
					runId: makeRun("completed").id,
					integrationId: yankIntegration.id,
				},
			]);
			expect(captured).toMatchObject({
				source: "theta",
				integrationId: yankIntegration.id,
				pluginInstallationId: "example-installation-id",
			});
		}).pipe(Effect.provide(layer));
	});

	it.effect("skips a yank integration the database refused to admit", () => {
		const layer = layerFor(() => Effect.succeed(null));

		return Effect.gen(function* () {
			const service = yield* IntegrationsService;
			expect(yield* service.prepareYankRuns(null)).toEqual([]);
		}).pipe(Effect.provide(layer));
	});
});

describe("handleWebhook", () => {
	it.effect("rejects an unknown webhook token", () => {
		const layer = integrationsServiceLayer.pipe(
			Layer.provideMerge(
				Layer.mergeAll(
					databaseLayer,
					mockProKey(true),
					Layer.mock(IntegrationsRepository)({ getByWebhookToken: () => Effect.succeed(null) }),
					Layer.mock(IntegrationProviderCatalog, {}),
					Layer.mock(ImportsService, {}),
					Layer.succeed(WorkflowEngine, makeWorkflowEngine()),
				),
			),
		);

		return Effect.gen(function* () {
			const service = yield* IntegrationsService;
			const error = yield* Effect.flip(
				service.handleWebhook({
					rawBody: "{}",
					contentType: "application/json",
					webhookToken: IntegrationWebhookToken.make("unknown-webhook-token"),
				}),
			);
			expect(error).toMatchObject({
				_tag: "IntegrationNotFoundError",
				reason: { code: "integration-webhook-not-found" },
			});
		}).pipe(Effect.provide(layer));
	});

	it.effect("admits sink runs without idle exclusion", () => {
		const integration = makeIntegration({
			lot: "sink",
			provider: "kodi",
			pluginSlug: "example",
			pluginInstallationId: "example-installation-id",
		});
		const registeredSink: RegisteredIntegrationProvider = {
			...systemPlugin("example"),
			lot: "sink",
			name: "Kodi",
			slug: "kodi",
			description: "Kodi",
			requiresProKey: false,
			scriptSlug: "kodi-webhook",
			settingsSchema: { fields: {} },
		};
		let captured: Record<string, unknown> | undefined;
		const layer = integrationsServiceLayer.pipe(
			Layer.provideMerge(
				Layer.mergeAll(
					databaseLayer,
					mockProKey(true),
					Layer.mock(IntegrationsRepository)({
						getByWebhookToken: () => Effect.succeed(integration),
						getUserDisableIntegrations: () => Effect.succeed(false),
					}),
					Layer.mock(IntegrationProviderCatalog)({
						findOwnedForUser: () => Effect.succeed(registeredSink),
					}),
					Layer.mock(ImportsService)({
						createRunForIntegrationIfIdle: () => Effect.die("sink runs must not be idle-gated"),
						createRunForIntegration: (input) => {
							captured = input;
							return Effect.succeed(makeRun("completed"));
						},
					}),
					Layer.succeed(
						WorkflowEngine,
						makeWorkflowEngine({
							execute: (_workflow, options) => Effect.succeed(options.executionId),
						}),
					),
				),
			),
		);

		return Effect.gen(function* () {
			const service = yield* IntegrationsService;
			expect(
				yield* service.handleWebhook({
					rawBody: "{}",
					webhookToken: testWebhookToken,
					contentType: "application/json",
				}),
			).toEqual({ runId: makeRun("completed").id });
			expect(captured).toMatchObject({
				source: "kodi",
				integrationLot: "sink",
				integrationId: integration.id,
			});
		}).pipe(Effect.provide(layer));
	});

	it.effect("forwards the untouched request transport to the run workflow", () => {
		const integration = makeIntegration({
			lot: "sink",
			pluginSlug: "example",
			provider: "lambda_sink",
			pluginInstallationId: "example-installation-id",
		});
		const registeredSink: RegisteredIntegrationProvider = {
			...systemPlugin("example"),
			lot: "sink",
			name: "Lambda sink",
			slug: "lambda_sink",
			requiresProKey: false,
			description: "Lambda sink",
			scriptSlug: "lambda-webhook",
			settingsSchema: { fields: {} },
		};
		const rawBody =
			'--abc\r\nContent-Disposition: form-data; name="payload"\r\n\r\n{"event":"example.scrobble"}\r\n--abc--';
		const contentType = "multipart/form-data; boundary=abc";
		let captured: Parameters<WorkflowEngine["Service"]["execute"]>[1] | undefined;
		const layer = integrationsServiceLayer.pipe(
			Layer.provideMerge(
				Layer.mergeAll(
					databaseLayer,
					mockProKey(true),
					Layer.mock(IntegrationsRepository)({
						getByWebhookToken: () => Effect.succeed(integration),
						getUserDisableIntegrations: () => Effect.succeed(false),
					}),
					Layer.mock(IntegrationProviderCatalog)({
						findOwnedForUser: () => Effect.succeed(registeredSink),
					}),
					Layer.mock(ImportsService)({
						createRunForIntegration: () => Effect.succeed(makeRun("completed")),
					}),
					Layer.succeed(
						WorkflowEngine,
						makeWorkflowEngine({
							execute: (_workflow, options) => {
								captured = options;
								return Effect.succeed(options.executionId);
							},
						}),
					),
				),
			),
		);

		return Effect.gen(function* () {
			const service = yield* IntegrationsService;
			yield* service.handleWebhook({ rawBody, contentType, webhookToken: testWebhookToken });
			expect(captured?.payload).toMatchObject({ webhook: { rawBody, contentType } });
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
						findForUser: () => Effect.succeed(null),
						findOwnedForUser: () => Effect.succeed(null),
						resolveOwnedForUser: () => Effect.succeed(null),
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
