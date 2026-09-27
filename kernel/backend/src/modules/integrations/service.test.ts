import { describe, expect, it, layer } from "@effect/vitest";
import type { CurrentUserValue } from "@ryot-app/contract/auth-middleware";
import {
	IntegrationRequestError,
	integrationCommonSchema,
	integrationCommonPropertyNames,
} from "@ryot-app/contract/modules/integrations/schemas";
import { IntegrationWebhookToken, SandboxScriptId, UserId } from "@ryot-app/contract/schema/brands";
import { Context, Effect, Layer, Ref } from "effect";
import { WorkflowEngine } from "effect/workflow/WorkflowEngine";

import { ProKeyService } from "#lib/infrastructure/pro-key";
import { assertExitFails } from "#lib/test-utils/assertions";
import {
	makeWorkflowEngine,
	type MockOverrides,
	type WorkflowEngineOverrides,
} from "#lib/test-utils/effect";
import { mutationAdmissionTestLayer } from "#lib/test-utils/mutation-admission";
import { DataImportAdmission } from "#modules/imports/data-admission";
import { IngestionExecution } from "#modules/imports/execution-service";
import { ImportsRepository } from "#modules/imports/repository";
import { IngestionRetirement } from "#modules/imports/retirement-service";
import { ImportsService } from "#modules/imports/service";
import { OAuthConnectionsService } from "#modules/oauth-connections/service";
import {
	IngestionReadinessError,
	IngestionReadinessService,
} from "#modules/plugins/ingestion-readiness-service";
import {
	IntegrationProviderCatalog,
	type RegisteredIntegrationProvider,
} from "#modules/plugins/integration-provider-catalog";

import { IntegrationIngestion } from "./ingestion";
import { IntegrationsRepository, type IntegrationRecord } from "./repository";
import { IntegrationsService, validateProgressThresholds } from "./service";
import { makeIntegration, makeRun, testWebhookToken } from "./test-support";

const user: CurrentUserValue = {
	image: null,
	name: "Test User",
	email: "user@example.com",
	id: UserId.make("user-id"),
	preferences: { language: null, disableIntegrations: false },
	accountGeneration: { userId: UserId.make("user-id"), token: "test-account-generation" },
};

const mockProKey = (isValidated: boolean) =>
	Layer.mock(ProKeyService)({ isValidated: Effect.succeed(isValidated) });

const systemPlugin = (pluginSlug: string) =>
	({
		pluginSlug,
		pluginScope: "system",
		pluginId: `${pluginSlug}-plugin-id`,
		installationId: `${pluginSlug}-installation-id`,
		readinessMetadata: { scripts: [], workflows: [], oauthProviders: [], availableConfigKeys: [] },
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

type RecordedCall = { readonly method: string; readonly input: unknown };

class FakeIntegrationDependencies extends Context.Service<
	FakeIntegrationDependencies,
	{
		readonly calls: Effect.Effect<ReadonlyArray<RecordedCall>>;
		readonly storedIntegration: Effect.Effect<IntegrationRecord | undefined>;
	}
>()("test/FakeIntegrationDependencies") {}

type FakeTools = {
	readonly stored: Ref.Ref<IntegrationRecord | undefined>;
	readonly record: (method: string, input: unknown) => Effect.Effect<void>;
};

const mockRepository = Layer.mock(IntegrationsRepository);
const mockCatalog = Layer.mock(IntegrationProviderCatalog);
const mockImports = Layer.mock(ImportsService);
const mockOAuthConnections = Layer.mock(OAuthConnectionsService);
const mockReadiness = Layer.mock(IngestionReadinessService);
const mockDataAdmission = Layer.mock(DataImportAdmission);

const makeServiceLayer = (options: {
	proKey?: boolean;
	stored?: IntegrationRecord;
	dependencies?: (tools: FakeTools) => {
		engine?: WorkflowEngineOverrides;
		dataAdmission?: MockOverrides<typeof mockDataAdmission>;
		imports?: MockOverrides<typeof mockImports>;
		catalog?: MockOverrides<typeof mockCatalog>;
		readiness?: MockOverrides<typeof mockReadiness>;
		repository?: MockOverrides<typeof mockRepository>;
	};
}) =>
	integrationsServiceLayer.pipe(
		Layer.provideMerge(
			Layer.mergeAll(
				mutationAdmissionTestLayer,
				Layer.mock(ImportsRepository)({}),
				Layer.mock(IngestionExecution)({}),
				Layer.mock(IngestionRetirement)({}),
				mockProKey(options.proKey ?? true),
				Layer.unwrap(
					Effect.gen(function* () {
						const calls = yield* Ref.make<ReadonlyArray<RecordedCall>>([]);
						const stored = yield* Ref.make(options.stored);
						const dependencies =
							options.dependencies?.({
								stored,
								record: (method, input) => Ref.update(calls, (all) => [...all, { input, method }]),
							}) ?? {};
						return Layer.mergeAll(
							mockDataAdmission(dependencies.dataAdmission ?? {}),
							Layer.mock(IntegrationIngestion)({
								release: () => Effect.succeed(true),
								admitWebhook: (integration, webhook, failureReason) =>
									Ref.update(calls, (all) => [
										...all,
										{ method: "admitWebhook", input: { webhook, integration, failureReason } },
									]).pipe(
										Effect.as({
											userId: integration.userId,
											runId: makeRun("completed").id,
											accountGeneration: {
												userId: integration.userId,
												token: "test-account-generation",
											},
										}),
									),
							}),
							Layer.succeed(FakeIntegrationDependencies, {
								calls: Ref.get(calls),
								storedIntegration: Ref.get(stored),
							}),
							mockImports(dependencies.imports ?? {}),
							mockOAuthConnections({ bindIntegrationSettings: () => Effect.void }),
							mockCatalog(dependencies.catalog ?? {}),
							mockReadiness(dependencies.readiness ?? {}),
							mockRepository(dependencies.repository ?? {}),
							Layer.succeed(WorkflowEngine, makeWorkflowEngine(dependencies.engine)),
						);
					}),
				),
			),
		),
	);

describe("update", () => {
	const muProvider = {
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
	const muIntegration = makeIntegration({
		lot: "yank",
		provider: "mu",
		pluginSlug: "example",
		pluginInstallationId: "example-installation-id",
		providerSpecifics: { kind: "mu", token: "stored-token", baseUrl: "https://old.example.com" },
	});

	layer(
		makeServiceLayer({
			stored: muIntegration,
			dependencies: ({ stored }) => ({
				catalog: {
					findForUser: () => Effect.succeed(muProvider),
					findOwnedForUser: () => Effect.succeed(muProvider),
					resolveOwnedForUser: () => Effect.succeed({ script: null, provider: muProvider }),
				},
				repository: {
					getClientForUser: () => Effect.die("write must not read client detail"),
					getForUser: () => Ref.get(stored).pipe(Effect.map((state) => state ?? null)),
					updateForUser: (input) =>
						Ref.update(stored, (state) =>
							state === undefined
								? state
								: {
										...state,
										providerSpecifics: input.providerSpecifics ?? state.providerSpecifics,
									},
						).pipe(Effect.as({ id: muIntegration.id })),
				},
			}),
		}),
	)((test) => {
		test.effect("preserves a stored secret omitted from a provider settings update", () =>
			Effect.gen(function* () {
				const service = yield* IntegrationsService;
				const updated = yield* service.update(muIntegration.userId, muIntegration.id, {
					providerSpecifics: { kind: "mu", baseUrl: "https://new.example.com" },
				});

				expect(updated).toEqual({ id: muIntegration.id });
				expect(
					(yield* (yield* FakeIntegrationDependencies).storedIntegration)?.providerSpecifics,
				).toEqual({ kind: "mu", token: "stored-token", baseUrl: "https://new.example.com" });
			}),
		);
	});

	const sharedProviderIntegration = makeIntegration({
		provider: "shared-provider",
		pluginSlug: "original-owner",
		providerSpecifics: { token: "stored-token" },
		pluginInstallationId: "original-owner-installation-id",
	});
	const replacementProvider = {
		lot: "yank",
		name: "Replacement",
		slug: "shared-provider",
		settingsSchema: { fields: {} },
		...systemPlugin("replacement-owner"),
		description: "Replacement provider",
		scriptSlug: "replacement.integration",
	} satisfies RegisteredIntegrationProvider;

	layer(
		makeServiceLayer({
			dependencies: ({ record }) => ({
				catalog: {
					findOwnedForUser: () => Effect.succeed(null),
					resolveOwnedForUser: () => Effect.succeed(null),
					findForUser: () => Effect.succeed(replacementProvider),
				},
				repository: {
					getForUser: () => Effect.succeed(sharedProviderIntegration),
					updateForUser: (input) =>
						record("updateForUser", input).pipe(Effect.as({ id: sharedProviderIntegration.id })),
				},
			}),
		}),
	)((test) => {
		test.effect("does not expose stored settings to a replacement provider owner", () =>
			Effect.gen(function* () {
				const service = yield* IntegrationsService;
				const error = yield* Effect.flip(
					service.update(sharedProviderIntegration.userId, sharedProviderIntegration.id, {
						providerSpecifics: { token: "replacement-token" },
					}),
				);

				expect(error).toMatchObject({
					reason: { code: "provider-not-found", provider: "shared-provider" },
				});
				expect(yield* (yield* FakeIntegrationDependencies).calls).toEqual([]);
			}),
		);
	});

	const proSinkProvider = {
		lot: "sink",
		name: "Pro sink",
		slug: "pro-sink",
		requiresProKey: true,
		...systemPlugin("example"),
		settingsSchema: { fields: {} },
		scriptSlug: "integration.pro-sink",
		description: "Pro-gated sink provider",
	} satisfies RegisteredIntegrationProvider;
	const proSinkIntegration = makeIntegration({
		lot: "sink",
		provider: "pro-sink",
		pluginSlug: "example",
		pluginInstallationId: "example-installation-id",
	});

	layer(
		makeServiceLayer({
			proKey: false,
			dependencies: () => ({
				repository: {
					getForUser: () => Effect.succeed(proSinkIntegration),
					updateForUser: () => Effect.die("update should not be reached"),
				},
				catalog: {
					findForUser: () => Effect.succeed(proSinkProvider),
					findOwnedForUser: () => Effect.succeed(proSinkProvider),
					resolveOwnedForUser: () => Effect.succeed({ script: null, provider: proSinkProvider }),
				},
			}),
		}),
	)((test) => {
		test.effect(
			"fails with pro-key-required when the existing provider requires an unvalidated key",
			() =>
				Effect.gen(function* () {
					const service = yield* IntegrationsService;
					const exit = yield* Effect.exit(
						service.update(proSinkIntegration.userId, proSinkIntegration.id, { isDisabled: true }),
					);

					assertExitFails(
						exit,
						new IntegrationRequestError({
							reason: { provider: "pro-sink", code: "pro-key-required" },
						}),
					);
				}),
		);
	});
});

describe("create", () => {
	const pushProvider = {
		lot: "push",
		name: "Push",
		scriptSlug: null,
		slug: "example-push",
		...systemPlugin("example"),
		description: "Test push provider",
		settingsSchema: {
			fields: { token: { secret: true, type: "string", label: "Token", description: "API token" } },
		},
	} satisfies RegisteredIntegrationProvider;

	layer(
		makeServiceLayer({
			dependencies: ({ record }) => ({
				catalog: { findForUser: () => Effect.succeed(pushProvider) },
				repository: {
					getClientForUser: () => Effect.die("write must not read client detail"),
					createForUser: (input) =>
						record("createForUser", input.providerSpecifics).pipe(
							Effect.as({ id: makeIntegration().id }),
						),
				},
			}),
		}),
	)((test) => {
		test.effect("returns only the id without fetching client detail after persisting secrets", () =>
			Effect.gen(function* () {
				const result = yield* (yield* IntegrationsService).create(user, {
					provider: pushProvider.slug,
					providerSpecifics: { token: "create-secret" },
				});
				expect(result).toEqual({ id: makeIntegration().id });
				expect((yield* (yield* FakeIntegrationDependencies).calls).at(-1)?.input).toEqual({
					token: "create-secret",
				});
			}),
		);
	});

	const proSinkProvider = {
		lot: "sink",
		name: "Pro sink",
		slug: "pro-sink",
		requiresProKey: true,
		...systemPlugin("example"),
		settingsSchema: { fields: {} },
		scriptSlug: "integration.pro-sink",
		description: "Pro-gated sink provider",
	} satisfies RegisteredIntegrationProvider;

	layer(
		makeServiceLayer({
			proKey: false,
			dependencies: () => ({
				repository: { createForUser: () => Effect.die("create should not be reached") },
				catalog: {
					findForUser: () => Effect.succeed(proSinkProvider),
					findOwnedForUser: () => Effect.succeed(proSinkProvider),
					resolveOwnedForUser: () => Effect.succeed({ script: null, provider: proSinkProvider }),
				},
			}),
		}),
	)((test) => {
		test.effect("fails with pro-key-required when the provider requires an unvalidated key", () =>
			Effect.gen(function* () {
				const service = yield* IntegrationsService;
				const exit = yield* Effect.exit(
					service.create(user, { provider: "pro-sink", providerSpecifics: {} }),
				);

				assertExitFails(
					exit,
					new IntegrationRequestError({
						reason: { provider: "pro-sink", code: "pro-key-required" },
					}),
				);
			}),
		);
	});
});

describe("installation availability", () => {
	const unavailableCatalog = {
		findForUser: () => Effect.succeed(null),
		findOwnedForUser: () => Effect.succeed(null),
		listResolvedForUser: () => Effect.succeed([]),
		resolveOwnedForUser: () => Effect.succeed(null),
	};
	const sinkIntegration = makeIntegration({
		lot: "sink",
		provider: "kodi",
		pluginSlug: "example",
		pluginInstallationId: "example-installation-id",
	});

	layer(
		makeServiceLayer({
			dependencies: () => ({
				catalog: unavailableCatalog,
				imports: { createIntegrationRun: () => Effect.die("run should not be created") },
				repository: {
					getUserDisableIntegrations: () => Effect.succeed(false),
					getByWebhookToken: () => Effect.succeed(sinkIntegration),
				},
			}),
		}),
	)((test) => {
		test.effect("retains a webhook without dispatch while its installation is unavailable", () =>
			Effect.gen(function* () {
				const service = yield* IntegrationsService;
				const accepted = yield* service.handleWebhook({
					rawBody: "{}",
					webhookToken: testWebhookToken,
					contentType: "application/json",
				});
				expect(accepted).toEqual({ runId: makeRun("completed").id });
			}),
		);
	});

	const unavailableYankIntegration = makeIntegration({
		lot: "yank",
		provider: "theta",
		pluginSlug: "example",
		pluginInstallationId: "example-installation-id",
	});

	layer(
		makeServiceLayer({
			dependencies: () => ({
				catalog: unavailableCatalog,
				imports: { createIntegrationRunIfIdle: () => Effect.die("run should not be created") },
				repository: {
					getUserDisableIntegrations: () => Effect.succeed(false),
					listEnabledYankIntegrations: () => Effect.succeed([unavailableYankIntegration]),
				},
			}),
		}),
	)((test) => {
		test.effect("skips scheduled yank runs for an unavailable system installation", () =>
			Effect.gen(function* () {
				const service = yield* IntegrationsService;
				expect(yield* service.prepareYankRuns(null, null)).toEqual([]);
			}),
		);
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

	const layerFor = (admitted: boolean, ready = true, unavailable = false) =>
		makeServiceLayer({
			dependencies: ({ record }) => ({
				catalog: {
					listResolvedForUser: () => Effect.succeed([{ script: null, provider: registeredYank }]),
				},
				repository: {
					getUserDisableIntegrations: () => Effect.succeed(false),
					listEnabledYankIntegrations: () => Effect.succeed([yankIntegration]),
				},
				imports: {
					createIntegrationRunIfIdle: (input) =>
						(ready && !unavailable
							? record("createIntegrationRunIfIdle", input)
							: Effect.die("unready integration was admitted")
						).pipe(Effect.as(admitted ? makeRun("completed") : null)),
				},
				readiness: {
					evaluateIntegration: (input) =>
						record("evaluateIntegration", input).pipe(
							Effect.andThen(
								unavailable
									? Effect.fail(new IngestionReadinessError({ message: "Operation unavailable" }))
									: Effect.succeed({
											script: null,
											provider: registeredYank,
											pins: {
												pluginConfigRevisionId: null,
												pluginRevisionId: "example-revision-id",
												scriptId: SandboxScriptId.make("theta-script"),
											},
											readiness: {
												ready,
												plan: { selection: {}, operation: "theta-sync" },
												blockReasons: ready
													? []
													: [{ key: "token", code: "configuration-required" as const }],
											},
										}),
							),
						),
				},
			}),
		});

	layer(layerFor(true))((test) => {
		test.effect("admits an idle yank integration as a yank-owned run", () =>
			Effect.gen(function* () {
				const service = yield* IntegrationsService;
				expect(yield* service.prepareYankRuns(null, null)).toEqual([
					{
						userId: yankIntegration.userId,
						runId: makeRun("completed").id,
						integrationId: yankIntegration.id,
						accountGeneration: { userId: yankIntegration.userId, token: "test-account-generation" },
					},
				]);
				expect((yield* (yield* FakeIntegrationDependencies).calls).at(-1)?.input).toMatchObject({
					source: "theta",
					integrationId: yankIntegration.id,
					pluginInstallationId: "example-installation-id",
				});
			}),
		);
	});

	layer(layerFor(false))((test) => {
		test.effect("skips a yank integration the database refused to admit", () =>
			Effect.gen(function* () {
				const service = yield* IntegrationsService;
				expect(yield* service.prepareYankRuns(null, null)).toEqual([]);
			}),
		);
	});

	layer(layerFor(true, false))((test) => {
		test.effect("rechecks missing setup on each tick without creating reports", () =>
			Effect.gen(function* () {
				const service = yield* IntegrationsService;
				expect(yield* service.prepareYankRuns(null, null)).toEqual([]);
				expect(yield* service.prepareYankRuns(null, null)).toEqual([]);
				expect(yield* (yield* FakeIntegrationDependencies).calls).toEqual(
					Array.from({ length: 2 }, () => ({
						method: "evaluateIntegration",
						input: {
							settings: {},
							providerSlug: "theta",
							userId: yankIntegration.userId,
							integrationId: yankIntegration.id,
							installationId: "example-installation-id",
						},
					})),
				);
			}),
		);
	});

	layer(layerFor(true, true, true))((test) => {
		test.effect("waits without admitting when the executable is unavailable", () =>
			Effect.gen(function* () {
				expect(yield* (yield* IntegrationsService).prepareYankRuns(null, null)).toEqual([]);
			}),
		);
	});
});

describe("handleWebhook", () => {
	const dataIntegration = makeIntegration({ provider: "data-json", pluginInstallationId: null });
	layer(
		makeServiceLayer({
			dependencies: ({ record }) => ({
				engine: { execute: (_workflow, options) => record("execute", options) },
				repository: {
					getUserDisableIntegrations: () => Effect.succeed(false),
					getByWebhookToken: () => Effect.succeed(dataIntegration),
				},
				dataAdmission: {
					release: () => Effect.void,
					admit: (input) =>
						record("admitData", input).pipe(
							Effect.as({ created: true, digest: "data-digest", runId: makeRun("completed").id }),
						),
				},
			}),
		}),
	)((test) => {
		test.effect(
			"passes Data submission keys and the current account generation to durable admission",
			() =>
				Effect.gen(function* () {
					yield* (yield* IntegrationsService).handleWebhook({
						rawBody: "{}",
						submissionKey: "delivery-key",
						webhookToken: testWebhookToken,
						contentType: "application/json",
					});
					const calls = yield* (yield* FakeIntegrationDependencies).calls;
					expect(calls[0]).toMatchObject({
						method: "admitData",
						input: {
							submissionKey: "delivery-key",
							integrationId: dataIntegration.id,
							accountGeneration: {
								userId: dataIntegration.userId,
								token: "test-account-generation",
							},
						},
					});
					expect(calls[1]).toMatchObject({
						method: "execute",
						input: {
							executionId: makeRun("completed").id,
							payload: {
								accountGeneration: {
									userId: dataIntegration.userId,
									token: "test-account-generation",
								},
							},
						},
					});
				}),
		);
	});
	layer(
		makeServiceLayer({
			dependencies: () => ({ repository: { getByWebhookToken: () => Effect.succeed(null) } }),
		}),
	)((test) => {
		test.effect("rejects an unknown webhook token", () =>
			Effect.gen(function* () {
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
			}),
		);
	});

	const kodiIntegration = makeIntegration({
		lot: "sink",
		provider: "kodi",
		pluginSlug: "example",
		pluginInstallationId: "example-installation-id",
	});
	const kodiSink: RegisteredIntegrationProvider = {
		...systemPlugin("example"),
		lot: "sink",
		name: "Kodi",
		slug: "kodi",
		description: "Kodi",
		requiresProKey: false,
		scriptSlug: "kodi-webhook",
		settingsSchema: { fields: {} },
	};
	for (const code of [
		"integration-disabled",
		"integrations-disabled",
		"pro-key-required",
	] as const) {
		layer(
			makeServiceLayer({
				proKey: code !== "pro-key-required",
				dependencies: () => ({
					engine: { execute: () => Effect.die("Rejected deliveries must not dispatch") },
					catalog: {
						findOwnedForUser: () =>
							Effect.succeed({ ...kodiSink, requiresProKey: code === "pro-key-required" }),
					},
					repository: {
						getUserDisableIntegrations: () => Effect.succeed(code === "integrations-disabled"),
						getByWebhookToken: () =>
							Effect.succeed({ ...kodiIntegration, isDisabled: code === "integration-disabled" }),
					},
				}),
			}),
		)((test) => {
			test.effect(`classifies ${code} before making the delivery recoverable`, () =>
				Effect.gen(function* () {
					yield* (yield* IntegrationsService).handleWebhook({
						rawBody: "{}",
						webhookToken: testWebhookToken,
						contentType: "application/json",
					});
					expect((yield* (yield* FakeIntegrationDependencies).calls).at(-1)).toMatchObject({
						method: "admitWebhook",
						input: { failureReason: { code } },
					});
				}),
			);
		});
	}

	layer(
		makeServiceLayer({
			dependencies: ({ record }) => ({
				catalog: { findOwnedForUser: () => Effect.succeed(kodiSink) },
				engine: { execute: (_workflow, options) => Effect.succeed(options.executionId) },
				repository: {
					getUserDisableIntegrations: () => Effect.succeed(false),
					getByWebhookToken: () => Effect.succeed(kodiIntegration),
				},
				imports: {
					createIntegrationRunIfIdle: () => Effect.die("sink runs must not be idle-gated"),
					createIntegrationRun: (input) =>
						record("createIntegrationRun", input).pipe(Effect.as(makeRun("completed"))),
				},
			}),
		}),
	)((test) => {
		test.effect("admits sink runs without idle exclusion", () =>
			Effect.gen(function* () {
				const service = yield* IntegrationsService;
				expect(
					yield* service.handleWebhook({
						rawBody: "{}",
						webhookToken: testWebhookToken,
						contentType: "application/json",
					}),
				).toEqual({ runId: makeRun("completed").id });
				expect((yield* (yield* FakeIntegrationDependencies).calls).at(-1)?.input).toMatchObject({
					integration: { lot: "sink", provider: "kodi", id: kodiIntegration.id },
				});
			}),
		);
	});

	const lambdaIntegration = makeIntegration({
		lot: "sink",
		pluginSlug: "example",
		provider: "lambda_sink",
		pluginInstallationId: "example-installation-id",
	});
	const lambdaSink: RegisteredIntegrationProvider = {
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

	layer(
		makeServiceLayer({
			dependencies: ({ record }) => ({
				catalog: { findOwnedForUser: () => Effect.succeed(lambdaSink) },
				imports: { createIntegrationRun: () => Effect.succeed(makeRun("completed")) },
				engine: {
					execute: (_workflow, options) =>
						record("execute", options).pipe(Effect.as(options.executionId)),
				},
				repository: {
					getUserDisableIntegrations: () => Effect.succeed(false),
					getByWebhookToken: () => Effect.succeed(lambdaIntegration),
				},
			}),
		}),
	)((test) => {
		test.effect(
			"stores the untouched request transport before dispatching the run identifier",
			() =>
				Effect.gen(function* () {
					const service = yield* IntegrationsService;
					yield* service.handleWebhook({ rawBody, contentType, webhookToken: testWebhookToken });
					const calls = yield* (yield* FakeIntegrationDependencies).calls;
					expect(calls.find((call) => call.method === "admitWebhook")?.input).toMatchObject({
						webhook: { rawBody, contentType },
					});
					expect(calls.at(-1)?.input).toMatchObject({
						payload: { runId: makeRun("completed").id },
					});
					expect(calls.at(-1)?.input).not.toHaveProperty("payload.webhook");
				}),
		);
	});
});

describe("integrationCommonSchema", () => {
	it("only declares fields the manifest validator reserves", () => {
		const declared = [
			...Object.keys(integrationCommonSchema("yank", true).fields),
			...(["yank", "sink", "push"] as const).flatMap((lot) =>
				Object.keys(integrationCommonSchema(lot, false).fields),
			),
		];

		expect(declared.filter((field) => !integrationCommonPropertyNames.has(field))).toEqual([]);
	});
});

describe("syncAll", () => {
	layer(
		makeServiceLayer({
			proKey: false,
			dependencies: ({ record }) => ({
				engine: {
					execute: (_workflow, options) =>
						record("execute", options).pipe(Effect.as(options.executionId)),
				},
				catalog: {
					findForUser: () => Effect.succeed(null),
					findOwnedForUser: () => Effect.succeed(null),
					resolveOwnedForUser: () => Effect.succeed(null),
				},
			}),
		}),
	)((test) => {
		test.effect("dispatches a user-scoped integration sync", () =>
			Effect.gen(function* () {
				const userId = UserId.make("sync-user");
				const result = yield* (yield* IntegrationsService).syncAll({
					userId,
					token: "test-account-generation",
				});

				expect(result.executionId).toMatch(/^integration-sync-/);
				expect((yield* (yield* FakeIntegrationDependencies).calls).at(-1)?.input).toMatchObject({
					discard: true,
					executionId: result.executionId,
					payload: { userId, executionId: result.executionId },
				});
			}),
		);
	});
});
