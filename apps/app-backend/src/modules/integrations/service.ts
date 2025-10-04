import { WorkflowEngine } from "@effect/workflow/WorkflowEngine";
import { DateTime, Effect, Either, Schema } from "effect";

import type { CurrentUserValue } from "~/lib/auth";
import { DbRunner } from "~/lib/db";
import { type BadRequest, type DbError, type NotFound, badRequest, notFound } from "~/lib/errors";
import { ImportsRepository } from "~/modules/imports/repository";
import type { ListedImportRun } from "~/modules/imports/schemas";

import { IntegrationsRepository, type IntegrationRecord } from "./repository";
import type {
	CreateIntegrationBody,
	IntegrationExtraSettings,
	IntegrationProviderSpecifics,
	ListedIntegration,
	UpdateIntegrationBody,
} from "./schemas";
import { IntegrationProviderSpecifics as IntegrationProviderSpecificsSchema } from "./schemas";
import { providerLotByProvider } from "./types";
import { ProcessIntegrationRunWorkflow } from "./workflows";

const defaultExtraSettings = {
	disableOnContinuousErrors: false,
} satisfies IntegrationExtraSettings;

const resolvedVoid = Promise.resolve();

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

type AutoDisableDeps = {
	readonly disableIntegration: (input: { userId: string; integrationId: string }) => Promise<void>;
	readonly getIntegration: (input: {
		userId: string;
		integrationId: string;
	}) => Promise<ListedIntegration | null>;
	readonly listRecentStatuses: (input: {
		limit: number;
		integrationId: string;
	}) => Promise<ReadonlyArray<{ readonly status: string }>>;
};

export const createCheckAndAutoDisable =
	(deps: AutoDisableDeps) => (input: { integrationId: string; userId: string }) =>
		deps.getIntegration(input).then((integration) => {
			if (!integration || !integration.extraSettings.disableOnContinuousErrors) {
				return resolvedVoid;
			}

			return deps
				.listRecentStatuses({ integrationId: input.integrationId, limit: 5 })
				.then((lastRuns) => {
					if (lastRuns.length < 5 || lastRuns.some((run) => run.status !== "failed")) {
						return resolvedVoid;
					}

					return deps.disableIntegration(input);
				});
		});

type IntegrationsServiceShape = {
	readonly reconcileScheduledYankRuns: () => Effect.Effect<void, DbError>;
	readonly create: (
		user: CurrentUserValue,
		body: CreateIntegrationBody,
	) => Effect.Effect<{ id: string }, BadRequest | DbError>;
	readonly get: (
		user: CurrentUserValue,
		integrationId: string,
	) => Effect.Effect<ListedIntegration, NotFound | DbError>;
	readonly list: (
		user: CurrentUserValue,
		query: { provider?: CreateIntegrationBody["provider"]; isDisabled?: boolean },
	) => Effect.Effect<readonly ListedIntegration[], DbError>;
	readonly update: (
		user: CurrentUserValue,
		integrationId: string,
		body: UpdateIntegrationBody,
	) => Effect.Effect<ListedIntegration, BadRequest | NotFound | DbError>;
	readonly delete: (
		user: CurrentUserValue,
		integrationId: string,
	) => Effect.Effect<{ id: string }, NotFound | DbError>;
	readonly listRuns: (
		user: CurrentUserValue,
		integrationId: string,
	) => Effect.Effect<readonly ListedImportRun[], NotFound | DbError>;
	readonly handleWebhook: (input: {
		rawBody?: string;
		contentType?: string;
		integrationId: string;
	}) => Effect.Effect<{ runId: string }, BadRequest | NotFound | DbError>;
};

export class IntegrationsService extends Effect.Service<IntegrationsService>()(
	"IntegrationsService",
	{
		effect: Effect.gen(function* () {
			const runWithDb = yield* DbRunner;
			const engine = yield* WorkflowEngine;
			const repository = yield* IntegrationsRepository;
			const importsRepository = yield* ImportsRepository;

			const failCreatedRun = (runId: string, message: string) =>
				Effect.gen(function* () {
					const finishedAt = yield* DateTime.nowAsDate;
					yield* runWithDb(
						importsRepository.updateRun({
							runId,
							finishedAt,
							status: "failed",
							errorSummary: message,
						}),
					);
					yield* runWithDb(
						importsRepository.createFailure({
							runId,
							message,
							itemIndex: 0,
							stage: "source_fetch",
						}),
					);
				});

			const requireIntegration = (userId: string, integrationId: string) =>
				Effect.gen(function* () {
					const integration = yield* runWithDb(repository.getForUser({ userId, integrationId }));
					if (!integration) {
						return yield* notFound("Integration not found");
					}
					return integration;
				});

			const enqueueIntegrationRun = (integration: IntegrationRecord, payload?: unknown) =>
				Effect.gen(function* () {
					const run = yield* runWithDb(
						importsRepository.createRun({
							userId: integration.userId,
							source: integration.provider,
							integrationId: integration.id,
							inputSummary: buildIntegrationInputSummary(integration),
						}),
					);

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
				});

			return {
				create: (user, body) =>
					Effect.gen(function* () {
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
					}),
				get: (user, integrationId) => requireIntegration(user.id, integrationId),
				list: (user, query) => runWithDb(repository.listForUser({ userId: user.id, ...query })),
				update: (user, integrationId, body) =>
					Effect.gen(function* () {
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
					}),
				delete: (user, integrationId) =>
					Effect.gen(function* () {
						yield* requireIntegration(user.id, integrationId);
						yield* runWithDb(repository.deleteForUser({ userId: user.id, integrationId }));
						return { id: integrationId };
					}),
				listRuns: (user, integrationId) =>
					Effect.gen(function* () {
						yield* requireIntegration(user.id, integrationId);
						return yield* runWithDb(
							importsRepository.listRunsByIntegrationId({ userId: user.id, integrationId }),
						);
					}),
				handleWebhook: ({ integrationId, rawBody, contentType }) =>
					Effect.gen(function* () {
						const integration = yield* runWithDb(repository.getByIdAnyUser({ integrationId }));
						if (!integration) {
							return yield* notFound("Integration not found");
						}
						if (integration.lot !== "sink") {
							return yield* badRequest("Integration is not a sink integration");
						}

						const run = yield* runWithDb(
							importsRepository.createRun({
								userId: integration.userId,
								source: integration.provider,
								integrationId: integration.id,
								inputSummary: buildIntegrationInputSummary(integration),
							}),
						);

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
					}),
				reconcileScheduledYankRuns: () =>
					Effect.gen(function* () {
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

									const hasActiveRun = yield* runWithDb(
										importsRepository.hasActiveRunForIntegration({ integrationId: integration.id }),
									);
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
					}),
			} satisfies IntegrationsServiceShape;
		}),
	},
) {}
