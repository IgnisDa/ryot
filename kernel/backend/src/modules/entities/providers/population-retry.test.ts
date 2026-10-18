import { assert, expect, layer } from "@effect/vitest";
import type { CurrentUserValue } from "@ryot-app/contract/auth-middleware";
import {
	EntityNotFound,
	EntityPopulationRetryRefused,
} from "@ryot-app/contract/modules/entities/schemas";
import { definitionOwner } from "@ryot-app/contract/modules/plugins/references";
import {
	EntityId,
	EntitySchemaSlug,
	PluginId,
	SandboxProviderId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { assertExitFails } from "@ryot-app/testing/effect-assertions";
import { Context, Effect, Layer, Ref } from "effect";
import { WorkflowEngine } from "effect/workflow/WorkflowEngine";

import { EnrichmentRequests } from "#modules/entities/enrichment/requests";
import { type RequestFillInput, TranslationsService } from "#modules/entities/localization/service";
import {
	EntityPopulationTrigger,
	userPopulationRequest,
} from "#modules/entities/population-trigger";
import { EntitiesRepository } from "#modules/entities/repository";
import { DomainWriteChecksLive } from "#modules/entities/write-context";
import { PluginRuntimeResolver } from "#modules/plugins/catalog/runtime-resolver";
import {
	installRevisionPackage,
	revisionDatabaseLayer,
	revisionPackage,
} from "#modules/plugins/packages/revision.test-support";
import { ScriptExecutionServiceLive } from "#modules/scripts/layer";
import { DatabaseSession } from "#platform/db/session";
import { RedisService } from "#platform/redis";
import * as tables from "#schema/tables/combined";
import { makeAppConfigLayer, makeRedisService, makeWorkflowEngine } from "#testing/effect";

import { EntityPopulationRetryService } from "./population-retry";
import { EntityPopulationTriggerLive } from "./population-trigger-live";

const rootSchemaSlug = EntitySchemaSlug.make("record");
const populatedAt = new Date("2026-10-22T00:00:00.000Z");
const currentUser = (id: string): CurrentUserValue => ({
	image: null,
	name: "Retry User",
	id: UserId.make(id),
	email: `${id}@example.test`,
	preferences: { language: "es", disableIntegrations: false },
	accountGeneration: { userId: UserId.make(id), token: "test-account-generation" },
});
const owner = currentUser("owner");
const recipient = currentUser("recipient");

type SeedInput = {
	readonly externalId: string;
	readonly failed?: boolean;
	readonly relatedPopulated?: boolean;
	readonly basePopulated?: boolean;
	readonly userId?: UserId;
	readonly providerBacked?: boolean;
	readonly operation?: "population" | "translation";
	readonly state?: "failed" | "cancelled" | "succeeded";
	readonly level?: "base" | "full";
};
type RequestRow = Effect.Success<ReturnType<EnrichmentRequests["Service"]["get"]>>;

class RetryFixture extends Context.Service<
	RetryFixture,
	{
		readonly pluginId: PluginId;
		readonly runs: Effect.Effect<ReadonlyArray<string>>;
		readonly translations: Effect.Effect<ReadonlyArray<RequestFillInput>>;
		readonly seed: (input: SeedInput) => Effect.Effect<EntityId>;
		readonly latest: (
			entityId: EntityId,
			user?: CurrentUserValue,
			operation?: "population" | "translation",
			level?: "base" | "full",
		) => Effect.Effect<RequestRow>;
		readonly markFailed: (entityId: EntityId) => Effect.Effect<void>;
		readonly reconcilerRequest: (entityId: EntityId, externalId: string) => Effect.Effect<void>;
	}
>()("test/PopulationRetryFixture") {}

const retryLayer = (pluginOwner: UserId | null = null) =>
	Layer.unwrap(
		Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const requests = yield* EnrichmentRequests;
			const installed = yield* installRevisionPackage(
				revisionPackage("retry", "one", rootSchemaSlug),
				pluginOwner,
			);
			const provider = yield* (yield* PluginRuntimeResolver).findProviderAvailableToUserByReference(
				owner.id,
				{ slug: "retry-provider", owner: definitionOwner(installed.pluginId) },
			);
			assert(provider);
			const providerId = provider.id;
			const runs = yield* Ref.make<ReadonlyArray<string>>([]);
			const translations = yield* Ref.make<ReadonlyArray<RequestFillInput>>([]);
			const latest = (
				entityId: EntityId,
				user = owner,
				operation: "population" | "translation" = "population",
				level?: "base" | "full",
			) =>
				requests
					.latest({
						entityId,
						operation,
						requester: user.accountGeneration,
						...(level ? { level } : {}),
						...(operation === "translation" ? { language: "es" } : {}),
					})
					.pipe(Effect.orDie);
			const fixture = (trigger: EntityPopulationTrigger["Service"]) =>
				RetryFixture.of({
					latest,
					runs: Ref.get(runs),
					translations: Ref.get(translations),
					pluginId: PluginId.make(installed.pluginId),
					markFailed: (entityId) =>
						Effect.gen(function* () {
							const row = yield* latest(entityId);
							assert(row);
							yield* requests.update(row.id, { state: "failed", failureKind: "script-failure" });
						}).pipe(Effect.orDie),
					reconcilerRequest: (entityId, externalId) =>
						userPopulationRequest({
							entityId,
							externalId,
							providerId,
							userId: null,
							initiator: owner.id,
							execution: { level: "full" },
							entitySchemaSlug: rootSchemaSlug,
							entitySchemaPluginId: installed.pluginId,
							accountGeneration: owner.accountGeneration,
						}).pipe(Effect.flatMap(trigger.request), Effect.asVoid),
					seed: (input) =>
						Effect.gen(function* () {
							const [row] = yield* session.run((db) =>
								db
									.insert(tables.entity)
									.values({
										name: input.externalId,
										userId: input.userId ?? null,
										entitySchemaSlug: rootSchemaSlug,
										entitySchemaPluginId: installed.pluginId,
										...(input.providerBacked === false
											? {}
											: { providerId, externalId: input.externalId }),
										...(input.basePopulated || input.relatedPopulated ? { populatedAt } : {}),
										...(input.relatedPopulated ? { relatedPopulatedAt: populatedAt } : {}),
									})
									.returning({ id: tables.entity.id }),
							);
							assert(row);
							const entityId = EntityId.make(row.id);
							if (input.failed !== false) {
								const translation = input.operation === "translation";
								const request = yield* requests.ensure({
									entityId,
									providerId,
									payload: {},
									id: `initial-${entityId}`,
									sourceContentGeneration: 1,
									externalId: input.externalId,
									pluginId: installed.pluginId,
									entitySchemaSlug: rootSchemaSlug,
									scopeUserId: input.userId ?? null,
									requester: owner.accountGeneration,
									language: translation ? "es" : null,
									workflowName: "TestEnrichmentWorkflow",
									operation: input.operation ?? "population",
									level: translation ? null : (input.level ?? "full"),
								});
								yield* requests.update(request.id, {
									failureKind: "script-failure",
									state: input.state ?? "failed",
								});
							}
							return entityId;
						}).pipe(Effect.orDie),
				});
			const translationLayer = Layer.mock(TranslationsService)({
				requestFill: (input) =>
					Effect.gen(function* () {
						yield* Ref.update(translations, (all) => [...all, input]);
						const id = `translation-retry-${input.entityId}`;
						const admitted = yield* requests.ensure({
							id,
							providerId,
							level: null,
							payload: input,
							scopeUserId: null,
							entityId: input.entityId,
							operation: "translation",
							language: input.language,
							sourceContentGeneration: 1,
							externalId: input.externalId,
							pluginId: installed.pluginId,
							entitySchemaSlug: rootSchemaSlug,
							requester: input.accountGeneration,
							workflowName: "TestTranslationWorkflow",
							...(input.retryOf ? { retryOf: input.retryOf } : {}),
						});
						return admitted.id === id;
					}),
			});
			return Layer.merge(
				EntityPopulationRetryService.layer,
				Layer.effect(RetryFixture, Effect.map(EntityPopulationTrigger, fixture)),
			).pipe(
				Layer.provideMerge(
					EntityPopulationTriggerLive.pipe(
						Layer.provide(Layer.merge(ScriptExecutionServiceLive, DomainWriteChecksLive)),
					),
				),
				Layer.provideMerge(EntitiesRepository.layer),
				Layer.provide(translationLayer),
				Layer.provide(
					Layer.succeed(
						WorkflowEngine,
						makeWorkflowEngine({
							execute: (_workflow, input) =>
								Ref.update(runs, (all) =>
									all.includes(input.executionId) ? all : [...all, input.executionId],
								),
						}),
					),
				),
			);
		}),
	).pipe(
		Layer.provideMerge(EnrichmentRequests.layer),
		Layer.provide(
			Layer.succeed(RedisService, makeRedisService({ publish: () => Effect.succeed(1) })),
		),
		Layer.provideMerge(revisionDatabaseLayer),
		Layer.provide(makeAppConfigLayer()),
	);

const retry = (
	user: CurrentUserValue,
	entityId: EntityId,
	pluginId: PluginId,
	operation: "population" | "translation" = "population",
) =>
	Effect.flatMap(EntityPopulationRetryService, (service) =>
		service.retry({ user, entityId, pluginId, operation }),
	);
const refused = (code: EntityPopulationRetryRefused["reason"]["code"]) =>
	new EntityPopulationRetryRefused({ reason: { code } });
const notFound = (entityId: EntityId) =>
	new EntityNotFound({ reason: { entityId, code: "entity-not-found" } });

layer(retryLayer())((test) => {
	test.effect(
		"creates one full retry under the caller's generation and preserves the failed request",
		() =>
			Effect.gen(function* () {
				const fixture = yield* RetryFixture;
				const entityId = yield* fixture.seed({ failed: false, externalId: "rerun" });
				yield* fixture.reconcilerRequest(entityId, "rerun");
				yield* fixture.markFailed(entityId);
				const failed = yield* fixture.latest(entityId);
				assert(failed);
				yield* fixture.reconcilerRequest(entityId, "rerun");
				expect((yield* fixture.runs).filter((id) => id.includes(entityId))).toEqual([
					`enrich-populate-${entityId}-full-test-account-generation`,
				]);
				expect(yield* retry(owner, entityId, fixture.pluginId)).toEqual({ retried: true });
				expect(yield* retry(owner, entityId, fixture.pluginId)).toEqual({ retried: false });
				const admitted = yield* fixture.latest(entityId);
				expect(admitted).toMatchObject({
					level: "full",
					state: "queued",
					retryOf: failed.id,
					requesterGeneration: owner.accountGeneration.token,
				});
				expect(admitted?.id).toMatch(
					new RegExp(`^enrich-populate-${entityId}-full-test-account-generation-.+$`),
				);
				expect(yield* (yield* EnrichmentRequests).get(failed.id)).toEqual(failed);
			}),
	);

	test.effect("retries failures at full even when base and related data are already cached", () =>
		Effect.gen(function* () {
			const fixture = yield* RetryFixture;
			for (const input of [
				{ level: "base" as const, externalId: "base-failed" },
				{ basePopulated: true, externalId: "related-failed" },
				{ relatedPopulated: true, externalId: "cached-failed" },
			]) {
				const entityId = yield* fixture.seed(input);
				expect(yield* retry(owner, entityId, fixture.pluginId)).toEqual({ retried: true });
				expect(yield* fixture.latest(entityId)).toMatchObject({
					level: "full",
					state: "queued",
					retryOf: `initial-${entityId}`,
				});
			}
		}),
	);

	test.effect("retries a failed full request when a newer base request succeeded", () =>
		Effect.gen(function* () {
			const fixture = yield* RetryFixture;
			const entityId = yield* fixture.seed({
				basePopulated: true,
				externalId: "full-failure-base-success",
			});
			const failedFull = yield* fixture.latest(entityId);
			assert(failedFull);
			assert(failedFull.sourceContentGeneration !== null);
			const requests = yield* EnrichmentRequests;
			const baseSuccess = yield* requests.ensure({
				entityId,
				payload: {},
				level: "base",
				language: null,
				operation: "population",
				pluginId: failedFull.pluginId,
				id: `base-success-${entityId}`,
				externalId: failedFull.externalId,
				requester: owner.accountGeneration,
				workflowName: "TestEnrichmentWorkflow",
				entitySchemaSlug: failedFull.entitySchemaSlug,
				providerId: SandboxProviderId.make(failedFull.providerId),
				sourceContentGeneration: failedFull.sourceContentGeneration,
				scopeUserId: failedFull.scopeUserId === null ? null : UserId.make(failedFull.scopeUserId),
			});
			yield* requests.update(baseSuccess.id, { state: "succeeded" });
			expect(yield* fixture.latest(entityId)).toMatchObject({
				level: "base",
				id: baseSuccess.id,
				state: "succeeded",
			});

			expect(yield* retry(owner, entityId, fixture.pluginId)).toEqual({ retried: true });
			expect(yield* retry(owner, entityId, fixture.pluginId)).toEqual({ retried: false });
			expect(yield* fixture.latest(entityId, owner, "population", "full")).toMatchObject({
				level: "full",
				state: "queued",
				retryOf: failedFull.id,
			});
		}),
	);

	test.effect("retries a cancelled request but not missing or successful work", () =>
		Effect.gen(function* () {
			const fixture = yield* RetryFixture;
			const cancelled = yield* fixture.seed({ state: "cancelled", externalId: "cancelled" });
			expect(yield* retry(owner, cancelled, fixture.pluginId)).toEqual({ retried: true });
			for (const input of [
				{ failed: false, externalId: "not-failed" },
				{ externalId: "succeeded", state: "succeeded" as const },
			]) {
				const entityId = yield* fixture.seed(input);
				const before = yield* fixture.runs;
				expect(yield* retry(owner, entityId, fixture.pluginId)).toEqual({ retried: false });
				expect(yield* fixture.runs).toEqual(before);
			}
		}),
	);

	test.effect("does not retry another account generation's failure", () =>
		Effect.gen(function* () {
			const fixture = yield* RetryFixture;
			const entityId = yield* fixture.seed({ externalId: "previous-generation" });
			const reset = {
				...owner,
				accountGeneration: { userId: owner.id, token: "reset-generation" },
			};
			expect(yield* retry(reset, entityId, fixture.pluginId)).toEqual({ retried: false });
			expect(yield* fixture.latest(entityId)).toMatchObject({ state: "failed" });
		}),
	);

	test.effect(
		"retries only the requested operation and passes the failed translation identity",
		() =>
			Effect.gen(function* () {
				const fixture = yield* RetryFixture;
				const entityId = yield* fixture.seed({
					basePopulated: true,
					operation: "translation",
					externalId: "translation",
				});
				expect(yield* retry(owner, entityId, fixture.pluginId)).toEqual({ retried: false });
				expect(yield* retry(owner, entityId, fixture.pluginId, "translation")).toEqual({
					retried: true,
				});
				expect(yield* retry(owner, entityId, fixture.pluginId, "translation")).toEqual({
					retried: false,
				});
				expect(yield* fixture.translations).toMatchObject([
					{
						entityId,
						language: "es",
						userId: owner.id,
						lane: "interactive",
						retryOf: `initial-${entityId}`,
					},
				]);
			}),
	);

	test.effect("answers missing and invisible entities with the same not-found", () =>
		Effect.gen(function* () {
			const fixture = yield* RetryFixture;
			for (const entityId of [
				EntityId.make("missing-entity"),
				yield* fixture.seed({ userId: owner.id, externalId: "invisible" }),
				yield* fixture.seed({
					userId: owner.id,
					providerBacked: false,
					externalId: "invisible-local",
				}),
			]) {
				assertExitFails(
					yield* Effect.exit(retry(recipient, entityId, fixture.pluginId)),
					notFound(entityId),
				);
			}
		}),
	);

	test.effect("refuses local entities and a plugin that does not own the entity", () =>
		Effect.gen(function* () {
			const fixture = yield* RetryFixture;
			const local = yield* fixture.seed({
				userId: owner.id,
				externalId: "local",
				providerBacked: false,
			});
			assertExitFails(
				yield* Effect.exit(retry(owner, local, fixture.pluginId)),
				refused("not-provider-backed"),
			);
			const mismatch = yield* fixture.seed({ externalId: "mismatch" });
			assertExitFails(
				yield* Effect.exit(retry(owner, mismatch, PluginId.make("other-plugin"))),
				refused("plugin-mismatch"),
			);
			expect(yield* fixture.latest(mismatch)).toMatchObject({ state: "failed" });
		}),
	);

	test.effect(
		"refuses shared work when the caller cannot run its provider without altering another user's failure",
		() =>
			Effect.gen(function* () {
				const fixture = yield* RetryFixture;
				const entityId = yield* fixture.seed({ externalId: "unavailable" });
				const before = yield* fixture.runs;
				assertExitFails(
					yield* Effect.exit(retry(recipient, entityId, fixture.pluginId)),
					refused("provider-unavailable"),
				);
				expect(yield* fixture.latest(entityId)).toMatchObject({
					state: "failed",
					failureKind: "script-failure",
				});
				expect(yield* fixture.latest(entityId, recipient)).toBeNull();
				expect(yield* fixture.runs).toEqual(before);
			}),
	);
});

layer(retryLayer(owner.id))((test) => {
	test.effect("retries the caller's private entity with private scope", () =>
		Effect.gen(function* () {
			const fixture = yield* RetryFixture;
			const entityId = yield* fixture.seed({ userId: owner.id, externalId: "private" });
			expect(yield* retry(owner, entityId, fixture.pluginId)).toEqual({ retried: true });
			expect(yield* fixture.latest(entityId)).toMatchObject({ scopeUserId: owner.id });
		}),
	);
});
