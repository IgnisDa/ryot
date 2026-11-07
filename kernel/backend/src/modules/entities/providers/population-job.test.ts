import { expect } from "bun:test";

import { SandboxRunError } from "@ryot-app/contract/errors";
import type { ListedEntity } from "@ryot-app/contract/modules/entities/schemas";
import {
	definitionOwner,
	definitionOwnerPluginId,
} from "@ryot-app/contract/modules/plugins/references";
import {
	AutomationExecutionId,
	AutomationTriggerId,
	EntityId,
	EntitySchemaSlug,
	PluginId,
	RelationshipSchemaSlug,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { IsoUtcString } from "@ryot-app/contract/schema/utils";
import { assert } from "@ryot-app/testing/assert";
import { randomUuid } from "@ryot-app/testing/random";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { layer } from "@voila.dev/effect-bun-test";
import { Context, DateTime, Effect, Layer, Ref, Schema } from "effect";

import { planFixture } from "#modules/automations/lifecycle.test-support";
import { rootLifecycleCommand } from "#modules/automations/lifecycle/command";
import { LifecycleExecution } from "#modules/automations/lifecycle/execution";
import {
	type LifecyclePlan,
	toLifecycleDispatchPlan,
} from "#modules/automations/lifecycle/planning";
import type { EntityRelationshipDefinitions } from "#modules/definitions/snapshot";
import { EnrichmentRequestsRepository } from "#modules/entities/enrichment/repository";
import { EnrichmentRequests } from "#modules/entities/enrichment/requests";
import { TranslationsService } from "#modules/entities/localization/service";
import { EntitiesRepository } from "#modules/entities/repository";
import { EntitiesService } from "#modules/entities/service";
import { DomainWriteChecksLive } from "#modules/entities/write-context";
import { PluginRuntimeResolver } from "#modules/plugins/catalog/runtime-resolver";
import { PluginInstallationRepository } from "#modules/plugins/installations/repository";
import {
	installRevisionPackage,
	revisionDatabaseLayer,
	revisionPackage,
} from "#modules/plugins/packages/revision.test-support";
import { RelationshipsRepository } from "#modules/relationships/repository";
import { RelationshipsService } from "#modules/relationships/service";
import { ScriptExecutionPrincipal } from "#modules/scripts/authorization/principal";
import { ScriptExecutionService } from "#modules/scripts/executions/service";
import { SandboxRepository } from "#modules/scripts/registry/repository";
import { DatabaseSession } from "#platform/db/session";
import * as tables from "#schema/tables/combined";
import { workflowAccountsTestLayer } from "#testing/effect";

import { RecordedLogAnnotations, recordLogAnnotationsLayer } from "./log-annotations.test-support";
import { EntityImportWorkflowOperations } from "./operations-workflow";
import {
	EntityPopulationJob,
	type PopulationWritePayload,
	runEntityPopulationJob,
	runPopulationAttempt,
} from "./population-job";

const now = IsoUtcString.make("2026-09-17T00:00:00.000Z");
const userId = UserId.make("population-user");
const rootSchemaSlug = EntitySchemaSlug.make("record");
const childSchemaSlug = EntitySchemaSlug.make("part");
const relationshipSchemaSlug = RelationshipSchemaSlug.make("record-part");
const relatedSchemaSlug = EntitySchemaSlug.make("person");

const command = {
	...rootLifecycleCommand({
		occurredAt: now,
		lane: "background",
		accountUserId: userId,
		source: "provider-refresh",
		itemIdentity: "population",
		initiator: { id: userId, kind: "user" },
		executionId: AutomationExecutionId.make("population-execution"),
	}),
	writeContext: null,
};

const entityDefinition = (slug: string) => ({ slug, pluginId: null });

const definitions = {
	entitySchemas: {
		[rootSchemaSlug]: entityDefinition(rootSchemaSlug),
		[childSchemaSlug]: entityDefinition(childSchemaSlug),
		[relatedSchemaSlug]: entityDefinition(relatedSchemaSlug),
	},
	relationshipSchemas: {
		credits: {
			pluginId: null,
			slug: "credits",
			name: "Credits",
			propertiesSchema: { fields: {} },
			sourceEntitySchemaSlug: rootSchemaSlug,
			targetEntitySchemaSlug: relatedSchemaSlug,
		},
		[relationshipSchemaSlug]: {
			name: "Parts",
			pluginId: null,
			slug: relationshipSchemaSlug,
			propertiesSchema: { fields: {} },
			sourceEntitySchemaSlug: rootSchemaSlug,
			targetEntitySchemaSlug: childSchemaSlug,
		},
	},
} satisfies EntityRelationshipDefinitions;

const listedEntity = (
	input: Parameters<EntitiesService["Service"]["persistPlannedProviderUpsert"]>[0],
): ListedEntity => ({
	createdAt: now,
	updatedAt: now,
	properties: {},
	name: "Record",
	populatedAt: now,
	providerId: input.providerId,
	externalId: input.externalId,
	id: EntityId.make(input.externalId),
	entitySchemaSlug: input.entitySchema.slug,
	entitySchemaPluginId: definitionOwnerPluginId(input.entitySchema.owner),
});

const payloadFields = {
	level: "full" as const,
	externalId: "record-1",
	mode: "refresh" as const,
	entitySchemaSlug: rootSchemaSlug,
	executionId: "population-workflow",
	entityScope: { userId, type: "global" as const },
};

const sandboxResult = {
	logs: [],
	error: null,
	status: "completed" as const,
	value: {
		name: "Record",
		properties: {},
		childEntities: [
			{ name: "Part", properties: {}, externalId: "part-1", entitySchemaSlug: childSchemaSlug },
		],
		relatedEntityGroups: [
			{
				direction: "outgoing" as const,
				coverage: { status: "complete" },
				relationshipSchemaSlug: "credits",
				synchronization: "additive" as const,
				entities: [{ name: "Person", externalId: "person-1", providerSlug: "person.provider" }],
			},
		],
	},
};

type DispatchedPlans = Parameters<LifecycleExecution["Service"]["dispatch"]>[0];

class FakePopulationWrites extends Context.Service<
	FakePopulationWrites,
	{
		readonly payload: PopulationWritePayload;
		readonly recorded: Effect.Effect<ReadonlyArray<string>>;
	}
>()(
	"@ryot-app/kernel-backend/modules/entities/providers/population-job.test/FakePopulationWrites",
) {}

const populationLayer = (options: {
	readonly rootPlans?: ReadonlyArray<LifecyclePlan>;
	readonly dispatch: (plans: DispatchedPlans) => {
		readonly entry: string;
		readonly warnings: Effect.Success<ReturnType<LifecycleExecution["Service"]["dispatch"]>>;
	};
}) =>
	Layer.unwrap(
		Effect.gen(function* () {
			const session = yield* DatabaseSession;
			yield* session.run((db) =>
				db
					.insert(tables.user)
					.values({ id: userId, name: "Population", email: "population@example.test" }),
			);
			const source = revisionPackage("population", "v1", rootSchemaSlug);
			const details = source.scripts.find(
				({ metadata }) => metadata.kind === "provider" && metadata.providerOperation === "details",
			);
			assert(details?.metadata.kind === "provider");
			const relatedScript = {
				...details,
				slug: "person.details",
				contentHash: "person-details",
				entry: "backend/person-details.sandbox.ts",
				metadata: { ...details.metadata, slug: "person.details", providerSlug: "person.provider" },
			};
			const installed = yield* installRevisionPackage({
				...source,
				scripts: [...source.scripts, relatedScript],
				manifest: {
					...source.manifest,
					scripts: [
						...source.manifest.scripts,
						{ ...relatedScript.metadata, entry: relatedScript.entry },
					],
					relationshipSchemas: Object.values(definitions.relationshipSchemas).map(
						({ pluginId: _owner, ...definition }) => definition,
					),
					entitySchemas: Object.values(definitions.entitySchemas).map(({ slug }) => ({
						slug,
						name: slug,
						icon: "box",
						eventSchemas: [],
						propertiesSchema: { fields: {} },
					})),
					providers: [
						...source.manifest.providers,
						{
							name: "Person",
							slug: "person.provider",
							information: { source: "fixture" },
							rootEntitySchemaSlug: relatedSchemaSlug,
						},
					],
				},
			});
			yield* (yield* PluginInstallationRepository).upsertState({
				userId,
				config: {},
				sortOrder: 0,
				health: "ready",
				isHidden: false,
				pluginId: installed.pluginId,
			});
			const runtime = yield* PluginRuntimeResolver;
			const provider = yield* runtime.findProviderAvailableToUserByReference(userId, {
				slug: "population-provider",
				owner: definitionOwner(installed.pluginId),
			});
			assert(provider);
			const script = yield* runtime.resolveUserDetailsScript(userId, provider.id);
			const subject = { userId, type: "user" as const };
			const pin = yield* (yield* SandboxRepository.make).getScriptPin(
				script.id,
				undefined,
				subject,
			);
			assert(pin?.pluginRevision);
			const principal = yield* Schema.decodeEffect(ScriptExecutionPrincipal)({ ...pin, subject });
			const payload: PopulationWritePayload = {
				requestAttempt: 1,
				...payloadFields,
				providerId: provider.id,
				requestId: payloadFields.executionId,
				pluginId: PluginId.make(installed.pluginId),
				command: { ...command, writeContext: principal },
			};
			const recorded = yield* Ref.make<ReadonlyArray<string>>([]);
			const record = (entry: string) => Ref.update(recorded, (all) => [...all, entry]);
			const upsertItem = (
				input: Parameters<EntitiesService["Service"]["persistPlannedProviderUpsert"]>[0],
			) => {
				const kind = input.populatedAt === null ? "upsert" : "write";
				const label = input.externalId === payload.externalId ? `root-${kind}` : "child-entity";
				const entity = listedEntity(input);
				return record(label).pipe(
					Effect.as({
						result: { entity },
						dispatch:
							label === "root-upsert"
								? (options.rootPlans ?? [planFixture("root-upsert")]).map(toLifecycleDispatchPlan)
								: [toLifecycleDispatchPlan(planFixture(label))],
					}),
				);
			};
			return Layer.mergeAll(
				workflowAccountsTestLayer,
				Layer.mock(EnrichmentRequests)({
					attachEntity: () => Effect.void,
					guardPopulation: () => Effect.void,
					recordBaseCheck: () => Effect.void,
					requesterIds: () => Effect.succeed([]),
				}),
				Layer.mock(TranslationsService)({ requestFill: () => Effect.succeed(false) }),
				Layer.mock(ScriptExecutionService)({ releaseWorkflowRegistration: () => Effect.void }),
				Layer.succeed(PluginRuntimeResolver, runtime),
				DomainWriteChecksLive,
				Layer.mock(EntitiesRepository)({
					lockMutationKeys: () => Effect.void,
					invalidateRelatedPopulated: () => Effect.void,
					stampChildRelatedPopulated: () => Effect.void,
					findPopulationTarget: () => Effect.succeed(null),
					stampRelatedPopulated: () => record("related-stamp"),
					holdsRelatedPopulationGeneration: () => Effect.succeed(true),
				}),
				Layer.mock(EntitiesService)({
					persistPlannedProviderUpsert: upsertItem,
					persistPlannedProviderUpserts: (input) =>
						Effect.forEach(input.items, upsertItem).pipe(
							Effect.map((works) => ({
								results: works.map(({ result }) => result),
								dispatch: [
									...works.flatMap(({ dispatch }) => dispatch),
									toLifecycleDispatchPlan(planFixture("entities-batch")),
								],
							})),
						),
				}),
				Layer.mock(RelationshipsRepository)({
					listRelationshipsForReconciliation: () => Effect.succeed([]),
				}),
				Layer.mock(RelationshipsService)({
					persistPlannedReconciliation: (_groups, _command, _scope) =>
						record("relationships").pipe(
							Effect.as({
								result: [{ created: 1, updated: 0, deleted: 0, upserted: 1 }],
								dispatch: [toLifecycleDispatchPlan(planFixture("relationships"))],
							}),
						),
				}),
				Layer.mock(EntityImportWorkflowOperations)({
					completeProviderEntityImport: () => Effect.void,
					processProviderResolve: () => Effect.die("unexpected provider resolve"),
					processSandbox: (_payload, _executionId, level) =>
						record(`details:${level}`).pipe(Effect.as(sandboxResult)),
				}),
				Layer.succeed(LifecycleExecution, {
					after: () => Effect.die("unexpected after"),
					executePolicy: () => Effect.die("unexpected policy"),
					skipQueuedPolicies: () => Effect.die("unexpected policy skip"),
					executeBatchPolicy: () => Effect.die("Unexpected batch policy"),
					dispatch: (plans) => {
						const { entry, warnings } = options.dispatch(plans);
						return record(entry).pipe(Effect.as(warnings));
					},
				}),
				Layer.succeed(FakePopulationWrites, { payload, recorded: Ref.get(recorded) }),
			);
		}),
	).pipe(Layer.provideMerge(revisionDatabaseLayer));

const blocked = {
	omittedHooks: [],
	hasRequiredHooks: true,
	code: "automation-limit-reached" as const,
};

layer(
	Layer.merge(
		recordLogAnnotationsLayer("automation warnings"),
		populationLayer({
			dispatch: (plans) => ({
				entry: `dispatch:${plans.map(({ triggerId }) => triggerId).join(",")}`,
				warnings: plans.some(({ triggerId }) => triggerId === "root-upsert")
					? [{ ...blocked, triggerId: AutomationTriggerId.make("root-upsert") }]
					: [],
			}),
		}),
	),
)((test) => {
	test.effect(
		"dispatches each population write between activities and logs blocked hooks",
		() =>
			Effect.gen(function* () {
				const payload = (yield* FakePopulationWrites).payload;

				return yield* runPopulationAttempt(payload, payload.executionId).pipe(
					Effect.tap(() =>
						Effect.gen(function* () {
							expect(yield* (yield* FakePopulationWrites).recorded).toEqual([
								"details:full",
								"root-upsert",
								"dispatch:root-upsert",
								"child-entity",
								"relationships",
								"dispatch:child-entity,entities-batch,relationships",
								"root-write",
								"dispatch:root-write",
								"child-entity",
								"relationships",
								"dispatch:child-entity,entities-batch,relationships",
								"related-stamp",
							]);
							const warningLogs = yield* (yield* RecordedLogAnnotations).annotations;
							expect(warningLogs.map((annotations) => annotations["phase"])).toEqual([
								"root-upsert",
							]);
						}),
					),
					Effect.asVoid,
				);
			}),
		testTimeout,
	);
});

layer(populationLayer({ dispatch: () => ({ warnings: [], entry: "dispatch" }) }))((test) => {
	test.effect(
		"rejects a root schema that does not belong to its exact provider",
		() =>
			Effect.gen(function* () {
				const payload = (yield* FakePopulationWrites).payload;
				const executionId = "population-missing-root-schema";
				const error = yield* Effect.flip(
					runPopulationAttempt(
						{ ...payload, executionId, entitySchemaSlug: childSchemaSlug },
						executionId,
					),
				);
				expect(error.message).toBe("Provider root schema does not match its exact owner");
			}),
		testTimeout,
	);
});

layer(populationLayer({ dispatch: () => ({ warnings: [], entry: "dispatch" }) }))((test) => {
	test.effect(
		"persists the root and children at base level, ignores returned related groups, and stamps only populated_at",
		() =>
			Effect.gen(function* () {
				const payload = { ...(yield* FakePopulationWrites).payload, level: "base" as const };
				yield* runPopulationAttempt(payload, payload.executionId);
				expect(yield* (yield* FakePopulationWrites).recorded).toEqual([
					"details:base",
					"root-upsert",
					"dispatch",
					"child-entity",
					"relationships",
					"dispatch",
					"root-write",
					"dispatch",
				]);
			}),
		testTimeout,
	);
});

const existingRequestFixture = Effect.fnUntraced(function* (
	populatedAt: ListedEntity["populatedAt"],
) {
	const original = (yield* FakePopulationWrites).payload;
	const executionId = `${original.executionId}-${populatedAt === null ? "stub" : "ready"}-${yield* randomUuid}`;
	const payload: PopulationWritePayload = {
		...original,
		executionId,
		level: "base",
		mode: "ensure",
		requestId: executionId,
		externalId: executionId,
	};
	const stub = {
		populatedAt,
		properties: {},
		createdAt: now,
		updatedAt: now,
		name: "Existing",
		externalId: payload.externalId,
		providerId: payload.providerId,
		entitySchemaPluginId: payload.pluginId,
		id: EntityId.make(`${executionId}-entity`),
		entitySchemaSlug: payload.entitySchemaSlug,
	} satisfies ListedEntity;
	const session = yield* DatabaseSession;
	yield* session.run((db) =>
		db
			.insert(tables.entity)
			.values({
				id: stub.id,
				name: stub.name,
				externalId: stub.externalId,
				providerId: stub.providerId,
				entitySchemaSlug: stub.entitySchemaSlug,
				entitySchemaPluginId: stub.entitySchemaPluginId,
				populatedAt:
					populatedAt === null ? null : DateTime.toDateUtc(DateTime.makeUnsafe(populatedAt)),
			}),
	);
	const requestsRepository = yield* EnrichmentRequestsRepository.make;
	const requests = yield* EnrichmentRequests.make.pipe(
		Effect.provideService(EnrichmentRequestsRepository, requestsRepository),
	);
	yield* requests.ensure({
		payload,
		level: "base",
		entityId: null,
		language: null,
		id: executionId,
		scopeUserId: null,
		operation: "population",
		pluginId: payload.pluginId,
		externalId: payload.externalId,
		providerId: payload.providerId,
		requester: payload.command.accountUserId,
		entitySchemaSlug: payload.entitySchemaSlug,
	});
	const repository = yield* EntitiesRepository;
	return {
		stub,
		payload,
		requests,
		repository: {
			...repository,
			findPopulationTarget: () =>
				Effect.succeed({ entity: stub, relatedPopulated: populatedAt !== null }),
		},
	};
});

layer(populationLayer({ dispatch: () => ({ warnings: [], entry: "dispatch" }) }))((test) => {
	test.effect(
		"attaches an existing stub before details fail so exact-entity retry lookup finds the request",
		() =>
			Effect.gen(function* () {
				const fixture = yield* existingRequestFixture(null);
				const operations = yield* EntityImportWorkflowOperations;
				const failure = new SandboxRunError({ kind: "script-failure", message: "Details failed" });
				yield* runEntityPopulationJob(
					{ requestId: fixture.payload.requestId },
					{ attempt: 1, id: "job-1" },
				).pipe(
					Effect.provideService(EnrichmentRequests, fixture.requests),
					Effect.provideService(EntitiesRepository, fixture.repository),
					Effect.provideService(EntityImportWorkflowOperations, {
						...operations,
						processSandbox: () =>
							fixture.requests.get(fixture.payload.requestId).pipe(
								Effect.orDie,
								Effect.tap((row) => Effect.sync(() => expect(row?.entityId).toBe(fixture.stub.id))),
								Effect.andThen(Effect.fail(failure)),
							),
					}),
				);
				const requester = fixture.payload.command.accountUserId;
				assert(requester);
				expect(
					yield* fixture.requests.latest({
						requester,
						operation: "population",
						entityId: fixture.stub.id,
					}),
				).toMatchObject({
					state: "failed",
					entityId: fixture.stub.id,
					id: fixture.payload.requestId,
					failureKind: "script-failure",
				});
			}),
		testTimeout,
	);

	test.effect(
		"attaches an existing entity before returning its cached population",
		() =>
			Effect.gen(function* () {
				const fixture = yield* existingRequestFixture(now);
				expect(
					yield* runPopulationAttempt(fixture.payload, fixture.payload.executionId).pipe(
						Effect.provideService(EnrichmentRequests, fixture.requests),
						Effect.provideService(EntitiesRepository, fixture.repository),
					),
				).toEqual(fixture.stub);
				expect(yield* fixture.requests.get(fixture.payload.requestId)).toMatchObject({
					entityId: fixture.stub.id,
				});
				expect(yield* (yield* FakePopulationWrites).recorded).toEqual([]);
			}),
		testTimeout,
	);
});

const runFailing = (
	fixture: Effect.Success<ReturnType<typeof existingRequestFixture>>,
	failure: SandboxRunError,
	attempt: number,
) =>
	Effect.flatMap(EntityImportWorkflowOperations, (operations) =>
		runEntityPopulationJob({ requestId: fixture.payload.requestId }, { attempt, id: "job-1" }).pipe(
			Effect.provideService(EnrichmentRequests, fixture.requests),
			Effect.provideService(EntitiesRepository, fixture.repository),
			Effect.provideService(EntityImportWorkflowOperations, {
				...operations,
				processSandbox: () => Effect.fail(failure),
			}),
		),
	);

layer(populationLayer({ dispatch: () => ({ warnings: [], entry: "dispatch" }) }))((test) => {
	test.effect(
		"leaves infrastructure and timeout failures to the job's next attempt, then settles as failed",
		() =>
			Effect.gen(function* () {
				const fixture = yield* existingRequestFixture(null);
				const infrastructure = new SandboxRunError({
					kind: "infrastructure",
					message: "Daemon unavailable",
				});
				const timeout = new SandboxRunError({ kind: "timeout", message: "Timed out" });
				const read = fixture.requests.get(fixture.payload.requestId);

				expect(yield* Effect.flip(runFailing(fixture, infrastructure, 1))).toEqual(infrastructure);
				expect(yield* read).toMatchObject({
					attempt: 1,
					state: "retrying",
					failureKind: "infrastructure",
				});
				expect(yield* Effect.flip(runFailing(fixture, timeout, 2))).toEqual(timeout);
				expect(yield* read).toMatchObject({
					attempt: 2,
					state: "retrying",
					failureKind: "timeout",
				});

				yield* runFailing(fixture, infrastructure, EntityPopulationJob.maxAttempts);
				expect(yield* read).toMatchObject({
					state: "failed",
					failureKind: "infrastructure",
					attempt: EntityPopulationJob.maxAttempts,
				});
			}),
		testTimeout,
	);

	test.effect(
		"never retries boundary failures, external uncertainty, or unknown script errors",
		() =>
			Effect.forEach(
				[
					new SandboxRunError({ kind: "script-failure", message: "Unknown provider error" }),
					new SandboxRunError({ kind: "invalid-output", message: "Invalid provider response" }),
					new SandboxRunError({ kind: "external-uncertain", message: "Unknown external outcome" }),
					new SandboxRunError({
						message: "Budget exceeded",
						kind: "resource-unavailable",
						data: { operation: "httpCall", code: "execution-limit" },
					}),
					new SandboxRunError({
						kind: "infrastructure",
						message: "Unavailable boundary",
						data: { operation: "httpCall", code: "unavailable-operation" },
					}),
					new SandboxRunError({
						kind: "timeout",
						message: "Boundary timeout",
						data: { code: "operation-rejected" },
					}),
				],
				(failure) =>
					Effect.gen(function* () {
						const fixture = yield* existingRequestFixture(null);
						yield* runFailing(fixture, failure, 1);
						expect(yield* fixture.requests.get(fixture.payload.requestId)).toMatchObject({
							attempt: 1,
							state: "failed",
							failureKind: failure.kind,
						});
					}),
				{ discard: true },
			),
		testTimeout,
	);

	test.effect(
		"skips a settled request",
		() =>
			Effect.gen(function* () {
				const fixture = yield* existingRequestFixture(null);
				const requestId = fixture.payload.requestId;
				yield* fixture.requests.update(requestId, { state: "cancelled" });
				yield* runFailing(
					fixture,
					new SandboxRunError({ kind: "infrastructure", message: "Must not run" }),
					1,
				);
				expect(yield* fixture.requests.get(requestId)).toMatchObject({ state: "cancelled" });
			}),
		testTimeout,
	);
});
