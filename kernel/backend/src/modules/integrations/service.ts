import type { CurrentUserValue } from "@ryot-app/contract/auth-middleware";
import {
	dataJsonSource,
	dataJsonIntegrationSettingsSchema,
} from "@ryot-app/contract/modules/imports/data-json";
import type { IngestionScope } from "@ryot-app/contract/modules/imports/ingestion";
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
import type { AccountGeneration } from "@ryot-app/contract/schema/account-generation";
import type {
	ImportRunId,
	IntegrationId,
	IntegrationWebhookToken,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { generateId } from "better-auth";
import { Context, DateTime, Effect, Result, Layer } from "effect";
import { WorkflowEngine } from "effect/workflow/WorkflowEngine";

import { DatabaseSession } from "#lib/infrastructure/db/session";
import { ProKeyService } from "#lib/infrastructure/pro-key";
import {
	formatPropertyIssues,
	parseAppSchemaProperties,
} from "#lib/property-schema/property-schema-runtime";
import { DataImportAdmission } from "#modules/imports/data-admission";
import { ImportsRepository } from "#modules/imports/repository";
import { IngestionRetirement } from "#modules/imports/retirement-service";
import { ImportsService } from "#modules/imports/service";
import { MutationReceipts } from "#modules/mutations/receipts";
import { admitWorkflow, dispatchAdmittedWorkflow } from "#modules/mutations/workflow-dispatch";
import { OAuthConnectionsService } from "#modules/oauth-connections/service";
import { IngestionReadinessService } from "#modules/plugins/ingestion-readiness-service";
import {
	IntegrationProviderCatalog,
	type RegisteredIntegrationProvider,
} from "#modules/plugins/integration-provider-catalog";

import { IntegrationIngestion } from "./ingestion";
import { ProcessIntegrationRunWorkflow } from "./integration-workflow";
import type { IntegrationSyncRun } from "./jobs";
import { IntegrationsRepository, type IntegrationRecord } from "./repository";
import { IntegrationSyncWorkflow } from "./sync-workflow";

const defaultExtraSettings = {
	disableOnContinuousErrors: false,
} satisfies IntegrationExtraSettings;

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
							reason: { provider, code: "invalid-provider-settings" },
						}),
				),
				Effect.asVoid,
			)
		: new IntegrationRequestError({ reason: { provider, code: "provider-not-found" } });

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
		return { value: minimumProgress, field: "minimumProgress", code: "progress-out-of-range" };
	}
	if (maximumProgress < 0 || maximumProgress > 100) {
		return { value: maximumProgress, field: "maximumProgress", code: "progress-out-of-range" };
	}
	if (minimumProgress > maximumProgress) {
		return { minimumProgress, maximumProgress, code: "invalid-progress-range" };
	}
	return null;
};

export class IntegrationsService extends Context.Service<IntegrationsService>()(
	"IntegrationsService",
	{
		make: Effect.gen(function* () {
			const database = yield* DatabaseSession;
			const transaction = <A, E, R>(work: Effect.Effect<A, E, R>) =>
				database.transaction(work).pipe(Effect.catchTag("DatabaseSessionStateError", Effect.die));
			const proKey = yield* ProKeyService;
			const engine = yield* WorkflowEngine;
			const receipts = yield* MutationReceipts.make;
			const importsService = yield* ImportsService;
			const repository = yield* IntegrationsRepository;
			const providerCatalog = yield* IntegrationProviderCatalog;
			const oauthConnections = yield* OAuthConnectionsService;
			const dataAdmission = yield* DataImportAdmission;
			const readiness = yield* IngestionReadinessService;
			const ingestion = yield* IntegrationIngestion;
			const importRepository = yield* ImportsRepository;
			const retirement = yield* IngestionRetirement;
			const failCreatedRun = Effect.fnUntraced(function* (
				scope: IngestionScope,
				reason: ImportRunFailureReason,
			) {
				yield* importRepository.startIngestion({ scope, startedAt: yield* DateTime.nowAsDate });
				yield* ingestion.settle(scope, "failed", reason);
			});

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

			const bindOAuthConnections = (input: {
				readonly userId: UserId;
				readonly integrationId: IntegrationId;
				readonly registered: RegisteredIntegrationProvider;
				readonly settings: IntegrationProviderSettings;
			}) =>
				oauthConnections
					.bindIntegrationSettings({
						userId: input.userId,
						settings: input.settings,
						integrationId: input.integrationId,
						integrationProvider: input.registered.slug,
						settingsSchema: input.registered.settingsSchema,
						pluginInstallationId: input.registered.installationId,
					})
					.pipe(
						Effect.catchTag("OAuthConnectionBindingError", () =>
							Effect.fail(
								new IntegrationRequestError({
									reason: { provider: input.registered.slug, code: "invalid-provider-settings" },
								}),
							),
						),
					);

			const requireIntegration = Effect.fn("IntegrationsService.requireIntegration")(function* (
				userId: UserId,
				integrationId: IntegrationId,
			) {
				const integration = yield* repository.getForUser({ userId, integrationId });
				if (!integration) {
					return yield* new IntegrationNotFoundError({
						reason: { integrationId, code: "integration-not-found" },
					});
				}
				return integration;
			});

			const create = Effect.fn("IntegrationsService.create")(function* (
				user: CurrentUserValue,
				body: CreateIntegrationBody,
			) {
				if (body.provider === dataJsonSource) {
					yield* parseAppSchemaProperties({
						kind: "Data webhook",
						properties: body.providerSpecifics,
						propertiesSchema: dataJsonIntegrationSettingsSchema,
					}).pipe(
						Effect.mapError(
							() =>
								new IntegrationRequestError({
									reason: { provider: dataJsonSource, code: "invalid-provider-settings" },
								}),
						),
					);
					return yield* transaction(
						repository.createForUser({
							lot: "sink",
							userId: user.id,
							syncOwnership: false,
							minimumProgress: "0",
							providerSpecifics: {},
							maximumProgress: "100",
							name: body.name ?? null,
							provider: dataJsonSource,
							pluginInstallationId: null,
							isDisabled: body.isDisabled ?? false,
							extraSettings: body.extraSettings ?? defaultExtraSettings,
						}),
					);
				}
				const registered = yield* providerCatalog.findForUser(user.id, body.provider);
				if (!registered) {
					return yield* new IntegrationRequestError({
						reason: { provider: body.provider, code: "provider-not-found" },
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

				const created = yield* transaction(
					Effect.gen(function* () {
						const inserted = yield* repository.createForUser({
							lot,
							userId: user.id,
							name: body.name ?? null,
							provider: body.provider,
							isDisabled: body.isDisabled ?? false,
							minimumProgress: String(minimumProgress),
							maximumProgress: String(maximumProgress),
							providerSpecifics: body.providerSpecifics,
							syncOwnership: body.syncOwnership ?? false,
							pluginInstallationId: registered.installationId,
							extraSettings: body.extraSettings ?? defaultExtraSettings,
						});
						yield* bindOAuthConnections({
							registered,
							userId: user.id,
							integrationId: inserted.id,
							settings: body.providerSpecifics,
						});
						return inserted;
					}),
				);

				return created;
			});

			const update = Effect.fn("IntegrationsService.update")(function* (
				userId: UserId,
				integrationId: IntegrationId,
				body: UpdateIntegrationInput,
			) {
				const existing = yield* requireIntegration(userId, integrationId);
				const registered =
					existing.pluginInstallationId === null
						? null
						: yield* providerCatalog.findOwnedForUser(
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
					if (existing.pluginInstallationId === null) {
						yield* parseAppSchemaProperties({
							properties: merged,
							kind: "Data webhook",
							propertiesSchema: dataJsonIntegrationSettingsSchema,
						}).pipe(
							Effect.mapError(
								() =>
									new IntegrationRequestError({
										reason: { provider: dataJsonSource, code: "invalid-provider-settings" },
									}),
							),
						);
					} else {
						yield* validateRegisteredSettings(existing.provider, registered, merged);
					}
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

				const settingsPatch = body.providerSpecifics;
				const updated = yield* transaction(
					Effect.gen(function* () {
						const written = yield* repository.updateForUser({
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
						if (written && registered && settingsPatch !== undefined) {
							yield* bindOAuthConnections({
								userId,
								registered,
								integrationId,
								settings: settingsPatch,
							});
						}
						return written;
					}),
				);

				if (!updated) {
					return yield* new IntegrationNotFoundError({
						reason: { integrationId, code: "integration-not-found" },
					});
				}

				return updated;
			});

			const disableIfEnabled = Effect.fn("IntegrationsService.disableIfEnabled")(function* (
				userId: UserId,
				integrationId: IntegrationId,
				importRunId: ImportRunId,
			) {
				return yield* transaction(
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
					}),
				);
			});

			const deleteIntegration = Effect.fn("IntegrationsService.delete")(function* (
				user: CurrentUserValue,
				integrationId: IntegrationId,
			) {
				yield* requireIntegration(user.id, integrationId);
				yield* transaction(repository.beginRetirement({ integrationId, userId: user.id }));
				yield* retirement.retire({ integrationId, userId: user.id }).pipe(Effect.orDie);
				yield* repository.deleteForUser({ integrationId, userId: user.id });
				return { id: integrationId };
			});

			const handleWebhook = Effect.fn("IntegrationsService.handleWebhook")(function* (input: {
				rawBody: string;
				contentType: string;
				submissionKey?: string | undefined;
				webhookToken: IntegrationWebhookToken;
			}) {
				const integration = yield* repository.getByWebhookToken(input.webhookToken);
				if (!integration) {
					return yield* new IntegrationNotFoundError({
						reason: { code: "integration-webhook-not-found" },
					});
				}
				const integrationId = integration.id;
				if (integration.pluginInstallationId === null) {
					if (
						!input.submissionKey?.trim() ||
						input.contentType.split(";")[0]?.trim() !== "application/json"
					) {
						return yield* new IntegrationRequestError({
							reason: { provider: dataJsonSource, code: "invalid-provider-settings" },
						});
					}
					const accountGeneration = yield* receipts.currentAccount(integration.userId);
					const admitted = yield* dataAdmission.admit({
						accountGeneration,
						rawBody: input.rawBody,
						userId: integration.userId,
						integrationId: integration.id,
						submissionKey: input.submissionKey,
					});
					if (!admitted.created) {
						const control = yield* importsService.getRunControlForUser({
							runId: admitted.runId,
							userId: integration.userId,
						});
						if (control?.status !== "pending") {
							return { runId: admitted.runId };
						}
					}
					const scope = { accountGeneration, runId: admitted.runId, userId: integration.userId };
					const release = dataAdmission
						.release(scope)
						.pipe(
							Effect.catchCause((cause) =>
								Effect.logError("Data webhook payload cleanup failed", cause),
							),
						);
					let disabled: "integration-disabled" | "integrations-disabled" | null = null;
					if (integration.isDisabled) {
						disabled = "integration-disabled";
					} else if (yield* repository.getUserDisableIntegrations({ userId: integration.userId })) {
						disabled = "integrations-disabled";
					}
					if (disabled) {
						yield* failCreatedRun(scope, { code: disabled }).pipe(Effect.orDie);
						yield* release;
						return { runId: admitted.runId };
					}
					yield* dispatchAdmittedWorkflow(
						receipts,
						engine,
						ProcessIntegrationRunWorkflow,
						accountGeneration,
						{
							discard: true,
							executionId: admitted.runId,
							payload: {
								accountGeneration,
								runId: admitted.runId,
								userId: integration.userId,
								integrationId: integration.id,
							},
						},
						(admission) => admission,
						(execution) => execution,
					).pipe(
						Effect.catchCause((cause) => Effect.logError("Data webhook dispatch deferred", cause)),
					);
					return { runId: admitted.runId };
				}
				const registered = yield* providerCatalog.findOwnedForUser(
					integration.userId,
					integration.provider,
					integration.pluginInstallationId,
				);
				if (integration.lot !== "sink") {
					return yield* new IntegrationRequestError({
						reason: {
							integrationId,
							expected: "sink",
							actual: integration.lot,
							code: "wrong-integration-lot",
						},
					});
				}

				let failureReason: ImportRunFailureReason | undefined;
				if (integration.isDisabled) {
					failureReason = { code: "integration-disabled" };
				} else if (yield* repository.getUserDisableIntegrations({ userId: integration.userId })) {
					failureReason = { code: "integrations-disabled" };
				} else if (registered?.requiresProKey && !(yield* proKey.isValidated)) {
					failureReason = { code: "pro-key-required" };
				}
				const scope = yield* ingestion
					.admitWebhook(
						integration,
						{ rawBody: input.rawBody, contentType: input.contentType },
						failureReason,
					)
					.pipe(
						Effect.mapError(
							() =>
								new IntegrationRequestError({
									reason: { code: "queue-unavailable", operation: "integration-webhook-admission" },
								}),
						),
					);
				const run = { id: scope.runId };

				if (failureReason || !registered) {
					return { runId: run.id };
				}

				const released = yield* ingestion
					.release(scope, integration)
					.pipe(
						Effect.catchCause((cause) =>
							Effect.logError("integration release deferred", cause).pipe(Effect.as(false)),
						),
					);
				if (!released) {
					return { runId: run.id };
				}
				const accountGeneration = scope.accountGeneration;
				const started = yield* dispatchAdmittedWorkflow(
					receipts,
					engine,
					ProcessIntegrationRunWorkflow,
					accountGeneration,
					{
						discard: true,
						executionId: run.id,
						payload: {
							runId: run.id,
							accountGeneration,
							userId: integration.userId,
							integrationId: integration.id,
						},
					},
					(admission) => admission,
					(execution) => execution.pipe(Effect.result),
				);

				if (Result.isFailure(started)) {
					yield* Effect.logError("integration workflow enqueue failed", started.failure);
				}

				return { runId: run.id };
			});

			const prepareYankRuns = Effect.fn("IntegrationsService.prepareYankRuns")(function* (
				userId: UserId | null,
				accountGeneration: AccountGeneration | null,
			) {
				const integrations = yield* repository.listEnabledYankIntegrations({ userId });
				const runs: IntegrationSyncRun[] = [];
				const isPro = yield* proKey.isValidated;
				const resolvedByUser = new Map<
					UserId,
					Effect.Success<ReturnType<typeof providerCatalog.listResolvedForUser>>
				>();

				for (const integration of integrations) {
					if (integration.pluginInstallationId === null) {
						continue;
					}
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
					const evaluated = yield* readiness
						.evaluateIntegration({
							userId: integration.userId,
							integrationId: integration.id,
							providerSlug: integration.provider,
							settings: integration.providerSpecifics,
							installationId: integration.pluginInstallationId,
						})
						.pipe(Effect.catchTag("IngestionReadinessError", () => Effect.succeed(null)));
					if (!evaluated?.readiness.ready || !evaluated.readiness.plan) {
						continue;
					}

					const run = yield* importsService.createIntegrationRunIfIdle({
						userId: integration.userId,
						source: integration.provider,
						integrationId: integration.id,
						pluginInstallationId: integration.pluginInstallationId,
						inputSummary: buildIntegrationInputSummary(integration),
					});
					if (!run) {
						continue;
					}

					const account = accountGeneration ?? (yield* receipts.currentAccount(integration.userId));
					yield* admitWorkflow(receipts, ProcessIntegrationRunWorkflow, account, run.id);
					runs.push({
						runId: run.id,
						accountGeneration: account,
						userId: integration.userId,
						integrationId: integration.id,
					});
				}

				return runs;
			});

			const syncAll = Effect.fn("IntegrationsService.syncAll")(function* (
				accountGeneration: AccountGeneration,
			) {
				const userId = accountGeneration.userId;
				const executionId = `integration-sync-${generateId()}`;
				const started = yield* dispatchAdmittedWorkflow(
					receipts,
					engine,
					IntegrationSyncWorkflow,
					accountGeneration,
					{ executionId, discard: true, payload: { userId, executionId, accountGeneration } },
					(admission) => admission,
					(execution) => execution.pipe(Effect.result),
				);
				if (Result.isFailure(started)) {
					yield* Effect.logError("integration sync enqueue failed", started.failure).pipe(
						Effect.annotateLogs({ userId, executionId }),
					);
					return yield* new IntegrationRequestError({
						reason: { code: "queue-unavailable", operation: "integration-sync" },
					});
				}
				return { executionId };
			});

			return {
				create,
				update,
				syncAll,
				handleWebhook,
				prepareYankRuns,
				disableIfEnabled,
				delete: deleteIntegration,
				prepareRecoveryRuns: ingestion.recoverable,
				recordRunFinished: repository.recordRunFinished,
				releaseRecoveryRun: Effect.fnUntraced(function* (run: IntegrationSyncRun) {
					const scope = {
						runId: run.runId,
						userId: run.userId,
						accountGeneration: run.accountGeneration,
					};
					if (yield* ingestion.expire(scope)) {
						return false;
					}
					const control = yield* importRepository.getIngestionRun(scope);
					if (control?.status === "cancelling") {
						yield* ingestion.settle(scope, "cancelled");
						return false;
					}
					if (control?.status === "pending" && control.plan && control.pins) {
						return yield* ingestion.inputReady(scope);
					}
					const integration = yield* repository.getForUser({
						userId: run.userId,
						integrationId: run.integrationId,
					});
					if (
						!integration ||
						integration.isDisabled ||
						(yield* repository.getUserDisableIntegrations({ userId: run.userId }))
					) {
						return false;
					}
					const prepared = yield* importRepository.getPreparedRelease(scope);
					if (prepared) {
						if (prepared.requiresProKey && !(yield* proKey.isValidated)) {
							return false;
						}
						return yield* ingestion.release(scope, integration);
					}
					const registered = integration.pluginInstallationId
						? yield* providerCatalog.findOwnedForUser(
								run.userId,
								integration.provider,
								integration.pluginInstallationId,
							)
						: null;
					if (!registered || (registered.requiresProKey && !(yield* proKey.isValidated))) {
						return false;
					}
					return yield* ingestion
						.release(scope, integration)
						.pipe(Effect.catchTag("IngestionReadinessError", () => Effect.succeed(false)));
				}),
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
