import { describe, expect, it } from "bun:test";

import { EntitySchemaId, EventSchemaId } from "@ryot/contract/schema/brands";

import {
	archiveCustomSignalSchema,
	bulkSeedUserSignalSchemas,
	createAuthenticatedClient,
	createCollection,
	createCustomSignalSchema,
	createCustomSignalSchemaError,
	createEntity,
	createEntitySchema,
	createEventSchema,
	createRelationship,
	createRelationshipSchema,
	createRule,
	createRuleError,
	createSandboxScript,
	createTracker,
	createTrackerWithSchema,
	createTrackerWithSchemaAndEntity,
	deleteRule,
	findBuiltinSchemaBySlug,
	findBuiltinSchemaWithProviders,
	getBuiltinSandboxScriptId,
	getFirstProviderScriptId,
	getCustomSignalSchema,
	listCustomSignalSchemas,
	listRules,
	queryRecipientUserIds,
	querySignalBySlug,
	ruleTarget,
	scriptId,
	seedHiddenSignalSchema,
	updateRule,
} from "../fixtures";
import { listSubscriptionRuns } from "../fixtures/automations";
import { pollUntil } from "../fixtures/polling";
import { assertTaggedError } from "../test-support/assertions";

const SETTLE_WINDOW_MS = 2500;
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const benignScript = `driver("subscription", async function () {\n\treturn { ran: true };\n});`;

const emitScript = `driver("subscription", async function (context) {
	const signalSchemaId = context.rule?.metadata?.signalSchemaId;
	const result = await emitSignal({
		signalSchemaId: signalSchemaId,
		effectKey: "emit:" + context.automation.occurrenceId,
		properties: { headline: "custom signal fired" },
	});
	if (!result.success) throw new Error(result.error);
	return result;
});`;

const signalProperties = () => ({
	unknownKeys: "strict" as const,
	fields: {
		headline: {
			label: "Headline",
			type: "string" as const,
			description: "Signal headline",
			validation: { required: true as const },
		},
	},
});

const makeUserScript = (client: Parameters<typeof createSandboxScript>[0], allowlist: string[]) =>
	createSandboxScript(client, {
		name: `user-script-${crypto.randomUUID()}`,
		slug: `user-script-${crypto.randomUUID()}`,
		metadata: allowlist.length > 0 ? { allowedHostFunctions: allowlist } : {},
		code: allowlist.includes("emitSignal") ? emitScript : benignScript,
	});

const pollSucceededRun = (
	client: Parameters<typeof listSubscriptionRuns>[0],
	ruleId: string,
	label: string,
) =>
	pollUntil(label, async () => {
		const page = await listSubscriptionRuns(client, { ruleId, status: "succeeded" });
		return page.items.length > 0 ? page.items : null;
	});

describe("phase 5 custom automation surface", () => {
	it("runs an owner-scoped create subscription for a custom entity schema", async () => {
		const user = await createAuthenticatedClient();
		const { schemaId } = await createTrackerWithSchema(user.client);
		const script = await makeUserScript(user.client, []);

		const rule = await createRule(user.client, {
			name: "On custom entity create",
			sandboxScriptId: script.id,
			target: ruleTarget("entity", schemaId),
		});
		expect(rule.kind).toBe("subscription");
		expect(rule.operation).toBe("create");
		expect(rule.isBuiltin).toBe(false);
		expect(rule.target).toEqual({ kind: "entity", id: EntitySchemaId.make(schemaId) });

		await createEntity(user.client, {
			name: "Thing",
			properties: { title: "T" },
			entitySchemaId: EntitySchemaId.make(schemaId),
		});

		const runs = await pollSucceededRun(user.client, rule.id, "custom entity subscription run");
		expect(runs.length).toBe(1);
		expect(runs[0]?.operation).toBe("create");
		expect(runs[0]?.originalRuleId).toBe(rule.id);

		// A single create dispatches exactly one occurrence; no duplicate arrives late.
		await delay(SETTLE_WINDOW_MS);
		const settled = await listSubscriptionRuns(user.client, {
			ruleId: rule.id,
			status: "succeeded",
		});
		expect(settled.items.length).toBe(1);
	});

	it("creates no additional subscription run for a no-op provenance write", async () => {
		const user = await createAuthenticatedClient();
		const { schemaId } = await createTrackerWithSchema(user.client);
		const script = await makeUserScript(user.client, []);
		const rule = await createRule(user.client, {
			name: "On provenance entity create",
			sandboxScriptId: script.id,
			target: ruleTarget("entity", schemaId),
		});

		const { schema } = await findBuiltinSchemaWithProviders(user.client);
		const sandboxScriptId = getFirstProviderScriptId(schema);
		const externalId = `ext-noop-${crypto.randomUUID()}`;
		const provenance = {
			sandboxScriptId,
			externalId,
			name: "Provenance Entity",
			entitySchemaId: EntitySchemaId.make(schemaId),
			properties: { title: "Provenance Entity" },
		};

		const first = await createEntity(user.client, provenance);
		const runs = await pollSucceededRun(user.client, rule.id, "provenance entity subscription run");
		expect(runs.length).toBe(1);

		// The duplicate provenance write returns the existing entity (no write occurs).
		const second = await createEntity(user.client, provenance);
		expect(second.id).toBe(first.id);

		// A no-op write dispatches no lifecycle occurrence, so the run count is unchanged.
		await delay(SETTLE_WINDOW_MS);
		const settled = await listSubscriptionRuns(user.client, {
			ruleId: rule.id,
			status: "succeeded",
		});
		expect(settled.items.length).toBe(1);
	});

	it("runs an owner-scoped create subscription for a custom event schema", async () => {
		const user = await createAuthenticatedClient();
		const { schemaId } = await createTrackerWithSchema(user.client);
		const eventSchema = await createEventSchema(user.client, {
			name: "Custom Event",
			slug: `custom-event-${crypto.randomUUID()}`,
			entitySchemaId: EntitySchemaId.make(schemaId),
		});
		const script = await makeUserScript(user.client, []);

		const rule = await createRule(user.client, {
			sandboxScriptId: script.id,
			name: "On custom event create",
			target: ruleTarget("event", eventSchema.id),
		});
		expect(rule.operation).toBe("create");

		const entity = await createEntity(user.client, {
			name: "Owner",
			properties: { title: "T" },
			entitySchemaId: EntitySchemaId.make(schemaId),
		});
		await user.client.run((c) =>
			c.events.create({
				payload: [
					{
						entityId: entity.id,
						properties: { note: "hi" },
						eventSchemaId: EventSchemaId.make(eventSchema.id),
					},
				],
			}),
		);

		const runs = await pollSucceededRun(user.client, rule.id, "custom event subscription run");
		expect(runs[0]?.operation).toBe("create");
	});

	it("runs a create subscription for a custom relationship schema exactly once across create, no-op, and update", async () => {
		const user = await createAuthenticatedClient();
		const { schemaId: sourceSchemaId } = await createTrackerWithSchema(user.client);
		const { trackerId } = await createTracker(user.client);
		const { schemaId: targetSchemaId } = await createEntitySchema(user.client, { trackerId });
		const relationshipSchema = await createRelationshipSchema(user.client, {
			name: "Custom Rel",
			slug: `custom-rel-${crypto.randomUUID()}`,
			sourceEntitySchemaId: EntitySchemaId.make(sourceSchemaId),
			targetEntitySchemaId: EntitySchemaId.make(targetSchemaId),
			propertiesSchema: {
				fields: { rating: { type: "integer", label: "Rating", description: "Rating" } },
			},
		});
		const script = await makeUserScript(user.client, []);

		const rule = await createRule(user.client, {
			sandboxScriptId: script.id,
			name: "On custom relationship create",
			target: ruleTarget("relationship", relationshipSchema.id),
		});
		expect(rule.operation).toBe("create");
		expect(rule.target).toEqual({ kind: "relationship", id: relationshipSchema.id });

		const source = await createEntity(user.client, {
			name: "Source",
			properties: { title: "Source" },
			entitySchemaId: EntitySchemaId.make(sourceSchemaId),
		});
		const target = await createEntity(user.client, {
			name: "Target",
			properties: { title: "Target" },
			entitySchemaId: EntitySchemaId.make(targetSchemaId),
		});

		const created = await createRelationship(user.client, {
			properties: { rating: 7 },
			sourceEntityId: source.id,
			targetEntityId: target.id,
			relationshipSchemaId: relationshipSchema.id,
		});
		expect(created.wasInserted).toBe(true);

		const runs = await pollSucceededRun(
			user.client,
			rule.id,
			"custom relationship subscription run",
		);
		expect(runs.length).toBe(1);
		expect(runs[0]?.operation).toBe("create");
		expect(runs[0]?.originalRuleId).toBe(rule.id);

		// A single create dispatches exactly one occurrence; no duplicate arrives late.
		await delay(SETTLE_WINDOW_MS);
		const afterCreate = await listSubscriptionRuns(user.client, {
			ruleId: rule.id,
			status: "succeeded",
		});
		expect(afterCreate.items.length).toBe(1);

		// Re-creating with identical properties is a no-op: no lifecycle occurrence, no new run.
		const noop = await createRelationship(user.client, {
			properties: { rating: 7 },
			sourceEntityId: source.id,
			targetEntityId: target.id,
			relationshipSchemaId: relationshipSchema.id,
		});
		expect(noop.wasInserted).toBe(false);
		await delay(SETTLE_WINDOW_MS);
		const afterNoop = await listSubscriptionRuns(user.client, {
			ruleId: rule.id,
			status: "succeeded",
		});
		expect(afterNoop.items.length).toBe(1);

		// Re-creating with different properties is an update occurrence; create-only rules ignore it.
		const updated = await createRelationship(user.client, {
			properties: { rating: 9 },
			sourceEntityId: source.id,
			targetEntityId: target.id,
			relationshipSchemaId: relationshipSchema.id,
		});
		expect(updated.wasInserted).toBe(false);
		expect(updated.properties).toMatchObject({ rating: 9 });
		await delay(SETTLE_WINDOW_MS);
		const afterUpdate = await listSubscriptionRuns(user.client, {
			ruleId: rule.id,
			status: "succeeded",
		});
		expect(afterUpdate.items.length).toBe(1);
	});

	it("runs a create subscription for the builtin collection schema on collection create, and stays at one across membership add and remove", async () => {
		const user = await createAuthenticatedClient();
		const { schema } = await findBuiltinSchemaBySlug(user.client, "collection");
		const script = await makeUserScript(user.client, []);

		const rule = await createRule(user.client, {
			sandboxScriptId: script.id,
			name: "On collection create",
			target: ruleTarget("entity", schema.id),
		});
		expect(rule.operation).toBe("create");
		expect(rule.target).toEqual({ kind: "entity", id: EntitySchemaId.make(schema.id) });

		const collection = await createCollection(user.client, { name: "Subscribed Collection" });

		const runs = await pollSucceededRun(user.client, rule.id, "collection entity subscription run");
		expect(runs.length).toBe(1);
		expect(runs[0]?.operation).toBe("create");
		expect(runs[0]?.originalRuleId).toBe(rule.id);

		// A single collection create dispatches exactly one occurrence; no duplicate arrives late.
		await delay(SETTLE_WINDOW_MS);
		const afterCreate = await listSubscriptionRuns(user.client, {
			ruleId: rule.id,
			status: "succeeded",
		});
		expect(afterCreate.items.length).toBe(1);

		// Membership add + remove are member-of relationship writes: occurrence-free by design.
		const { entityId } = await createTrackerWithSchemaAndEntity(user.client);
		await user.client.run((c) =>
			c.collections.createMembership({ payload: { entityId, collectionId: collection.id } }),
		);
		await user.client.run((c) =>
			c.collections.deleteMembership({ payload: { entityId, collectionId: collection.id } }),
		);

		// The custom entity-create rule receives no run from membership writes.
		await delay(SETTLE_WINDOW_MS);
		const afterMembership = await listSubscriptionRuns(user.client, {
			ruleId: rule.id,
			status: "succeeded",
		});
		expect(afterMembership.items.length).toBe(1);
	});

	it("rejects targets and scripts that the owner cannot access", async () => {
		const owner = await createAuthenticatedClient();
		const stranger = await createAuthenticatedClient();
		const { schemaId: strangerSchemaId } = await createTrackerWithSchema(stranger.client);
		const strangerScript = await makeUserScript(stranger.client, []);
		const ownerScript = await makeUserScript(owner.client, []);
		const ownerSchema = await createTrackerWithSchema(owner.client);

		const otherUsersSchema = await createRuleError(owner.client, {
			name: "cross schema",
			sandboxScriptId: ownerScript.id,
			target: ruleTarget("entity", strangerSchemaId),
		});
		assertTaggedError(otherUsersSchema, "NotFound");

		const otherUsersScript = await createRuleError(owner.client, {
			name: "cross script",
			sandboxScriptId: strangerScript.id,
			target: ruleTarget("entity", ownerSchema.schemaId),
		});
		assertTaggedError(otherUsersScript, "NotFound");

		const builtinScriptId = await getBuiltinSandboxScriptId();
		const builtinScript = await createRuleError(owner.client, {
			name: "builtin script",
			sandboxScriptId: scriptId(builtinScriptId),
			target: ruleTarget("entity", ownerSchema.schemaId),
		});
		assertTaggedError(builtinScript, "NotFound");
	});

	it("rejects hidden built-in signal schema targets", async () => {
		const user = await createAuthenticatedClient();
		const hidden = await seedHiddenSignalSchema();
		const script = await makeUserScript(user.client, ["sendNotification"]);

		const error = await createRuleError(user.client, {
			name: "hidden signal",
			sandboxScriptId: script.id,
			target: ruleTarget("signal", hidden.id),
		});
		assertTaggedError(error, "NotFound");
	});

	it("only mutates name, metadata, and active state through update", async () => {
		const user = await createAuthenticatedClient();
		const { schemaId } = await createTrackerWithSchema(user.client);
		const script = await makeUserScript(user.client, []);
		const rule = await createRule(user.client, {
			name: "Original",
			metadata: { keep: "me" },
			sandboxScriptId: script.id,
			target: ruleTarget("entity", schemaId),
		});

		const updated = await updateRule(user.client, rule.id, {
			isActive: false,
			name: "Renamed",
			metadata: { keep: "changed" },
		});
		expect(updated.name).toBe("Renamed");
		expect(updated.isActive).toBe(false);
		expect(updated.metadata).toEqual({ keep: "changed" });
		expect(updated.target).toEqual(rule.target);
		expect(updated.sandboxScriptId).toBe(rule.sandboxScriptId);
		expect(updated.operation).toBe(rule.operation);

		await deleteRule(user.client, rule.id);
		const listed = await listRules(user.client);
		expect(listed.find((r) => r.id === rule.id)).toBeUndefined();
	});

	it("surfaces catalog notification rules through the generic rule endpoints", async () => {
		const user = await createAuthenticatedClient();
		const rules = await listRules(user.client);
		const notificationRules = rules.filter(
			(rule) => rule.operation === "signal" && rule.target.kind === "signal",
		);
		expect(notificationRules.length).toBeGreaterThan(0);
		const first = notificationRules[0];
		if (!first) {
			throw new Error("expected a catalog notification rule");
		}
		expect(first.isBuiltin).toBe(true);

		const deactivated = await updateRule(user.client, first.id, { isActive: false });
		expect(deactivated.isActive).toBe(false);
		await deleteRule(user.client, first.id);
		const afterDelete = await listRules(user.client);
		expect(afterDelete.find((r) => r.id === first.id)).toBeUndefined();
	});

	it("lets a user script emit its own actor-only signal to itself", async () => {
		const user = await createAuthenticatedClient();
		const { schemaId } = await createTrackerWithSchema(user.client);
		const signalSchema = await createCustomSignalSchema(user.client, {
			name: "My Custom Signal",
			propertiesSchema: signalProperties(),
			slug: `custom-signal-${crypto.randomUUID()}`,
		});
		expect(signalSchema.audiencePolicy).toEqual({ kind: "actor" });
		expect(signalSchema.archivedAt).toBeNull();

		const script = await makeUserScript(user.client, ["emitSignal"]);
		const rule = await createRule(user.client, {
			name: "Emit custom signal",
			sandboxScriptId: script.id,
			metadata: { signalSchemaId: signalSchema.id },
			target: ruleTarget("entity", schemaId),
		});

		await createEntity(user.client, {
			name: "Trigger",
			properties: { title: "T" },
			entitySchemaId: EntitySchemaId.make(schemaId),
		});
		await pollSucceededRun(user.client, rule.id, "emit signal subscription run");

		const signal = await pollUntil("custom signal emitted", async () => {
			const found = await querySignalBySlug({
				slug: signalSchema.slug,
				actorUserId: user.userId,
			});
			return found ?? null;
		});
		expect(signal.actorUserId).toBe(user.userId);
		expect(signal.properties.headline).toBe("custom signal fired");
		expect(await queryRecipientUserIds(signal.id)).toEqual([user.userId]);
	});

	it("archives a custom signal schema, blocking new rules while retaining it", async () => {
		const user = await createAuthenticatedClient();
		const signalSchema = await createCustomSignalSchema(user.client, {
			name: "Archivable Signal",
			propertiesSchema: signalProperties(),
			slug: `archivable-${crypto.randomUUID()}`,
		});
		const script = await makeUserScript(user.client, ["sendNotification"]);

		const archived = await archiveCustomSignalSchema(user.client, signalSchema.id);
		expect(archived.archivedAt).not.toBeNull();

		const fetched = await getCustomSignalSchema(user.client, signalSchema.id);
		expect(fetched.archivedAt).not.toBeNull();

		const error = await createRuleError(user.client, {
			name: "target archived",
			sandboxScriptId: script.id,
			target: ruleTarget("signal", signalSchema.id),
		});
		assertTaggedError(error, "NotFound");
	});

	it("rejects targeting another user's custom signal schema", async () => {
		const owner = await createAuthenticatedClient();
		const stranger = await createAuthenticatedClient();
		const strangerSignal = await createCustomSignalSchema(stranger.client, {
			name: "Stranger Signal",
			propertiesSchema: signalProperties(),
			slug: `stranger-signal-${crypto.randomUUID()}`,
		});
		const ownerScript = await makeUserScript(owner.client, ["sendNotification"]);

		const error = await createRuleError(owner.client, {
			name: "cross signal",
			sandboxScriptId: ownerScript.id,
			target: ruleTarget("signal", strangerSignal.id),
		});
		assertTaggedError(error, "NotFound");

		// The stranger's schema never appears in the owner's list.
		const ownerSchemas = await listCustomSignalSchemas(owner.client);
		expect(ownerSchemas.find((s) => s.id === strangerSignal.id)).toBeUndefined();
	});

	it("enforces the per-user custom signal schema quota", async () => {
		const user = await createAuthenticatedClient();
		// Seed up to the limit (64), of which some are archived and still count.
		await bulkSeedUserSignalSchemas({ userId: user.userId, count: 64, archivedCount: 2 });

		const error = await createCustomSignalSchemaError(user.client, {
			name: "Over Quota",
			propertiesSchema: signalProperties(),
			slug: `over-quota-${crypto.randomUUID()}`,
		});
		assertTaggedError(error, "BadRequest");
	});
});
