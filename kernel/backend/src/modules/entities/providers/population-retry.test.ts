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
	type SandboxProviderId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { assertExitFails } from "@ryot-app/testing/effect-assertions";
import { eq } from "drizzle-orm";
import { Context, Effect, Layer, Ref } from "effect";
import { WorkflowEngine } from "effect/workflow/WorkflowEngine";

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
import * as tables from "#schema/tables/combined";
import { makeAppConfigLayer, makeWorkflowEngine } from "#testing/effect";

import { EntityPopulationRetryService } from "./population-retry";
import { EntityPopulationTriggerLive } from "./population-trigger-live";

const rootSchemaSlug = EntitySchemaSlug.make("record");
const failedAt = new Date("2026-10-23T00:00:00.000Z");
const relatedFailedAt = new Date("2026-10-23T01:00:00.000Z");
const populatedAt = new Date("2026-10-22T00:00:00.000Z");

const currentUser = (id: string): CurrentUserValue => ({
	image: null,
	name: "Retry User",
	id: UserId.make(id),
	email: `${id}@example.test`,
	preferences: { language: null, disableIntegrations: false },
	accountGeneration: { userId: UserId.make(id), token: "test-account-generation" },
});

const owner = currentUser("owner");
const recipient = currentUser("recipient");

type SeedInput = {
	readonly externalId: string;
	readonly failed?: boolean;
	readonly relatedFailed?: boolean;
	readonly relatedPopulated?: boolean;
	readonly userId?: UserId;
	readonly providerBacked?: boolean;
};

class RetryFixture extends Context.Service<
	RetryFixture,
	{
		readonly pluginId: PluginId;
		readonly runs: Effect.Effect<ReadonlyArray<string>>;
		readonly seed: (input: SeedInput) => Effect.Effect<EntityId>;
		readonly failure: (
			entityId: EntityId,
		) => Effect.Effect<{
			readonly populationFailure: string | null;
			readonly populationFailedAt: Date | null;
			readonly relatedPopulationFailure: string | null;
			readonly relatedPopulationFailedAt: Date | null;
		}>;
		readonly markFailed: (entityId: EntityId) => Effect.Effect<void>;
		readonly reconcilerRequest: (entityId: EntityId, externalId: string) => Effect.Effect<void>;
	}
>()("test/PopulationRetryFixture") {}

const retryLayer = Layer.unwrap(
	Effect.gen(function* () {
		const session = yield* DatabaseSession;
		const installed = yield* installRevisionPackage(revisionPackage("retry", "v1", rootSchemaSlug));
		const runtime = yield* PluginRuntimeResolver;
		const provider = yield* runtime.findProviderAvailableToUserByReference(owner.id, {
			slug: "retry-provider",
			owner: definitionOwner(installed.pluginId),
		});
		assert(provider);
		const providerId: SandboxProviderId = provider.id;
		const runs = yield* Ref.make<ReadonlyArray<string>>([]);
		const engine = makeWorkflowEngine({
			execute: (_workflow, input) =>
				Ref.update(runs, (all) =>
					all.includes(input.executionId) ? all : [...all, input.executionId],
				),
		});
		const markFailed = (entityId: EntityId) =>
			session
				.run((db) =>
					db
						.update(tables.entity)
						.set({ populationFailedAt: failedAt, populationFailure: "script-failure" })
						.where(eq(tables.entity.id, entityId)),
				)
				.pipe(Effect.asVoid, Effect.orDie);
		const fixture = (trigger: EntityPopulationTrigger["Service"]) =>
			RetryFixture.of({
				markFailed,
				runs: Ref.get(runs),
				pluginId: PluginId.make(installed.pluginId),
				reconcilerRequest: (entityId, externalId) =>
					userPopulationRequest({
						entityId,
						providerId,
						externalId,
						userId: null,
						initiator: owner.id,
						execution: { level: "full" },
						entitySchemaSlug: rootSchemaSlug,
						entitySchemaPluginId: installed.pluginId,
						accountGeneration: owner.accountGeneration,
					}).pipe(Effect.flatMap(trigger.request), Effect.asVoid),
				failure: (entityId) =>
					session
						.run((db) =>
							db
								.select({
									populationFailure: tables.entity.populationFailure,
									populationFailedAt: tables.entity.populationFailedAt,
									relatedPopulationFailure: tables.entity.relatedPopulationFailure,
									relatedPopulationFailedAt: tables.entity.relatedPopulationFailedAt,
								})
								.from(tables.entity)
								.where(eq(tables.entity.id, entityId)),
						)
						.pipe(
							Effect.flatMap(([row]) => (row ? Effect.succeed(row) : Effect.die("missing row"))),
							Effect.orDie,
						),
				seed: ({
					userId,
					externalId,
					failed = true,
					providerBacked = true,
					relatedFailed = false,
					relatedPopulated = false,
				}) =>
					session
						.run((db) =>
							db
								.insert(tables.entity)
								.values({
									name: externalId,
									userId: userId ?? null,
									entitySchemaSlug: rootSchemaSlug,
									entitySchemaPluginId: installed.pluginId,
									...(providerBacked ? { externalId, providerId } : {}),
									...(failed
										? { populationFailedAt: failedAt, populationFailure: "script-failure" }
										: {}),
									...(relatedFailed || relatedPopulated ? { populatedAt } : {}),
									...(relatedPopulated ? { relatedPopulatedAt: populatedAt } : {}),
									...(relatedFailed
										? {
												relatedPopulationFailedAt: relatedFailedAt,
												relatedPopulationFailure: "invalid-output",
											}
										: {}),
								})
								.returning({ id: tables.entity.id }),
						)
						.pipe(
							Effect.map(([row]) => EntityId.make(row?.id ?? "")),
							Effect.orDie,
						),
			});
		const triggerLayer = EntityPopulationTriggerLive.pipe(
			Layer.provide(Layer.merge(ScriptExecutionServiceLive, DomainWriteChecksLive)),
		);
		return Layer.merge(
			EntityPopulationRetryService.layer,
			Layer.effect(
				RetryFixture,
				Effect.gen(function* () {
					return fixture(yield* EntityPopulationTrigger);
				}),
			),
		).pipe(
			Layer.provideMerge(triggerLayer),
			Layer.provideMerge(EntitiesRepository.layer),
			Layer.provideMerge(Layer.succeed(WorkflowEngine, engine)),
		);
	}),
).pipe(Layer.provideMerge(revisionDatabaseLayer), Layer.provide(makeAppConfigLayer()));

const retry = (user: CurrentUserValue, entityId: EntityId, pluginId: PluginId) =>
	Effect.gen(function* () {
		return yield* (yield* EntityPopulationRetryService).retry({ user, entityId, pluginId });
	});

const refused = (code: EntityPopulationRetryRefused["reason"]["code"]) =>
	new EntityPopulationRetryRefused({ reason: { code } });

const notFound = (entityId: EntityId) =>
	new EntityNotFound({ reason: { entityId, code: "entity-not-found" } });

layer(retryLayer)((test) => {
	test.effect("reruns a failed population under the same account generation", () =>
		Effect.gen(function* () {
			const fixture = yield* RetryFixture;
			const entityId = yield* fixture.seed({ failed: false, externalId: "rerun" });
			yield* fixture.reconcilerRequest(entityId, "rerun");
			yield* fixture.markFailed(entityId);
			yield* fixture.reconcilerRequest(entityId, "rerun");
			expect(yield* fixture.runs).toEqual([`populate-${entityId}-full-test-account-generation`]);

			expect(yield* retry(owner, entityId, fixture.pluginId)).toEqual({ retried: true });

			expect(yield* fixture.runs).toEqual([
				`populate-${entityId}-full-test-account-generation`,
				`populate-${entityId}-full-test-account-generation-${failedAt.getTime()}`,
			]);
			expect(yield* fixture.failure(entityId)).toEqual({
				populationFailure: null,
				populationFailedAt: null,
				relatedPopulationFailure: null,
				relatedPopulationFailedAt: null,
			});
		}),
	);

	test.effect("retries a related-level failure at full with the related failure time", () =>
		Effect.gen(function* () {
			const fixture = yield* RetryFixture;
			const entityId = yield* fixture.seed({
				failed: false,
				relatedFailed: true,
				externalId: "related-rerun",
			});

			expect(yield* retry(owner, entityId, fixture.pluginId)).toEqual({ retried: true });
			expect(yield* retry(owner, entityId, fixture.pluginId)).toEqual({ retried: false });

			expect((yield* fixture.runs).filter((run) => run.includes(entityId))).toEqual([
				`populate-${entityId}-full-test-account-generation-${relatedFailedAt.getTime()}`,
			]);
			expect(yield* fixture.failure(entityId)).toEqual({
				populationFailure: null,
				populationFailedAt: null,
				relatedPopulationFailure: null,
				relatedPopulationFailedAt: null,
			});
		}),
	);

	test.effect("never clears a related failure once the related level is stamped", () =>
		Effect.gen(function* () {
			const fixture = yield* RetryFixture;
			const entityId = yield* fixture.seed({
				failed: false,
				relatedFailed: true,
				relatedPopulated: true,
				externalId: "related-stamped",
			});
			const before = yield* fixture.runs;

			expect(yield* retry(owner, entityId, fixture.pluginId)).toEqual({ retried: false });
			expect(yield* fixture.runs).toEqual(before);
			expect(yield* fixture.failure(entityId)).toEqual({
				populationFailure: null,
				populationFailedAt: null,
				relatedPopulationFailure: "invalid-output",
				relatedPopulationFailedAt: relatedFailedAt,
			});
		}),
	);

	test.effect("retries a failure at most once until it fails again", () =>
		Effect.gen(function* () {
			const fixture = yield* RetryFixture;
			const entityId = yield* fixture.seed({ externalId: "once" });
			const before = (yield* fixture.runs).length;

			expect(yield* retry(owner, entityId, fixture.pluginId)).toEqual({ retried: true });
			expect(yield* retry(owner, entityId, fixture.pluginId)).toEqual({ retried: false });

			expect((yield* fixture.runs).length).toBe(before + 1);
		}),
	);

	test.effect("is a no-op for an entity that has not failed", () =>
		Effect.gen(function* () {
			const fixture = yield* RetryFixture;
			const entityId = yield* fixture.seed({ failed: false, externalId: "not-failed" });
			const before = yield* fixture.runs;

			expect(yield* retry(owner, entityId, fixture.pluginId)).toEqual({ retried: false });
			expect(yield* fixture.runs).toEqual(before);
		}),
	);

	test.effect("retries the caller's own private entity", () =>
		Effect.gen(function* () {
			const fixture = yield* RetryFixture;
			const entityId = yield* fixture.seed({ userId: owner.id, externalId: "private" });

			expect(yield* retry(owner, entityId, fixture.pluginId)).toEqual({ retried: true });
		}),
	);

	test.effect("answers missing and invisible entities with the same not-found", () =>
		Effect.gen(function* () {
			const fixture = yield* RetryFixture;
			const missing = EntityId.make("missing-entity");
			const invisible = yield* fixture.seed({ userId: owner.id, externalId: "invisible" });
			const invisibleLocal = yield* fixture.seed({
				userId: owner.id,
				providerBacked: false,
				externalId: "invisible-local",
			});

			assertExitFails(
				yield* Effect.exit(retry(recipient, missing, fixture.pluginId)),
				notFound(missing),
			);
			assertExitFails(
				yield* Effect.exit(retry(recipient, invisible, fixture.pluginId)),
				notFound(invisible),
			);
			assertExitFails(
				yield* Effect.exit(retry(recipient, invisibleLocal, fixture.pluginId)),
				notFound(invisibleLocal),
			);
			expect((yield* fixture.failure(invisible)).populationFailure).toBe("script-failure");
		}),
	);

	test.effect("refuses visible entities without a provider", () =>
		Effect.gen(function* () {
			const fixture = yield* RetryFixture;
			const entityId = yield* fixture.seed({
				userId: owner.id,
				externalId: "local",
				providerBacked: false,
			});

			assertExitFails(
				yield* Effect.exit(retry(owner, entityId, fixture.pluginId)),
				refused("not-provider-backed"),
			);
		}),
	);

	test.effect("refuses a plugin that does not own the entity", () =>
		Effect.gen(function* () {
			const fixture = yield* RetryFixture;
			const entityId = yield* fixture.seed({ externalId: "mismatch" });

			assertExitFails(
				yield* Effect.exit(retry(owner, entityId, PluginId.make("other-plugin"))),
				refused("plugin-mismatch"),
			);
			expect((yield* fixture.failure(entityId)).populationFailure).toBe("script-failure");
		}),
	);

	test.effect("refuses a global entity whose provider the caller cannot run", () =>
		Effect.gen(function* () {
			const fixture = yield* RetryFixture;
			const entityId = yield* fixture.seed({ externalId: "unavailable" });
			const runtime = yield* PluginRuntimeResolver;
			const before = yield* fixture.runs;

			assertExitFails(
				yield* Effect.exit(retry(recipient, entityId, fixture.pluginId)),
				refused("provider-unavailable"),
			);
			expect(yield* fixture.failure(entityId)).toMatchObject({
				populationFailedAt: failedAt,
				populationFailure: "script-failure",
			});
			expect(yield* fixture.runs).toEqual(before);
			const entity = yield* (yield* EntitiesRepository).getById(entityId);
			assert(entity?.providerId);
			expect(
				yield* runtime.findProviderAvailableToUser(recipient.id, entity.providerId),
			).toBeNull();
		}),
	);
});
