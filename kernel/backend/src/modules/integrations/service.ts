import type { CurrentUserValue } from "@ryot-app/contract/auth-middleware";
import type { ImportRunFailureReason } from "@ryot-app/contract/modules/imports/schemas";
import {
	type CreateIntegrationBody,
	type IntegrationExtraSettings,
	type IntegrationProvider,
	type IntegrationProviderSettings,
	type UpdateIntegrationBody,
	IntegrationNotFoundError,
	IntegrationRequestError,
	type IntegrationRequestFailureReason,
} from "@ryot-app/contract/modules/integrations/schemas";
import type { ImportRunId, IntegrationId, UserId } from "@ryot-app/contract/schema/brands";
import type { AppSchema } from "@ryot-app/contract/schema/property-schema";
import { generateId } from "better-auth";
import { Context, Effect, Result, Layer } from "effect";
import { WorkflowEngine } from "effect/unstable/workflow/WorkflowEngine";

import { Database, mapDatabaseErrors } from "#lib/infrastructure/db/service";
import { ProKeyService } from "#lib/infrastructure/pro-key";
import {
	formatPropertyIssues,
	parseAppSchemaProperties,
} from "#lib/property-schema/property-schema-runtime";
import { ImportsService } from "#modules/imports/service";
import { IntegrationProviderCatalog } from "#modules/plugins/integration-provider-catalog";
import type { RegisteredIntegrationProvider } from "#modules/plugins/integration-provider-catalog";

import { redactIntegrationForClient } from "./client-redaction";
import { ProcessIntegrationRunWorkflow } from "./integration-workflow";
import type { IntegrationSyncRun } from "./jobs";
import { IntegrationsRepository, type IntegrationRecord } from "./repository";
import { IntegrationSyncWorkflow } from "./sync-workflow";

const defaultExtraSettings = {
	disableOnContinuousErrors: false,
} satisfies IntegrationExtraSettings;

const baseCommonFields = {
	name: { label: "Name", type: "string", description: "Optional name for this integration" },
	isDisabled: {
		type: "boolean",
		label: "Disabled",
		defaultValue: false,
		description: "Disable this integration",
	},
	disableOnContinuousErrors: {
		type: "boolean",
		defaultValue: false,
		label: "Disable on continuous errors",
		description: "Disable this integration after continuous errors",
	},
} satisfies AppSchema["fields"];

const progressCommonFields = {
	minimumProgress: {
		type: "number",
		defaultValue: 2,
		label: "Minimum progress",
		validation: { minimum: 0, maximum: 100 },
		description: "Minimum progress percentage to synchronize",
	},
	maximumProgress: {
		type: "number",
		defaultValue: 95,
		label: "Maximum progress",
		validation: { minimum: 0, maximum: 100 },
		description: "Maximum progress percentage to synchronize",
	},
} satisfies AppSchema["fields"];

export const integrationCommonSchema = (lot: RegisteredIntegrationProvider["lot"]): AppSchema => ({
	fields: {
		...baseCommonFields,
		...(lot === "push" ? {} : progressCommonFields),
		...(lot === "yank"
			? {
					syncOwnership: {
						defaultValue: false,
						label: "Sync ownership",
						type: "boolean" as const,
						description: "Synchronize ownership from this integration",
					},
				}
			: {}),
	},
});

const validateRegisteredSettings = (
	provider: IntegrationProvider,
	registered: RegisteredIntegrationProvider | null,
	settings: unknown,
) =>
	registered
		? parseAppSchemaProperties({
				properties: settings,
				kind: `${provider} integration`,
				propertiesSchema: registered.settingsSchema,
			}).pipe(
				Effect.tapError((error) =>
					Effect.logWarning("invalid integration provider settings", {
						provider,
						issues: formatPropertyIssues(error.issues),
					}),
				),
				Effect.mapError(
					() =>
						new IntegrationRequestError({
							reason: { code: "invalid-provider-settings", provider },
						}),
				),
				Effect.asVoid,
			)
		: new IntegrationRequestError({ reason: { code: "provider-not-found", provider } });

type UpdateIntegrationInput = UpdateIntegrationBody & {
	readonly lastFinishedAt?: Date | null | undefined;
};

const buildIntegrationInputSummary = (
	integration: Pick<IntegrationRecord, "id" | "lot" | "name" | "provider">,
) => ({
	lot: integration.lot,
	integrationId: integration.id,
	provider: integration.provider,
	...(integration.name ? { name: integration.name } : {}),
});

export const validateProgressThresholds = (
	minimumProgress: number,
	maximumProgress: number,
): IntegrationRequestFailureReason | null => {
	if (minimumProgress < 0 || minimumProgress > 100) {
		return { code: "progress-out-of-range", field: "minimumProgress", value: minimumProgress };
	}
	if (maximumProgress < 0 || maximumProgress > 100) {
		return { code: "progress-out-of-range", field: "maximumProgress", value: maximumProgress };
	}
	if (minimumProgress > maximumProgress) {
		return { code: "invalid-progress-range", minimumProgress, maximumProgress };
	}
	return null;
};

export class IntegrationsService extends Context.Service<IntegrationsService>()(
	"IntegrationsService",
	{
		make: Effect.gen(function* () {
			const database = yield* Database;
			const proKey = yield* ProKeyService;
			const engine = yield* WorkflowEngine;
			const importsService = yield* ImportsService;
			const repository = yield* IntegrationsRepository;
			const providerCatalog = yield* IntegrationProviderCatalog;
			const redactForClient = Effect.fn("IntegrationsService.redactForClient")(function* (
				integration: IntegrationRecord,
			) {
				const registered = yield* providerCatalog.findOwnedForUser(
					integration.userId,
					integration.provider,
					integration.pluginInstallationId,
				);
				return redactIntegrationForClient(registered, integration);
			});

			const failCreatedRun = (runId: ImportRunId, reason: ImportRunFailureReason) =>
				importsService.failRunForIntegration(runId, reason);

			const requireProKeyFor = (registered: RegisteredIntegrationProvider) =>
				registered.requiresProKey
					? Effect.flatMap(proKey.isValidated, (isPro) =>
							isPro
								? Effect.void
								: Effect.fail(
										new IntegrationRequestError({
											reason: { code: "pro-key-required", provider: registered.slug },
										}),
									),
						)
					: Effect.void;

			const requireIntegration = Effect.fn("IntegrationsService.requireIntegration")(function* (
				userId: UserId,
				integrationId: IntegrationId,
			) {
				const integration = yield* repository.getForUser({ userId, integrationId });
				if (!integration) {
					return yield* new IntegrationNotFoundError({
						reason: { code: "integration-not-found", integrationId },
					});
				}
				return integration;
			});

			const listIntegrationProviders = Effect.fn("IntegrationsService.listIntegrationProviders")(
				function* (userId: UserId) {
					const isPro = yield* proKey.isValidated;
					return (yield* providerCatalog.listResolvedForUser(userId)).map(
						({ provider, script }) => {
							const requiresProKey = provider.requiresProKey ?? false;
							return {
								requiresProKey,
								lot: provider.lot,
								slug: provider.slug,
								name: provider.name,
								pluginSlug: provider.pluginSlug,
								description: provider.description,
								settingsSchema: provider.settingsSchema,
								commonSchema: integrationCommonSchema(provider.lot),
								isCreatable:
									(provider.lot === "push" || script !== null) && (!requiresProKey || isPro),
							};
						},
					);
				},
			);

			const getForClient = (userId: UserId, integrationId: IntegrationId) =>
				requireIntegration(userId, integrationId).pipe(Effect.flatMap(redactForClient));

			const create = Effect.fn("IntegrationsService.create")(function* (
				user: CurrentUserValue,
				body: CreateIntegrationBody,
			) {
				const registered = yield* providerCatalog.findForUser(user.id, body.provider);
				if (!registered) {
					return yield* new IntegrationRequestError({
						reason: { code: "provider-not-found", provider: body.provider },
					});
				}
				yield* validateRegisteredSettings(body.provider, registered, body.providerSpecifics);
				yield* requireProKeyFor(registered);
				const lot = registered.lot;

				const minimumProgress = body.minimumProgress ?? 2;
				const maximumProgress = body.maximumProgress ?? 95;
				const thresholdError = validateProgressThresholds(minimumProgress, maximumProgress);
				if (thresholdError) {
					return yield* new IntegrationRequestError({ reason: thresholdError });
				}

				const created = yield* repository.createForUser({
					lot,
					userId: user.id,
					name: body.name ?? null,
					provider: body.provider,
					isDisabled: body.isDisabled ?? false,
					providerSpecifics: body.providerSpecifics,
					syncOwnership: body.syncOwnership ?? false,
					minimumProgress: String(minimumProgress),
					maximumProgress: String(maximumProgress),
					pluginInstallationId: registered.installationId,
					extraSettings: body.extraSettings ?? defaultExtraSettings,
				});

				return yield* redactForClient(created);
			});

			const update = Effect.fn("IntegrationsService.update")(function* (
				userId: UserId,
				integrationId: IntegrationId,
				body: UpdateIntegrationInput,
			) {
				const existing = yield* requireIntegration(userId, integrationId);
				const registered = yield* providerCatalog.findOwnedForUser(
					userId,
					existing.provider,
					existing.pluginInstallationId,
				);
				if (registered) {
					yield* requireProKeyFor(registered);
				}

				let providerSpecifics: IntegrationProviderSettings | undefined;
				if (body.providerSpecifics !== undefined) {
					const merged = { ...existing.providerSpecifics, ...body.providerSpecifics };
					yield* validateRegisteredSettings(existing.provider, registered, merged);
					providerSpecifics = merged;
				}

				if (body.minimumProgress !== undefined || body.maximumProgress !== undefined) {
					const minimumProgress = body.minimumProgress ?? existing.minimumProgress;
					const maximumProgress = body.maximumProgress ?? existing.maximumProgress;
					const thresholdError = validateProgressThresholds(minimumProgress, maximumProgress);
					if (thresholdError) {
						return yield* new IntegrationRequestError({ reason: thresholdError });
					}
				}

				const updated = yield* repository.updateForUser({
					userId,
					integrationId,
					name: body.name,
					providerSpecifics,
					isDisabled: body.isDisabled,
					extraSettings: body.extraSettings,
					syncOwnership: body.syncOwnership,
					lastFinishedAt: body.lastFinishedAt,
					minimumProgress:
						body.minimumProgress !== undefined ? String(body.minimumProgress) : undefined,
					maximumProgress:
						body.maximumProgress !== undefined ? String(body.maximumProgress) : undefined,
				});

				if (!updated) {
					return yield* new IntegrationNotFoundError({
						reason: { code: "integration-not-found", integrationId },
					});
				}

				return updated;
			});

			const disableIfEnabled = Effect.fn("IntegrationsService.disableIfEnabled")(function* (
				userId: UserId,
				integrationId: IntegrationId,
				importRunId: ImportRunId,
			) {
				return yield* mapDatabaseErrors(
					database.transaction((transaction) =>
						Effect.gen(function* () {
							if (yield* repository.hasAutoDisableClaim(importRunId)) {
								return true;
							}
							const disabled = yield* repository.disableForUserIfEnabled({ userId, integrationId });
							if (!disabled) {
								return yield* repository.hasAutoDisableClaim(importRunId);
							}
							yield* repository.insertAutoDisableClaim({ importRunId, integrationId });
							return true;
						}).pipe(Effect.provideService(Database, transaction)),
					),
				);
			});

			const deleteIntegration = Effect.fn("IntegrationsService.delete")(function* (
				user: CurrentUserValue,
				integrationId: IntegrationId,
			) {
				yield* requireIntegration(user.id, integrationId);
				yield* repository.deleteForUser({ userId: user.id, integrationId });
				return { id: integrationId };
			});

			const handleWebhook = Effect.fn("IntegrationsService.handleWebhook")(function* (input: {
				rawBody: string;
				contentType: string;
				integrationId: IntegrationId;
			}) {
				const { integrationId } = input;
				const integration = yield* repository.getByIdAnyUser({ integrationId });
				if (!integration) {
					return yield* new IntegrationNotFoundError({
						reason: { code: "integration-not-found", integrationId },
					});
				}
				const registered = yield* providerCatalog.findOwnedForUser(
					integration.userId,
					integration.provider,
					integration.pluginInstallationId,
				);
				if (!registered) {
					return yield* new IntegrationNotFoundError({
						reason: { code: "integration-not-found", integrationId },
					});
				}
				if (registered.lot !== "sink") {
					return yield* new IntegrationRequestError({
						reason: {
							integrationId,
							expected: "sink",
							actual: integration.lot,
							code: "wrong-integration-lot",
						},
					});
				}

				const run = yield* importsService.createRunForIntegration({
					integrationLot: "sink",
					userId: integration.userId,
					source: integration.provider,
					integrationId: integration.id,
					inputSummary: buildIntegrationInputSummary(integration),
					pluginInstallationId: integration.pluginInstallationId,
				});

				if (integration.isDisabled) {
					yield* failCreatedRun(run.id, { code: "integration-disabled" });
					return { runId: run.id };
				}

				const disableIntegrations = yield* repository.getUserDisableIntegrations({
					userId: integration.userId,
				});
				if (disableIntegrations) {
					yield* failCreatedRun(run.id, { code: "integrations-disabled" });
					return { runId: run.id };
				}

				if (registered.requiresProKey && !(yield* proKey.isValidated)) {
					yield* failCreatedRun(run.id, { code: "pro-key-required" });
					return { runId: run.id };
				}

				const started = yield* engine
					.execute(ProcessIntegrationRunWorkflow, {
						discard: true,
						executionId: run.id,
						payload: {
							runId: run.id,
							userId: integration.userId,
							integrationId: integration.id,
							webhook: { rawBody: input.rawBody, contentType: input.contentType },
						},
					})
					.pipe(Effect.result);

				if (Result.isFailure(started)) {
					yield* Effect.logError("integration workflow enqueue failed", started.failure);
					yield* failCreatedRun(run.id, {
						code: "queue-unavailable",
						operation: "integration-webhook",
					});
					return yield* new IntegrationRequestError({
						reason: { code: "queue-unavailable", operation: "integration-webhook" },
					});
				}

				return { runId: run.id };
			});

			const prepareYankRuns = Effect.fn("IntegrationsService.prepareYankRuns")(function* (
				userId: UserId | null,
			) {
				const integrations = yield* repository.listEnabledYankIntegrations({ userId });
				const runs: IntegrationSyncRun[] = [];
				const isPro = yield* proKey.isValidated;
				const resolvedByUser = new Map<
					UserId,
					Effect.Success<ReturnType<typeof providerCatalog.listResolvedForUser>>
				>();

				for (const integration of integrations) {
					const disableIntegrations = yield* repository.getUserDisableIntegrations({
						userId: integration.userId,
					});
					if (disableIntegrations) {
						continue;
					}

					let resolved = resolvedByUser.get(integration.userId);
					if (!resolved) {
						resolved = yield* providerCatalog.listResolvedForUser(integration.userId);
						resolvedByUser.set(integration.userId, resolved);
					}
					const registered = resolved.find(
						({ provider }) =>
							provider.slug === integration.provider &&
							provider.installationId === integration.pluginInstallationId,
					)?.provider;
					if (!registered || (registered.requiresProKey && !isPro)) {
						continue;
					}

					const run = yield* importsService.createRunForIntegrationIfIdle({
						userId: integration.userId,
						source: integration.provider,
						integrationId: integration.id,
						pluginInstallationId: integration.pluginInstallationId,
						inputSummary: buildIntegrationInputSummary(integration),
					});
					if (!run) {
						continue;
					}

					runs.push({ runId: run.id, userId: integration.userId, integrationId: integration.id });
				}

				return runs;
			});

			const syncAll = Effect.fn("IntegrationsService.syncAll")(function* (userId: UserId) {
				const executionId = `integration-sync-${generateId()}`;
				const started = yield* engine
					.execute(IntegrationSyncWorkflow, {
						executionId,
						discard: true,
						payload: { userId, executionId },
					})
					.pipe(Effect.result);
				if (Result.isFailure(started)) {
					yield* Effect.logError("integration sync enqueue failed", started.failure).pipe(
						Effect.annotateLogs({ executionId, userId }),
					);
					return yield* new IntegrationRequestError({
						reason: { code: "queue-unavailable", operation: "integration-sync" },
					});
				}
				return { executionId };
			});

			const updateForClient = (...input: Parameters<typeof update>) =>
				update(...input).pipe(Effect.flatMap(redactForClient));

			return {
				create,
				update,
				syncAll,
				getForClient,
				handleWebhook,
				prepareYankRuns,
				updateForClient,
				disableIfEnabled,
				listIntegrationProviders,
				delete: deleteIntegration,
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
