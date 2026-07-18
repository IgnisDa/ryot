import { WorkflowEngine } from "@effect/workflow/WorkflowEngine";
import type { CurrentUserValue } from "@ryot/contract/auth-middleware";
import { badRequest, notFound } from "@ryot/contract/errors";
import type {
	CreateIntegrationBody,
	IntegrationExtraSettings,
	IntegrationProvider,
	IntegrationProviderSettings,
	IntegrationWebhookPayload,
	UpdateIntegrationBody,
} from "@ryot/contract/modules/integrations/schemas";
import { IntegrationWebhookPayload as IntegrationWebhookPayloadSchema } from "@ryot/contract/modules/integrations/schemas";
import type { ImportRunId, IntegrationId, UserId } from "@ryot/contract/schema/brands";
import { Effect, Either, Schema } from "effect";

import { DbRunner, TransactionRunner } from "#lib/infrastructure/db/service";
import {
	formatPropertyIssues,
	parseAppSchemaProperties,
} from "#lib/property-schema/property-schema-runtime";
import { ImportsService } from "#modules/imports/service";
import { IntegrationProviderCatalog } from "#modules/plugins/integration-provider-catalog";
import type { RegisteredIntegrationProvider } from "#modules/plugins/integration-provider-catalog";

import { redactIntegrationForClient } from "./client-redaction";
import { ProcessIntegrationRunWorkflow } from "./integration-workflow";
import type { IntegrationReconciliationRun } from "./jobs";
import { IntegrationsRepository, type IntegrationRecord } from "./repository";

const defaultExtraSettings = {
	disableOnContinuousErrors: false,
} satisfies IntegrationExtraSettings;

const encodeIntegrationWebhookPayload = Schema.encode(
	Schema.parseJson(IntegrationWebhookPayloadSchema),
);

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
				Effect.mapError((error) =>
					badRequest(`Invalid providerSpecifics: ${formatPropertyIssues(error.issues)}`),
				),
				Effect.asVoid,
			)
		: badRequest(`Integration provider '${provider}' is not registered`);

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
): string | null => {
	if (minimumProgress < 0 || minimumProgress > 100) {
		return "minimumProgress must be between 0 and 100";
	}
	if (maximumProgress < 0 || maximumProgress > 100) {
		return "maximumProgress must be between 0 and 100";
	}
	if (minimumProgress > maximumProgress) {
		return "minimumProgress must not exceed maximumProgress";
	}
	return null;
};

export class IntegrationsService extends Effect.Service<IntegrationsService>()(
	"IntegrationsService",
	{
		effect: Effect.gen(function* () {
			const runWithDb = yield* DbRunner;
			const engine = yield* WorkflowEngine;
			const importsService = yield* ImportsService;
			const repository = yield* IntegrationsRepository;
			const runInTransaction = yield* TransactionRunner;
			const providerCatalog = yield* IntegrationProviderCatalog;

			const failCreatedRun = (runId: ImportRunId, message: string) =>
				importsService.failRunForIntegration(runId, message);

			const requireIntegration = Effect.fn("IntegrationsService.requireIntegration")(function* (
				userId: UserId,
				integrationId: IntegrationId,
			) {
				const integration = yield* runWithDb(repository.getForUser({ userId, integrationId }));
				if (!integration) {
					return yield* notFound("Integration not found");
				}
				return integration;
			});

			const create = Effect.fn("IntegrationsService.create")(function* (
				user: CurrentUserValue,
				body: CreateIntegrationBody,
			) {
				const registered = providerCatalog.find(body.provider);
				if (!registered) {
					return yield* badRequest(`Integration provider '${body.provider}' is not registered`);
				}
				yield* validateRegisteredSettings(body.provider, registered, body.providerSpecifics);
				const lot = registered.lot;
				if (lot === "push") {
					return yield* badRequest(`Integration provider '${body.provider}' cannot be created`);
				}

				const minimumProgress = body.minimumProgress ?? 2;
				const maximumProgress = body.maximumProgress ?? 95;
				const thresholdError = validateProgressThresholds(minimumProgress, maximumProgress);
				if (thresholdError) {
					return yield* badRequest(thresholdError);
				}

				const created = yield* runWithDb(
					repository.createForUser({
						userId: user.id,
						name: body.name ?? null,
						provider: body.provider,
						pluginSlug: registered.pluginSlug,
						isDisabled: body.isDisabled ?? false,
						providerSpecifics: body.providerSpecifics,
						syncOwnership: body.syncOwnership ?? false,
						minimumProgress: String(minimumProgress),
						maximumProgress: String(maximumProgress),
						extraSettings: body.extraSettings ?? defaultExtraSettings,
						lot,
					}),
				);

				return { id: created.id };
			});

			const get = (user: CurrentUserValue, integrationId: IntegrationId) =>
				requireIntegration(user.id, integrationId);

			const list = (
				user: CurrentUserValue,
				query: {
					provider?: CreateIntegrationBody["provider"] | undefined;
					isDisabled?: boolean | undefined;
				},
			) => runWithDb(repository.listForUser({ userId: user.id, ...query }));

			const update = Effect.fn("IntegrationsService.update")(function* (
				userId: UserId,
				integrationId: IntegrationId,
				body: UpdateIntegrationInput,
			) {
				const existing = yield* requireIntegration(userId, integrationId);

				let providerSpecifics: IntegrationProviderSettings | undefined;
				if (body.providerSpecifics !== undefined) {
					const merged = { ...existing.providerSpecifics, ...body.providerSpecifics };
					yield* validateRegisteredSettings(
						existing.provider,
						providerCatalog.findOwned(existing.provider, existing.pluginSlug),
						merged,
					);
					providerSpecifics = merged;
				}

				if (body.minimumProgress !== undefined || body.maximumProgress !== undefined) {
					const minimumProgress = body.minimumProgress ?? existing.minimumProgress;
					const maximumProgress = body.maximumProgress ?? existing.maximumProgress;
					const thresholdError = validateProgressThresholds(minimumProgress, maximumProgress);
					if (thresholdError) {
						return yield* badRequest(thresholdError);
					}
				}

				const updated = yield* runWithDb(
					repository.updateForUser({
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
					}),
				);

				if (!updated) {
					return yield* notFound("Integration not found");
				}

				return updated;
			});

			const disableIfEnabled = Effect.fn("IntegrationsService.disableIfEnabled")(function* (
				userId: UserId,
				integrationId: IntegrationId,
				importRunId: ImportRunId,
			) {
				return yield* runInTransaction(
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
				yield* runWithDb(repository.deleteForUser({ userId: user.id, integrationId }));
				return { id: integrationId };
			});

			const listRuns = Effect.fn("IntegrationsService.listRuns")(function* (
				user: CurrentUserValue,
				integrationId: IntegrationId,
			) {
				yield* requireIntegration(user.id, integrationId);
				return yield* importsService.listRunsByIntegrationId({
					integrationId,
					userId: user.id,
				});
			});

			const handleWebhook = Effect.fn("IntegrationsService.handleWebhook")(function* (input: {
				payload: IntegrationWebhookPayload;
				integrationId: IntegrationId;
			}) {
				const { integrationId, payload } = input;
				const integration = yield* runWithDb(repository.getByIdAnyUser({ integrationId }));
				if (!integration) {
					return yield* notFound("Integration not found");
				}
				if (
					providerCatalog.findOwned(integration.provider, integration.pluginSlug)?.lot !== "sink"
				) {
					return yield* badRequest("Integration is not a sink integration");
				}

				const run = yield* importsService.createRunForIntegration({
					userId: integration.userId,
					source: integration.provider,
					integrationId: integration.id,
					inputSummary: buildIntegrationInputSummary(integration),
				});

				if (integration.isDisabled) {
					yield* failCreatedRun(run.id, "Integration is disabled");
					return { runId: run.id };
				}

				const disableIntegrations = yield* runWithDb(
					repository.getUserDisableIntegrations({ userId: integration.userId }),
				);
				if (disableIntegrations) {
					yield* failCreatedRun(run.id, "Integrations are disabled for this user");
					return { runId: run.id };
				}

				const rawBody = yield* encodeIntegrationWebhookPayload(payload).pipe(Effect.orDie);

				const started = yield* engine
					.execute(ProcessIntegrationRunWorkflow, {
						discard: true,
						executionId: run.id,
						payload: {
							rawBody,
							runId: run.id,
							userId: integration.userId,
							integrationId: integration.id,
							contentType: "application/json",
						},
					})
					.pipe(Effect.either);

				if (Either.isLeft(started)) {
					yield* failCreatedRun(run.id, "Failed to enqueue integration job");
					return yield* badRequest("Could not queue the integration job; please try again");
				}

				return { runId: run.id };
			});

			const prepareScheduledYankRuns = Effect.fn("IntegrationsService.prepareScheduledYankRuns")(
				function* () {
					const integrations = yield* runWithDb(repository.listEnabledYankIntegrations());
					const runs: IntegrationReconciliationRun[] = [];

					for (const integration of integrations) {
						const disableIntegrations = yield* runWithDb(
							repository.getUserDisableIntegrations({ userId: integration.userId }),
						);
						if (disableIntegrations) {
							continue;
						}

						const hasActiveRun = yield* importsService.hasActiveRunForIntegration({
							integrationId: integration.id,
						});
						if (hasActiveRun) {
							continue;
						}

						const run = yield* importsService.createRunForIntegration({
							userId: integration.userId,
							source: integration.provider,
							integrationId: integration.id,
							inputSummary: buildIntegrationInputSummary(integration),
						});

						runs.push({
							runId: run.id,
							userId: integration.userId,
							integrationId: integration.id,
						});
					}

					return runs;
				},
			);

			const redactForClient = (integration: IntegrationRecord) =>
				redactIntegrationForClient(providerCatalog.findOwned, integration);

			const getForClient = (user: CurrentUserValue, integrationId: IntegrationId) =>
				get(user, integrationId).pipe(Effect.map(redactForClient));

			const listForClient = (...input: Parameters<typeof list>) =>
				list(...input).pipe(Effect.map((integrations) => integrations.map(redactForClient)));

			const updateForClient = (...input: Parameters<typeof update>) =>
				update(...input).pipe(Effect.map(redactForClient));

			return {
				create,
				update,
				listRuns,
				getForClient,
				handleWebhook,
				listForClient,
				updateForClient,
				disableIfEnabled,
				prepareScheduledYankRuns,
				delete: deleteIntegration,
			};
		}),
	},
) {}
