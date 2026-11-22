import { expect } from "bun:test";

import { definitionOwner } from "@ryot-app/contract/modules/plugins/references";
import {
	AutomationExecutionId,
	AutomationRunId,
	AutomationTriggerId,
	EntitySchemaSlug,
	RelationshipSchemaSlug,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { assert } from "@ryot-app/testing/assert";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { layer } from "@voila.dev/effect-bun-test";
import { eq } from "drizzle-orm";
import { Effect } from "effect";

import { automationLifecycleCausation } from "#modules/automations/lifecycle/command";
import { EntitiesRepository } from "#modules/entities/repository";
import type { DomainLifecycleCommand } from "#modules/entities/write-context";
import {
	installRevisionPackage,
	revisionPackage,
} from "#modules/plugins/packages/revision.test-support";
import { DatabaseSession } from "#platform/db/session";
import { WriteTransaction } from "#platform/db/write-transaction";
import * as tables from "#schema/tables/combined";

import {
	baseInput,
	command,
	propertiesSchema,
	relationshipChangeSetsLayer,
	relationshipSchemaSlug,
	sourceEntityId,
	targetEntityId,
	upsertGlobalRelationship,
	userId,
	writeRelationship,
} from "./lifecycle.test-support";
import type { ReconcileGlobalRelationshipGroup } from "./mutation-support";
import { RelationshipsService } from "./service";

const reconcileGlobal = (
	groups: ReadonlyArray<ReconcileGlobalRelationshipGroup>,
	lifecycle: DomainLifecycleCommand,
) =>
	Effect.gen(function* () {
		const service = yield* RelationshipsService;
		const committed = yield* (yield* DatabaseSession)
			.transaction(
				service.persistPlannedReconciliation(new WriteTransaction(), groups, lifecycle, {
					scope: "global",
				}),
			)
			.pipe(Effect.catchTag("DatabaseSessionStateError", Effect.die));
		return committed.result;
	});

const automationCommand = (id: string) => {
	const parent = command(id, UserId.make("initiator"));
	return {
		...parent,
		causation: automationLifecycleCausation(
			{
				stage: "before",
				causation: parent.causation,
				runId: AutomationRunId.make("automation-run"),
				triggerId: AutomationTriggerId.make("automation-trigger"),
			},
			AutomationExecutionId.make(id),
		),
	};
};

const globalInput = {
	sourceEntityId,
	targetEntityId,
	relationshipSchemaSlug,
	properties: { rank: 1 },
	scope: "global" as const,
	relationshipSchemaPluginId: null,
	relationshipSchema: { slug: relationshipSchemaSlug, owner: { kind: "kernel" as const } },
};

const installGlobalHooks = Effect.fn(function* () {
	const session = yield* DatabaseSession;
	yield* session.run((db) =>
		db
			.insert(tables.user)
			.values({
				id: UserId.make("owner"),
				name: "Plugin installer",
				email: "executor-ownership@example.test",
			}),
	);
	const fixture = revisionPackage("executor-ownership", "v1", "ownership-fixture");
	const script = fixture.manifest.scripts.find(({ kind }) => kind === "automation");
	const schema = fixture.manifest.relationshipSchemas[0];
	assert(script?.kind === "automation" && schema);
	const installed = yield* installRevisionPackage(
		{
			...fixture,
			scripts: fixture.scripts.map((entry) => ({
				...entry,
				metadata:
					entry.metadata.kind === "automation" && entry.metadata.automationType === "automation"
						? {
								...entry.metadata,
								inputProjection: {
									...entry.metadata.inputProjection,
									relationship: {
										properties: ["rank"],
										compareProperties: [],
										parentEntityProperties: [],
									},
								},
							}
						: entry.metadata,
			})),
			manifest: {
				...fixture.manifest,
				relationshipSchemas: [
					{
						...schema,
						propertiesSchema,
						sourceEntitySchemaSlug: null,
						targetEntitySchemaSlug: null,
					},
				],
				scripts: fixture.manifest.scripts.map((entry) =>
					entry.kind === "automation" && entry.automationType === "automation"
						? {
								...entry,
								inputProjection: {
									...entry.inputProjection,
									relationship: {
										properties: ["rank"],
										compareProperties: [],
										parentEntityProperties: [],
									},
								},
							}
						: entry,
				),
				hooks: [
					...fixture.manifest.hooks,
					...(["item", "batch"] as const).map((frequency) => ({
						frequency,
						stage: "after" as const,
						scriptSlug: script.slug,
						name: `Ownership ${frequency}`,
						executionScope: "global" as const,
						slug: `executor-ownership.${frequency}`,
						targets: [
							{
								operation: "create" as const,
								resource: "relationship" as const,
								relationshipSchemaSlug: schema.slug,
							},
						],
					})),
				],
			},
		},
		null,
	);
	const entities = yield* EntitiesRepository;
	const identity = {
		properties: {},
		populatedAt: null,
		scope: "global" as const,
		entitySchemaPluginId: installed.pluginId,
		entitySchemaSlug: EntitySchemaSlug.make("ownership-fixture"),
	};
	const [source, target] = yield* entities.insertEntities([
		{ ...identity, name: "Source" },
		{ ...identity, name: "Target" },
	]);
	if (!source || !target) {
		return yield* Effect.die("Fixture entities were not inserted");
	}
	return {
		...globalInput,
		sourceEntityId: source.id,
		targetEntityId: target.id,
		relationshipSchemaPluginId: installed.pluginId,
		relationshipSchemaSlug: RelationshipSchemaSlug.make(schema.slug),
		relationshipSchema: {
			owner: definitionOwner(installed.pluginId),
			slug: RelationshipSchemaSlug.make(schema.slug),
		},
	};
});

layer(relationshipChangeSetsLayer())((test) => {
	test.effect(
		"persists global system automation item and batch writes with user attribution",
		() =>
			Effect.gen(function* () {
				const session = yield* DatabaseSession;
				const input = yield* installGlobalHooks();
				const { sourceEntityId: ownedSourceEntityId, targetEntityId: ownedTargetEntityId } = input;
				const singleCommand = { ...automationCommand("system-item"), accountUserId: null };
				const created = yield* upsertGlobalRelationship(input, singleCommand);
				expect(created).toMatchObject({ userId: null, properties: { rank: 1 } });
				const group = {
					relationshipSchema: input.relationshipSchema,
					selector: {
						type: "anchored" as const,
						direction: "outgoing" as const,
						anchorEntityId: ownedSourceEntityId,
					},
					relationships: [
						{
							properties: { rank: 2 },
							sourceEntityId: ownedSourceEntityId,
							targetEntityId: ownedTargetEntityId,
						},
						{
							properties: { rank: 3 },
							sourceEntityId: ownedSourceEntityId,
							targetEntityId: ownedSourceEntityId,
						},
					],
				};
				const batchCommand = { ...automationCommand("system-batch"), accountUserId: null };
				const reconciled = yield* reconcileGlobal([group], batchCommand);
				expect(reconciled).toEqual([{ created: 1, updated: 1, deleted: 0, upserted: 2 }]);
				const relationships = yield* session.run((db) => db.select().from(tables.relationship));
				expect(relationships).toHaveLength(2);
				expect(
					relationships.find((row) => row.targetEntityId === ownedTargetEntityId)?.properties,
				).toEqual({ rank: 2 });
				expect(
					relationships.find((row) => row.targetEntityId === ownedSourceEntityId)?.properties,
				).toEqual({ rank: 3 });
				const triggers = yield* session.run((db) => db.select().from(tables.automationTrigger));
				expect(triggers.some(({ operation }) => operation === "batch")).toBe(true);
				expect(
					triggers.every(
						({ initiatorId, initiatorKind }) =>
							initiatorKind === "user" && initiatorId === "initiator",
					),
				).toBe(true);
			}),
		testTimeout,
	);
});

layer(relationshipChangeSetsLayer())((test) => {
	test.effect(
		"owns global automation items and batches by the executor and rejects missing or retired user tokens",
		() =>
			Effect.gen(function* () {
				const session = yield* DatabaseSession;
				const executing = { ...automationCommand("user-batch"), accountUserId: userId };
				const group = {
					relationshipSchema: globalInput.relationshipSchema,
					relationships: [{ sourceEntityId, targetEntityId, properties: { rank: 1 } }],
					selector: {
						type: "anchored" as const,
						direction: "outgoing" as const,
						anchorEntityId: sourceEntityId,
					},
				};
				expect(yield* reconcileGlobal([group], executing)).toEqual([
					{ created: 1, updated: 0, deleted: 0, upserted: 1 },
				]);
				const missing = yield* Effect.flip(
					writeRelationship("upsert", baseInput, {
						...automationCommand("missing-user"),
						accountUserId: null,
					}),
				);
				expect(missing).toMatchObject({ message: "Mutation command account is missing" });
				yield* session.run((db) =>
					db.update(tables.user).set({ retiringAt: new Date() }).where(eq(tables.user.id, userId)),
				);
				const retired = yield* Effect.flip(
					reconcileGlobal([group], { ...automationCommand("retired-user"), accountUserId: userId }),
				);
				expect(retired).toMatchObject({ message: "Mutation command account is being retired" });
				const missingRoot = yield* Effect.flip(
					upsertGlobalRelationship(globalInput, {
						...command("missing-root"),
						accountUserId: null,
					}),
				);
				expect(missingRoot).toMatchObject({ message: "Mutation command account is missing" });
				expect(yield* session.run((db) => db.select().from(tables.relationship))).toHaveLength(1);
			}),
		testTimeout,
	);
});
