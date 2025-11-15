import { WorkflowEngine } from "@effect/workflow/WorkflowEngine";
import type { CurrentUserValue } from "@ryot/contract/auth-middleware";
import { badRequest, notFound } from "@ryot/contract/errors";
import type {
	CreateIntegrationBody,
	IntegrationExtraSettings,
	IntegrationProviderSpecifics,
	UpdateIntegrationBody,
} from "@ryot/contract/modules/integrations/schemas";
import { IntegrationProviderSpecifics as IntegrationProviderSpecificsSchema } from "@ryot/contract/modules/integrations/schemas";
import { providerLotByProvider } from "@ryot/contract/modules/integrations/types";
import type { ImportRunId, IntegrationId, UserId } from "@ryot/contract/schema/brands";
import { Effect, Either, Schema } from "effect";

import { DbRunner } from "#lib/db/service";
import { ImportsService } from "#modules/imports/service";

import { IntegrationsRepository, type IntegrationRecord } from "./repository";
import { ProcessIntegrationRunWorkflow } from "./workflows";

const defaultExtraSettings = {
	disableOnContinuousErrors: false,
} satisfies IntegrationExtraSettings;

const decodeIntegrationProviderSpecifics = Schema.decodeUnknown(IntegrationProviderSpecificsSchema);

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

			const enqueueIntegrationRun = Effect.fn("IntegrationsService.enqueueIntegrationRun")(
				function* (integration: IntegrationRecord, payload?: unknown) {
					const run = yield* importsService.createRunForIntegration({
						userId: integration.userId,
						source: integration.provider,
						integrationId: integration.id,
						inputSummary: buildIntegrationInputSummary(integration),
					});

					const started = yield* engine
						.execute(ProcessIntegrationRunWorkflow, {
							discard: true,
							executionId: run.id,
							payload: {
								runId: run.id,
								userId: integration.userId,
								integrationId: integration.id,
								...(payload !== undefined ? { payload } : {}),
							},
						})
						.pipe(Effect.either);

					if (Either.isLeft(started)) {
						yield* failCreatedRun(run.id, "Failed to enqueue integration job");
						return yield* badRequest("Could not queue the integration job; please try again");
					}

					return { runId: run.id };
				},
			);

			const create = Effect.fn("IntegrationsService.create")(function* (
				user: CurrentUserValue,
				body: CreateIntegrationBody,
			) {
				if (body.providerSpecifics.kind !== body.provider) {
					return yield* badRequest("providerSpecifics.kind must match provider");
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
						provider: body.provider,
						name: body.name ?? null,
						isDisabled: body.isDisabled ?? false,
						lot: providerLotByProvider[body.provider],
						providerSpecifics: body.providerSpecifics,
						syncOwnership: body.syncOwnership ?? false,
						minimumProgress: String(minimumProgress),
						maximumProgress: String(maximumProgress),
						extraSettings: body.extraSettings ?? defaultExtraSettings,
					}),
				);

				return { id: created.id };
			});

			const get = (user: CurrentUserValue, integrationId: IntegrationId) =>
				requireIntegration(user.id, integrationId);

			const list = (
				user: CurrentUserValue,
				query: { provider?: CreateIntegrationBody["provider"]; isDisabled?: boolean },
			) => runWithDb(repository.listForUser({ userId: user.id, ...query }));

			const update = Effect.fn("IntegrationsService.update")(function* (
				user: CurrentUserValue,
				integrationId: IntegrationId,
				body: UpdateIntegrationBody,
			) {
				const existing = yield* requireIntegration(user.id, integrationId);

				let providerSpecifics: IntegrationProviderSpecifics = existing.providerSpecifics;
				if (body.providerSpecifics !== undefined) {
					providerSpecifics = yield* decodeIntegrationProviderSpecifics({
						...existing.providerSpecifics,
						...body.providerSpecifics,
					}).pipe(
						Effect.mapError((error) =>
							badRequest(`Invalid providerSpecifics after merge: ${error.message}`),
						),
					);
					if (providerSpecifics.kind !== existing.provider) {
						return yield* badRequest("providerSpecifics.kind must match provider");
					}
				}

				const minimumProgress = body.minimumProgress ?? existing.minimumProgress;
				const maximumProgress = body.maximumProgress ?? existing.maximumProgress;
				const thresholdError = validateProgressThresholds(minimumProgress, maximumProgress);
				if (thresholdError) {
					return yield* badRequest(thresholdError);
				}

				const updated = yield* runWithDb(
					repository.updateForUser({
						integrationId,
						name: body.name,
						userId: user.id,
						providerSpecifics,
						isDisabled: body.isDisabled,
						extraSettings: body.extraSettings,
						syncOwnership: body.syncOwnership,
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
				rawBody?: string;
				contentType?: string;
				integrationId: IntegrationId;
			}) {
				const { integrationId, rawBody, contentType } = input;
				const integration = yield* runWithDb(repository.getByIdAnyUser({ integrationId }));
				if (!integration) {
					return yield* notFound("Integration not found");
				}
				if (integration.lot !== "sink") {
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

				const started = yield* engine
					.execute(ProcessIntegrationRunWorkflow, {
						discard: true,
						executionId: run.id,
						payload: {
							runId: run.id,
							userId: integration.userId,
							integrationId: integration.id,
							...(rawBody !== undefined ? { rawBody } : {}),
							...(contentType !== undefined ? { contentType } : {}),
						},
					})
					.pipe(Effect.either);

				if (Either.isLeft(started)) {
					yield* failCreatedRun(run.id, "Failed to enqueue integration job");
					return yield* badRequest("Could not queue the integration job; please try again");
				}

				return { runId: run.id };
			});

			const reconcileScheduledYankRuns = Effect.fn(
				"IntegrationsService.reconcileScheduledYankRuns",
			)(function* () {
				const integrations = yield* runWithDb(repository.listEnabledYankIntegrations());

				yield* Effect.forEach(
					integrations,
					(integration) =>
						Effect.gen(function* () {
							const disableIntegrations = yield* runWithDb(
								repository.getUserDisableIntegrations({ userId: integration.userId }),
							);
							if (disableIntegrations) {
								return;
							}

							const hasActiveRun = yield* importsService.hasActiveRunForIntegration({
								integrationId: integration.id,
							});
							if (hasActiveRun) {
								return;
							}

							yield* enqueueIntegrationRun(integration).pipe(
								Effect.catchTag("BadRequest", () => Effect.void),
								Effect.asVoid,
							);
						}),
					{ discard: true },
				);
			});

			return {
				get,
				list,
				create,
				update,
				listRuns,
				handleWebhook,
				delete: deleteIntegration,
				reconcileScheduledYankRuns,
			};
		}),
	},
) {}
