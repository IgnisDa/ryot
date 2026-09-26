import { assert, expect, layer } from "@effect/vitest";
import {
	AutomationExecutionId,
	AutomationRunId,
	AutomationTriggerId,
	RelationshipSchemaSlug,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { Effect } from "effect";

import { automationLifecycleCausation } from "#lib/domain/lifecycle-command";
import * as tables from "#lib/infrastructure/db/schema/tables/combined";
import { DatabaseSession } from "#lib/infrastructure/db/session";
import { installRevisionPackage, revisionPackage } from "#modules/plugins/revision.test-support";

import {
	baseInput,
	command,
	propertiesSchema,
	relationshipDatabaseLayer,
	relationshipSchemaSlug,
	sourceEntityId,
	targetEntityId,
	userId,
} from "./lifecycle.test-support";
import { RelationshipsService } from "./service";

const automationCommand = (id: string) => {
	const parent = command(id, UserId.make("initiator"));
	return {
		...parent,
		causation: automationLifecycleCausation(
			{
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
				accountGeneration: "test-account-generation",
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
						delivery: "async" as const,
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
	return {
		...globalInput,
		relationshipSchemaPluginId: installed.pluginId,
		relationshipSchemaSlug: RelationshipSchemaSlug.make(schema.slug),
	};
});

layer(relationshipDatabaseLayer())((test) => {
	test.effect(
		"persists and replays global system automation item and batch writes with user attribution",
		() =>
			Effect.gen(function* () {
				const service = yield* RelationshipsService;
				const session = yield* DatabaseSession;
				const input = yield* installGlobalHooks();
				const singleCommand = { ...automationCommand("system-item"), accountGeneration: null };
				const created = yield* service.create(input, singleCommand);
				expect(created.relationship).toMatchObject({ wasInserted: true, properties: { rank: 1 } });
				const group = {
					relationshipSchemaSlug: input.relationshipSchemaSlug,
					selector: {
						type: "anchored" as const,
						direction: "outgoing" as const,
						anchorEntityId: sourceEntityId,
					},
					relationships: [
						{ sourceEntityId, targetEntityId, properties: { rank: 2 } },
						{ sourceEntityId, properties: { rank: 3 }, targetEntityId: sourceEntityId },
					],
				};
				const batchCommand = { ...automationCommand("system-batch"), accountGeneration: null };
				const reconciled = yield* service.reconcileGlobal([group], batchCommand);
				expect(reconciled).toEqual([
					{ created: 1, updated: 1, deleted: 0, upserted: 2, warnings: [] },
				]);
				expect(yield* service.create(input, singleCommand)).toEqual(created);
				expect(yield* service.reconcileGlobal([group], batchCommand)).toEqual(reconciled);
				const rows = yield* session.run((db) => db.select().from(tables.mutationReceipt));
				expect(rows.some(({ receiptType }) => receiptType === "item")).toBe(true);
				expect(rows.some(({ receiptType }) => receiptType === "batch-decision")).toBe(true);
				expect(
					rows.every(
						({ ownerUserId, scopeUserId, accountGeneration }) =>
							ownerUserId === null && scopeUserId === null && accountGeneration === null,
					),
				).toBe(true);
				const relationships = yield* session.run((db) => db.select().from(tables.relationship));
				expect(relationships).toHaveLength(2);
				expect(
					relationships.find((row) => row.targetEntityId === targetEntityId)?.properties,
				).toEqual({ rank: 2 });
				expect(
					relationships.find((row) => row.targetEntityId === sourceEntityId)?.properties,
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
	);
});

layer(relationshipDatabaseLayer())((test) => {
	test.effect(
		"owns global automation items and batches by the executor and rejects missing or retired user tokens",
		() =>
			Effect.gen(function* () {
				const service = yield* RelationshipsService;
				const session = yield* DatabaseSession;
				const executing = {
					...automationCommand("user-batch"),
					accountGeneration: { userId, token: "test-account-generation" },
				};
				const group = {
					relationshipSchemaSlug,
					relationships: [{ sourceEntityId, targetEntityId, properties: { rank: 1 } }],
					selector: {
						type: "anchored" as const,
						direction: "outgoing" as const,
						anchorEntityId: sourceEntityId,
					},
				};
				expect(yield* service.reconcileGlobal([group], executing)).toEqual([
					{ created: 1, updated: 0, deleted: 0, upserted: 1, warnings: [] },
				]);
				const before = yield* session.run((db) => db.select().from(tables.mutationReceipt));
				expect(before.some(({ receiptType }) => receiptType === "item")).toBe(true);
				expect(before.some(({ receiptType }) => receiptType === "batch-decision")).toBe(true);
				expect(
					before.every(
						({ ownerUserId, accountGeneration }) =>
							ownerUserId === userId && accountGeneration?.userId === userId,
					),
				).toBe(true);
				const missing = yield* Effect.flip(
					service.create(baseInput, {
						...automationCommand("missing-user"),
						accountGeneration: null,
					}),
				);
				expect(missing).toMatchObject({
					message: "Mutation command account generation is missing",
				});
				const retired = yield* Effect.flip(
					service.reconcileGlobal([group], {
						...automationCommand("retired-user"),
						accountGeneration: { userId, token: "retired-token" },
					}),
				);
				expect(retired).toMatchObject({ message: "Mutation command belongs to a retired account" });
				const missingRoot = yield* Effect.flip(
					service.create(globalInput, { ...command("missing-root"), accountGeneration: null }),
				);
				expect(missingRoot).toMatchObject({
					message: "Mutation command account generation is missing",
				});
				expect(yield* session.run((db) => db.select().from(tables.mutationReceipt))).toEqual(
					before,
				);
				expect(yield* session.run((db) => db.select().from(tables.relationship))).toHaveLength(1);
			}),
	);
});
