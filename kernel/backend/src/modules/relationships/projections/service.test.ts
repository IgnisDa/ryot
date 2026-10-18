import { assert, expect, layer } from "@effect/vitest";
import { DbError } from "@ryot-app/contract/errors";
import type { PluginManifest } from "@ryot-app/contract/modules/plugins/manifest";
import { RelationshipProjectionStepInput } from "@ryot-app/contract/modules/relationships/projections";
import {
	AutomationExecutionId,
	EntityId,
	PluginId,
	RelationshipSchemaSlug,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { emptySandboxExecutionMetadata } from "@ryot-app/contract/testing";
import { assertExitFails } from "@ryot-app/testing/effect-assertions";
import { eq } from "drizzle-orm";
import { Context, Effect, Layer, Ref, Schema } from "effect";
import { WorkflowEngine, WorkflowInstance } from "effect/workflow/WorkflowEngine";

import { rootLifecycleCommand } from "#modules/automations/lifecycle/command";
import { ProjectionBindings } from "#modules/background-work/model";
import { BackgroundWorkService, BackgroundWorkWorkflow } from "#modules/background-work/service";
import { RelationshipSchemaReaderLive } from "#modules/definitions/layer";
import { DomainWriteChecksLive } from "#modules/entities/write-context";
import { PluginRuntimeResolver } from "#modules/plugins/catalog/runtime-resolver";
import {
	installRevisionPackage,
	revisionDatabaseLayer,
} from "#modules/plugins/packages/revision.test-support";
import type { NormalizedPlugin } from "#modules/plugins/packages/types";
import { fixtureManifest } from "#modules/plugins/test-support";
import {
	ScriptExecutionPrincipal,
	type ScriptPluginRevision,
} from "#modules/scripts/authorization/principal";
import { SandboxRepository } from "#modules/scripts/registry/repository";
import { DatabaseSession } from "#platform/db/session";
import { RedisService } from "#platform/redis";
import { WorkflowExecutionNotifications } from "#platform/workflow/execution-notifications";
import * as tables from "#schema/tables/combined";
import {
	makeAppConfigLayer,
	makeRedisService,
	makeWorkflowActivityEngine,
	makeWorkflowEngine,
} from "#testing/effect";

import { RelationshipProjectionRepository, relationshipProjectionWorkId } from "./repository";
import { RelationshipProjectionService } from "./service";

const userId = UserId.make("owner");
const accountToken = "test-account-generation";
const entitySchemaSlug = "fixture-record";
const relationshipSchemaSlug = RelationshipSchemaSlug.make("fixture-link");
const processorScriptSlug = "relationship-fixture-processor";
const relationshipSchema: PluginManifest["relationshipSchemas"][number] = {
	name: "Fixture link",
	slug: relationshipSchemaSlug,
	sourceEntitySchemaSlug: null,
	targetEntitySchemaSlug: null,
	propertiesSchema: { fields: {} },
	projection: {
		scriptSlug: processorScriptSlug,
		propertiesSchema: {
			unknownKeys: "strict",
			fields: { score: { type: "number", label: "Score", description: "Computed score" } },
		},
	},
};

const fixturePackage = (): NormalizedPlugin => {
	const fixture = fixtureManifest();
	const [entitySchema] = fixture.entitySchemas;
	assert(entitySchema);
	const script = {
		...emptySandboxExecutionMetadata,
		name: "Processor",
		kind: "script" as const,
		slug: processorScriptSlug,
	};
	const entry = "backend/processor.sandbox.ts";
	return {
		contentHash: "relationship-projection-fixture-source",
		scripts: [
			{
				entry,
				metadata: script,
				name: script.name,
				slug: script.slug,
				compiledFormat: 1,
				compiledCode: "processor",
				contentHash: "processor-hash",
			},
		],
		manifest: {
			...fixture,
			hooks: [],
			workflows: [],
			providers: [],
			signalSchemas: [],
			scripts: [{ ...script, entry }],
			relationshipSchemas: [relationshipSchema],
			entitySchemas: [
				{ ...entitySchema, eventSchemas: [], slug: entitySchemaSlug, name: "Fixture record" },
			],
		},
	};
};

type ProjectionBinding = NonNullable<
	Effect.Success<ReturnType<ProjectionBindings["Service"]["resolve"]>>
>;

class ProjectionControls extends Context.Service<
	ProjectionControls,
	{ hints: Effect.Effect<ReadonlyArray<string>> }
>()("test/ProjectionControls") {}

class ProjectionFixture extends Context.Service<
	ProjectionFixture,
	{
		pluginId: PluginId;
		pluginPin: ScriptPluginRevision;
		principal: ScriptExecutionPrincipal;
		accountGeneration: { token: string; userId: UserId };
	}
>()("test/ProjectionFixture") {}

const fixtureLayer = Layer.effect(
	ProjectionFixture,
	Effect.gen(function* () {
		const installed = yield* installRevisionPackage(fixturePackage(), null);
		const pluginId = PluginId.make(installed.pluginId);
		const script = yield* (yield* PluginRuntimeResolver).findScriptAvailableToUser(
			userId,
			pluginId,
			processorScriptSlug,
		);
		assert(script);
		const subject = {
			userId,
			type: "user" as const,
			accountGeneration: { userId, token: accountToken },
		};
		const pin = yield* (yield* SandboxRepository).getScriptPin(script.id, undefined, subject);
		assert(pin?.pluginRevision);
		const principal = yield* Schema.decodeEffect(ScriptExecutionPrincipal)({ ...pin, subject });
		return {
			pluginId,
			principal,
			pluginPin: pin.pluginRevision,
			accountGeneration: { userId, token: accountToken },
		};
	}),
).pipe(Layer.provideMerge(revisionDatabaseLayer));

const testLayer = Layer.unwrap(
	Effect.gen(function* () {
		const hints = yield* Ref.make<ReadonlyArray<string>>([]);
		const engineLayer = Layer.succeed(
			WorkflowEngine,
			makeWorkflowEngine({ execute: (_workflow, options) => Effect.succeed(options.executionId) }),
		);
		const shared = Layer.mergeAll(
			fixtureLayer,
			engineLayer,
			WorkflowExecutionNotifications.layer,
			makeAppConfigLayer(),
		);
		const bindingsLayer = Layer.unwrap(
			Effect.gen(function* () {
				const fixture = yield* ProjectionFixture;
				const binding: ProjectionBinding = {
					principal: fixture.principal,
					pluginPin: fixture.pluginPin,
					accountGeneration: fixture.accountGeneration,
				};
				return Layer.merge(
					Layer.succeed(ProjectionBindings, { resolve: () => Effect.succeed(binding) }),
					Layer.succeed(ProjectionControls, { hints: Ref.get(hints) }),
				);
			}),
		).pipe(Layer.provide(fixtureLayer));
		const redisLayer = Layer.succeed(
			RedisService,
			makeRedisService({
				publish: (_channel, message) =>
					Ref.update(hints, (all) => [...all, message]).pipe(Effect.as(0)),
			}),
		);
		const dependencies = Layer.mergeAll(
			shared,
			bindingsLayer,
			redisLayer,
			RelationshipProjectionRepository.layer.pipe(Layer.provide(shared)),
			BackgroundWorkService.layer.pipe(Layer.provide(shared)),
			DomainWriteChecksLive.pipe(Layer.provide(shared)),
			RelationshipSchemaReaderLive.pipe(Layer.provide(shared)),
		);
		return RelationshipProjectionService.layer.pipe(Layer.provideMerge(dependencies));
	}),
);

const command = (id: string, writeContext: ScriptExecutionPrincipal) => ({
	...rootLifecycleCommand({
		source: "api",
		itemIdentity: id,
		lane: "interactive",
		occurredAt: "2026-10-05T00:00:00.000Z",
		initiator: { id: userId, kind: "user" },
		accountGeneration: { userId, token: accountToken },
		executionId: AutomationExecutionId.make(`relationship-projection-${id}`),
	}),
	writeContext,
});

const seedLinks = (suffix: string, count: number) =>
	Effect.gen(function* () {
		const fixture = yield* ProjectionFixture;
		const session = yield* DatabaseSession;
		const target = EntityId.make(`${suffix}-target`);
		const sources = Array.from({ length: count }, (_, index) =>
			EntityId.make(`${suffix}-source-${index}`),
		);
		yield* session.transaction(
			Effect.gen(function* () {
				yield* session.run((db) =>
					db
						.insert(tables.entity)
						.values(
							[target, ...sources].map((id) => ({
								id,
								userId,
								properties: {},
								entitySchemaSlug,
								name: "Fixture record",
								entitySchemaPluginId: fixture.pluginId,
							})),
						),
				);
				yield* session.run((db) =>
					db
						.insert(tables.relationship)
						.values(
							sources.map((sourceEntityId) => ({
								userId,
								sourceEntityId,
								targetEntityId: target,
								relationshipSchemaSlug,
								id: `${sourceEntityId}-link`,
								relationshipSchemaPluginId: fixture.pluginId,
							})),
						),
				);
			}),
		);
		return { fixture, sources };
	});

const request = (suffix: string, sourceEntityIds: ReadonlyArray<EntityId>) =>
	Effect.gen(function* () {
		const fixture = yield* ProjectionFixture;
		return yield* (yield* RelationshipProjectionService).request({
			pluginPin: fixture.pluginPin,
			accountGeneration: fixture.accountGeneration,
			request: { sourceEntityIds, relationshipSchemaSlug },
			command: command(`request-${suffix}`, fixture.principal),
		});
	});

const startCurrent = (workId: string) =>
	Effect.gen(function* () {
		const work = yield* (yield* RelationshipProjectionRepository).get(workId);
		assert(work?.currentJobId);
		const job = yield* (yield* BackgroundWorkService).start(work.currentJobId);
		assert(job);
		return {
			job,
			input: yield* Schema.decodeUnknownEffect(RelationshipProjectionStepInput)(
				job.execution.input,
			),
		};
	});

const publish = (
	job: Parameters<RelationshipProjectionService["Service"]["process"]>[0],
	output: unknown,
) =>
	Effect.gen(function* () {
		const instance = WorkflowInstance.initial(BackgroundWorkWorkflow, job.id);
		return yield* (yield* RelationshipProjectionService)
			.process(job, output)
			.pipe(
				Effect.provideService(WorkflowInstance, instance),
				Effect.provideService(WorkflowEngine, makeWorkflowActivityEngine(instance)),
			);
	});

const scoreAll = (input: typeof RelationshipProjectionStepInput.Type, score: number) => ({
	updates: input.relationships.map(({ relationshipId }) => ({
		relationshipId,
		properties: { score },
	})),
});

const notes = (workId: string) =>
	Effect.gen(function* () {
		const session = yield* DatabaseSession;
		return yield* session.run((db) =>
			db
				.select({
					revision: tables.relationshipProjection.revision,
					properties: tables.relationshipProjection.properties,
					relationshipId: tables.relationshipProjection.relationshipId,
					projectedRevision: tables.relationshipProjection.projectedRevision,
				})
				.from(tables.relationshipProjection)
				.where(eq(tables.relationshipProjection.workId, workId))
				.orderBy(tables.relationshipProjection.relationshipId),
		);
	});

const jobStatus = (id: string) =>
	Effect.gen(function* () {
		const session = yield* DatabaseSession;
		const [job] = yield* session.run((db) =>
			db
				.select({ status: tables.backgroundWork.status })
				.from(tables.backgroundWork)
				.where(eq(tables.backgroundWork.id, id)),
		);
		return job?.status ?? null;
	});

layer(testLayer)((test) => {
	test.effect("projects requested relationships and publishes refresh hints", () =>
		Effect.gen(function* () {
			const { sources, fixture } = yield* seedLinks("requested", 2);
			const [first, second] = sources;
			assert(first && second);
			const workId = yield* request("requested", [first]);
			expect(workId).toBe(
				relationshipProjectionWorkId({
					userId,
					relationshipSchemaSlug,
					relationshipSchemaPluginId: fixture.pluginId,
				}),
			);
			const { job, input } = yield* startCurrent(workId);
			expect(job.purpose).toBe("relationship-projection");
			expect(job.execution.subject.type).toBe("projection");
			expect(input).toEqual({
				relationshipSchemaSlug,
				relationships: [
					{
						sourceEntityId: first,
						relationshipId: `${first}-link`,
						targetEntityId: "requested-target",
					},
				],
			});

			yield* publish(job, scoreAll(input, 7));

			expect(yield* notes(workId)).toEqual([
				{
					revision: 1,
					projectedRevision: 1,
					properties: { score: 7 },
					relationshipId: `${first}-link`,
				},
			]);
			expect(yield* jobStatus(job.id)).toBe("succeeded");
			expect(
				(yield* (yield* RelationshipProjectionRepository).get(workId))?.currentJobId,
			).toBeNull();
			expect((yield* (yield* ProjectionControls).hints).some((hint) => hint.includes(first))).toBe(
				true,
			);
		}),
	);
});

layer(testLayer)((test) => {
	test.effect("keeps a note pending when its source changes during processing", () =>
		Effect.gen(function* () {
			const { sources } = yield* seedLinks("stale", 1);
			const [source] = sources;
			assert(source);
			const workId = yield* request("stale-first", [source]);
			const { job, input } = yield* startCurrent(workId);
			yield* request("stale-second", [source]);

			yield* publish(job, scoreAll(input, 3));

			const [note] = yield* notes(workId);
			expect(note?.revision).toBe(2);
			expect(note?.projectedRevision).toBeNull();
			const next = yield* (yield* RelationshipProjectionRepository).get(workId);
			assert(next?.currentJobId);
			expect(next.currentJobId).not.toBe(job.id);
			expect(next.status).toBe("queued");
		}),
	);
});

layer(testLayer)((test) => {
	test.effect("rejects output that does not cover its claim exactly", () =>
		Effect.gen(function* () {
			const { sources } = yield* seedLinks("coverage", 1);
			const [source] = sources;
			assert(source);
			const workId = yield* request("coverage", [source]);
			const { job } = yield* startCurrent(workId);
			assertExitFails(
				yield* Effect.exit(publish(job, { updates: [] })),
				new DbError({
					message: "Relationship projection processor must return each claimed relationship once",
				}),
			);
			assertExitFails(
				yield* Effect.exit(
					publish(job, {
						updates: [{ properties: { score: "high" }, relationshipId: `${source}-link` }],
					}),
				),
				new DbError({ message: "Projection output does not match its declared schema" }),
			);
		}),
	);
});

layer(testLayer)((test) => {
	test.effect("re-projects every note after the processor binding changes", () =>
		Effect.gen(function* () {
			const { sources, fixture } = yield* seedLinks("rebind", 2);
			const workId = yield* request("rebind", sources);
			const repository = yield* RelationshipProjectionRepository;
			const work = yield* repository.get(workId);
			assert(work);
			yield* (yield* DatabaseSession).transaction(
				repository.bind(
					{ userId, relationshipSchemaSlug, relationshipSchemaPluginId: fixture.pluginId },
					{
						pluginPin: work.pluginPin,
						accountToken: work.accountToken,
						outputSchema: work.outputSchema,
						processorScriptId: "rebuilt-processor",
						pluginRevisionId: work.pluginRevisionId,
					},
				),
			);

			expect(
				(yield* notes(workId)).map(({ revision, projectedRevision }) => ({
					revision,
					projectedRevision,
				})),
			).toEqual([
				{ revision: 2, projectedRevision: null },
				{ revision: 2, projectedRevision: null },
			]);
			expect((yield* repository.get(workId))?.currentJobId).toBeNull();
		}),
	);
});

layer(testLayer)((test) => {
	test.effect("reconciliation fills notes for relationships created without a request", () =>
		Effect.gen(function* () {
			const { sources, fixture } = yield* seedLinks("reconcile", 3);
			const workId = relationshipProjectionWorkId({
				userId,
				relationshipSchemaSlug,
				relationshipSchemaPluginId: fixture.pluginId,
			});

			yield* (yield* RelationshipProjectionService).reconcile();

			const filled = yield* notes(workId);
			expect(filled.length).toBe(sources.length);
			expect(
				sources.every((source) =>
					filled.some(({ relationshipId }) => relationshipId === `${source}-link`),
				),
			).toBe(true);
		}),
	);
});

layer(testLayer)((test) => {
	test.effect("fans out to every user holding the relationship", () =>
		Effect.gen(function* () {
			const { sources, fixture } = yield* seedLinks("fan-out", 1);
			const service = yield* RelationshipProjectionService;
			expect(
				yield* service.requestForAllUsers({
					pluginPin: fixture.pluginPin,
					request: { relationshipSchemaSlug, sourceEntityIds: sources },
				}),
			).toBe(1);
			expect(
				yield* service.requestForAllUsers({
					pluginPin: fixture.pluginPin,
					request: { relationshipSchemaSlug, sourceEntityIds: [EntityId.make("unlinked")] },
				}),
			).toBe(0);
		}),
	);
});
