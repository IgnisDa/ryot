import { expect } from "bun:test";

import type { AutomationPopulationContext } from "@ryot-app/contract/modules/automations/lifecycle";
import { definitionKey, definitionOwner } from "@ryot-app/contract/modules/plugins/references";
import {
	AutomationExecutionId,
	EntityId,
	EntitySchemaSlug,
	PluginId,
	RelationshipSchemaSlug,
	SandboxProviderId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { IsoUtcString } from "@ryot-app/contract/schema/utils";
import type { EntityRelationshipDefinitions } from "@ryot-app/definitions/snapshot";
import { assert } from "@ryot-app/testing/assert";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { layer } from "@voila.dev/effect-bun-test";
import { Context, Effect, Layer, Ref, Schema } from "effect";

import { rootLifecycleCommand } from "#modules/automations/lifecycle/command";
import { DefinitionCatalog } from "#modules/definitions/catalog";
import { DefinitionRepository } from "#modules/definitions/repository";
import { EnrichmentRequests } from "#modules/entities/enrichment/requests";
import { EntitiesRepository } from "#modules/entities/repository";
import {
	type DomainLifecycleCommand,
	DomainWriteChecksLive,
} from "#modules/entities/write-context";
import { PluginRuntimeResolver } from "#modules/plugins/catalog/runtime-resolver";
import {
	installRevisionPackage,
	revisionDatabaseLayer,
	revisionPackage,
} from "#modules/plugins/packages/revision.test-support";
import { ScriptExecutionPrincipal } from "#modules/scripts/authorization/principal";
import { SandboxRepository } from "#modules/scripts/registry/repository";
import { DatabaseSession } from "#platform/db/session";
import * as tables from "#schema/tables/combined";
import { workflowAccountsTestLayer } from "#testing/effect";

import { EntityImportWorkflowOperations } from "./operations-workflow";
import { writeChildEntitySet } from "./population";
import { type PopulationWritePayload, runPopulationAttempt } from "./population-job";
import {
	type PopulationCommit,
	populationCommitsLayer,
	upsertedFixture,
} from "./population.test-support";

const now = IsoUtcString.make("2026-09-16T00:00:00.000Z");
const userId = UserId.make("user-1");
const providerId = SandboxProviderId.make("provider-1");
const pluginId = PluginId.make("private-plugin");
const owner = definitionOwner(pluginId);
const rootEntityId = EntityId.make("root-1");
const rootSchemaSlug = EntitySchemaSlug.make("record");
const childSchemaSlug = EntitySchemaSlug.make("part");
const relationshipSchemaSlug = RelationshipSchemaSlug.make("record-part");

const command = {
	...rootLifecycleCommand({
		occurredAt: now,
		lane: "background",
		accountUserId: userId,
		source: "provider-refresh",
		itemIdentity: "provider-population",
		initiator: { id: userId, kind: "user" },
		executionId: AutomationExecutionId.make("provider-population"),
		providerExecutionId: AutomationExecutionId.make("provider-workflow"),
	}),
	writeContext: null,
};

const entityDefinition = (slug: string) => ({ slug, pluginId });

const definitions = {
	entitySchemas: {
		[definitionKey("entity", owner, "person")]: entityDefinition("person"),
		[definitionKey("entity", owner, rootSchemaSlug)]: entityDefinition(rootSchemaSlug),
		[definitionKey("entity", owner, childSchemaSlug)]: entityDefinition(childSchemaSlug),
	},
	relationshipSchemas: {
		[definitionKey("relationship", owner, "credits")]: {
			slug: "credits",
			pluginId: "private-plugin",
			name: { key: "test.credits" },
			propertiesSchema: { fields: {} },
			targetEntitySchemaSlug: "person",
			sourceEntitySchemaSlug: rootSchemaSlug,
		},
		[definitionKey("relationship", owner, relationshipSchemaSlug)]: {
			pluginId,
			name: { key: "test.parts" },
			slug: relationshipSchemaSlug,
			propertiesSchema: { fields: {} },
			sourceEntitySchemaSlug: rootSchemaSlug,
			targetEntitySchemaSlug: childSchemaSlug,
		},
	},
} satisfies EntityRelationshipDefinitions;
const definitionsWithoutChildSchema = {
	...definitions,
	entitySchemas: {
		[definitionKey("entity", owner, "person")]: entityDefinition("person"),
		[definitionKey("entity", owner, rootSchemaSlug)]: entityDefinition(rootSchemaSlug),
	},
} satisfies EntityRelationshipDefinitions;
const definitionsWithoutChildRelationship = {
	...definitions,
	relationshipSchemas: Object.fromEntries(
		Object.entries(definitions.relationshipSchemas).filter(
			([, definition]) => definition.slug === "credits",
		),
	),
} satisfies EntityRelationshipDefinitions;
const definitionMethods = {
	getGlobalEntityRelationshipDefinitions: Effect.succeed(definitions),
	getUserEntityRelationshipDefinitions: () => Effect.succeed(definitions),
	findGlobalRelationshipSchema: (reference) =>
		Effect.succeed(
			definitions.relationshipSchemas[
				definitionKey("relationship", reference.owner, reference.slug)
			] ?? null,
		),
} satisfies Partial<DefinitionRepository["Service"]>;

const population = {
	rootPreviouslyPopulated: true,
	parentEntity: {
		name: "Record",
		properties: {},
		entitySchemaPluginId: pluginId,
		entitySchemaSlug: rootSchemaSlug,
	},
	scopeEntity: {
		name: "Record",
		id: rootEntityId,
		entitySchemaPluginId: pluginId,
		entitySchemaSlug: rootSchemaSlug,
	},
} satisfies AutomationPopulationContext;

class FakeProviderWrites extends Context.Service<
	FakeProviderWrites,
	{ readonly commits: Effect.Effect<ReadonlyArray<PopulationCommit>> }
>()(
	"@ryot-app/kernel-backend/modules/entities/providers/population-children.test/FakeProviderWrites",
) {}

const populationOwner = { requestAttempt: 1, requestId: "population-children" };

const providerWritesLayer = Layer.unwrap(
	Effect.gen(function* () {
		const commits = yield* Ref.make<ReadonlyArray<PopulationCommit>>([]);
		return Layer.mergeAll(
			populationCommitsLayer((commit) => Ref.update(commits, (all) => [...all, commit])),
			Layer.mock(EnrichmentRequests)({}),
			Layer.mock(EntitiesRepository)({}),
			Layer.succeed(FakeProviderWrites, { commits: Ref.get(commits) }),
		);
	}),
);

layer(providerWritesLayer)((it) => {
	it.effect(
		"commits children in provider order with their authoritative child relationships",
		() =>
			Effect.gen(function* () {
				const children = yield* writeChildEntitySet({
					command,
					pluginId,
					population,
					providerId,
					definitions,
					userId: null,
					owner: populationOwner,
					parentEntityId: rootEntityId,
					parentEntitySchemaSlug: rootSchemaSlug,
					expectedChildEntitySchemaSlug: childSchemaSlug,
					childEntities: [
						{ name: "Second", properties: {}, externalId: "b", entitySchemaSlug: childSchemaSlug },
						{ name: "First", properties: {}, externalId: "A", entitySchemaSlug: childSchemaSlug },
					],
				});
				expect(children.map(({ externalId }) => externalId)).toEqual(["b", "A"]);
				const [commit, ...others] = yield* (yield* FakeProviderWrites).commits;
				expect(others).toEqual([]);
				expect(commit?.changes.globalEntities?.map(({ externalId }) => externalId)).toEqual([
					"b",
					"A",
				]);
				expect(commit?.changes.globalRelationships).toMatchObject([
					{
						preserveExisting: true,
						relationshipSchema: { owner, slug: relationshipSchemaSlug },
						selector: { direction: "outgoing", anchor: { entityId: rootEntityId } },
						relationships: [{ target: { externalId: "b" } }, { target: { externalId: "A" } }],
					},
				]);
				expect(commit?.command).toMatchObject({ population, causation: command.causation });
			}),
		testTimeout,
	);

	it.effect(
		"rejects a child entity when its schema is missing from the population catalog",
		() =>
			Effect.gen(function* () {
				const error = yield* Effect.flip(
					writeChildEntitySet({
						command,
						pluginId,
						population,
						providerId,
						userId: null,
						childEntities: [],
						owner: populationOwner,
						parentEntityId: rootEntityId,
						parentEntitySchemaSlug: rootSchemaSlug,
						definitions: definitionsWithoutChildSchema,
						expectedChildEntitySchemaSlug: childSchemaSlug,
					}),
				);
				expect(error.message).toBe("Child entity schema not found: part");
			}),
		testTimeout,
	);

	it.effect(
		"rejects a child entity when its relationship schema is missing from the population catalog",
		() =>
			Effect.gen(function* () {
				const error = yield* Effect.flip(
					writeChildEntitySet({
						command,
						pluginId,
						population,
						providerId,
						userId: null,
						childEntities: [],
						owner: populationOwner,
						parentEntityId: rootEntityId,
						parentEntitySchemaSlug: rootSchemaSlug,
						expectedChildEntitySchemaSlug: childSchemaSlug,
						definitions: definitionsWithoutChildRelationship,
					}),
				);
				expect(error.message).toBe("Child relationship schema not found: record -> part");
			}),
		testTimeout,
	);
});

class FakeRootPopulation extends Context.Service<
	FakeRootPopulation,
	{
		readonly payload: PopulationWritePayload;
		readonly commands: Effect.Effect<ReadonlyArray<DomainLifecycleCommand>>;
	}
>()(
	"@ryot-app/kernel-backend/modules/entities/providers/population-children.test/FakeRootPopulation",
) {}

const rootPopulationLayer = Layer.unwrap(
	Effect.gen(function* () {
		const session = yield* DatabaseSession;
		yield* session.run((db) =>
			db
				.insert(tables.user)
				.values({ id: userId, name: "User", email: "root-population@example.test" }),
		);
		const installed = yield* installRevisionPackage(
			revisionPackage("root-population", "v1", rootSchemaSlug),
			userId,
		);
		const runtime = yield* PluginRuntimeResolver;
		const provider = yield* runtime.findProviderAvailableToUserByReference(userId, {
			slug: "root-population-provider",
			owner: definitionOwner(installed.pluginId),
		});
		if (!provider) {
			return yield* Effect.die("Missing provider fixture");
		}
		const script = yield* runtime.resolveUserDetailsScript(userId, provider.id);
		const subject = { userId, type: "user" as const };
		const pin = yield* (yield* SandboxRepository.make).getScriptPin(script.id, undefined, subject);
		if (!pin?.pluginRevision) {
			return yield* Effect.die("Missing provider fixture pin");
		}
		const { readPinnedRows } = yield* DefinitionRepository.make.pipe(
			Effect.provideServiceEffect(DefinitionCatalog, DefinitionCatalog.make),
		);
		const principal = yield* Schema.decodeEffect(ScriptExecutionPrincipal)({ ...pin, subject });
		const payload: PopulationWritePayload = {
			level: "full",
			mode: "refresh",
			requestAttempt: 1,
			externalId: "record-1",
			providerId: provider.id,
			requestId: "population-root",
			executionId: "population-root",
			entitySchemaSlug: rootSchemaSlug,
			entityScope: { userId, type: "user" },
			pluginId: PluginId.make(installed.pluginId),
			command: { ...command, writeContext: principal },
		};
		const commands = yield* Ref.make<ReadonlyArray<DomainLifecycleCommand>>([]);
		return Layer.mergeAll(
			Layer.mock(EnrichmentRequests)({
				attachEntity: () => Effect.void,
				requesterIds: () => Effect.succeed([]),
			}),
			DomainWriteChecksLive,
			Layer.mock(DefinitionRepository)({ ...definitionMethods, readPinnedRows }),
			workflowAccountsTestLayer,
			Layer.mock(PluginRuntimeResolver)({}),
			Layer.mock(EntityImportWorkflowOperations)({
				completeProviderEntityImport: () => Effect.void,
				processProviderResolve: () => Effect.die("unexpected provider resolve"),
				processSandbox: () =>
					Effect.succeed({
						logs: [],
						error: null,
						status: "completed" as const,
						value: { name: "Record", properties: {}, childEntities: [], relatedEntityGroups: [] },
					}),
			}),
			Layer.mock(EntitiesRepository)({ findPopulationTarget: () => Effect.succeed(null) }),
			populationCommitsLayer(
				({ changes, command: committed }) =>
					changes.globalEntities ? Ref.update(commands, (all) => [...all, committed]) : Effect.void,
				(item, { command: committed }) => {
					const scopeEntity = committed.population?.scopeEntity;
					assert(scopeEntity);
					return upsertedFixture(item, committed.occurredAt, scopeEntity.id);
				},
			),
			Layer.succeed(FakeRootPopulation, { payload, commands: Ref.get(commands) }),
		);
	}),
).pipe(Layer.provideMerge(revisionDatabaseLayer));

layer(rootPopulationLayer)((it) => {
	it.effect(
		"uses command causation for deterministic root and final lifecycle writes",
		() => {
			return Effect.gen(function* () {
				const fake = yield* FakeRootPopulation;
				const payload = fake.payload;
				const result = yield* runPopulationAttempt(payload, payload.executionId);
				const commands = yield* fake.commands;
				expect(result.populatedAt).not.toBeNull();
				expect(commands).toHaveLength(2);
				expect(commands.map(({ causation }) => causation)).toEqual([
					command.causation,
					command.causation,
				]);
				expect(commands.map(({ itemIdentity }) => itemIdentity)).toEqual([
					'["provider-population","root","upsert"]',
					'["provider-population","root","stamp"]',
				]);
				expect(commands[0]?.population).toMatchObject({
					rootPreviouslyPopulated: false,
					scopeEntity: { name: "Record", entitySchemaSlug: rootSchemaSlug },
				});
				expect(commands[1]?.population).toEqual(commands[0]?.population);
			});
		},
		testTimeout,
	);
});
