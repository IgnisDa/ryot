import { describe, expect, it } from "bun:test";

import {
	type AppSchema,
	createAuthenticatedClient,
	createEntity,
	createEventSchema,
	createSandboxScript,
	createTrackerWithSchema,
	listEventsForEntity,
	waitForEventCount,
} from "../fixtures";
import { getPgClient } from "../setup";
import { assertTaggedError, requirePresent } from "../test-support/assertions";

const insertBeforeCreatePolicy = async (
	userId: string,
	eventSchemaId: string,
	sandboxScriptId: string,
	position: number,
) => {
	const pg = getPgClient();
	const id = crypto.randomUUID();
	await pg.query(
		`INSERT INTO automation_rule
			(id, name, position, is_active, is_builtin, kind, operation, metadata, user_id, event_schema_id, sandbox_script_id)
		VALUES ($1, $2, $3, true, false, 'policy', 'create', '{}'::jsonb, $4, $5, $6)`,
		[id, "test-before-create-policy", position, userId, eventSchemaId, sandboxScriptId],
	);
	return id;
};

const createBeforeTriggerFixture = async (
	client: Awaited<ReturnType<typeof createAuthenticatedClient>>["client"],
	propertiesSchema: AppSchema,
) => {
	const { schemaId: entitySchemaId } = await createTrackerWithSchema(client, {
		name: "Before Trigger Test",
		slug: `bt-${crypto.randomUUID()}`,
	});
	const eventSchema = await createEventSchema(client, {
		entitySchemaId,
		name: "BT Event",
		propertiesSchema,
		slug: `bt-event-${crypto.randomUUID()}`,
	});
	const entity = await createEntity(client, {
		entitySchemaId,
		name: "BT Entity",
		properties: { title: "Test" },
	});
	return { entityId: entity.id, eventSchemaId: eventSchema.id };
};

describe("before_create triggers", () => {
	it("skip prevents event creation", async () => {
		const { client, userId } = await createAuthenticatedClient();

		const { entityId, eventSchemaId } = await createBeforeTriggerFixture(client, {
			fields: { note: { type: "string" as const, label: "Note", description: "Note" } },
		});

		const script = await createSandboxScript(client, {
			name: "skip trigger",
			slug: `skip-${crypto.randomUUID()}`,
			code: `driver("trigger", async function() { return { action: "skip", reason: "test_skip" }; });`,
		});

		await insertBeforeCreatePolicy(userId, eventSchemaId, script.id, 100);

		await client.run((c) =>
			c.events.create({ payload: [{ entityId, eventSchemaId, properties: {} }] }),
		);

		await new Promise<void>((resolve) => setTimeout(resolve, 8000));

		const events = await listEventsForEntity(client, entityId);
		expect(events).toHaveLength(0);
	});

	it("replace modifies the persisted event properties", async () => {
		const { client, userId } = await createAuthenticatedClient();

		const { entityId, eventSchemaId } = await createBeforeTriggerFixture(client, {
			fields: { value: { type: "integer" as const, label: "Value", description: "Value" } },
		});

		const script = await createSandboxScript(client, {
			name: "replace trigger",
			slug: `replace-${crypto.randomUUID()}`,
			code: `driver("trigger", async function() { return { action: "replace", body: { properties: { value: 999 } } }; });`,
		});

		await insertBeforeCreatePolicy(userId, eventSchemaId, script.id, 100);

		await client.run((c) =>
			c.events.create({ payload: [{ entityId, eventSchemaId, properties: { value: 1 } }] }),
		);

		await waitForEventCount(client, entityId, 1, { timeoutMs: 20_000 });

		const events = await listEventsForEntity(client, entityId);
		expect(events).toHaveLength(1);
		expect(requirePresent(events[0], "Expected event").properties).toMatchObject({ value: 999 });
	});

	it("fail-closed: before-trigger error rejects the create and prevents event creation", async () => {
		const { client, userId } = await createAuthenticatedClient();

		const { entityId, eventSchemaId } = await createBeforeTriggerFixture(client, {
			fields: { note: { type: "string" as const, label: "Note", description: "Note" } },
		});

		const script = await createSandboxScript(client, {
			name: "error trigger",
			slug: `error-${crypto.randomUUID()}`,
			code: `driver("trigger", async function() { throw new Error("test_error"); });`,
		});

		await insertBeforeCreatePolicy(userId, eventSchemaId, script.id, 100);

		// A before-create policy runs inline within the create workflow, so a
		// throwing trigger fails the create closed: the request is rejected and no
		// event is ever written (writeEvent is never reached).
		const error = await client.runError((c) =>
			c.events.create({ payload: [{ entityId, eventSchemaId, properties: {} }] }),
		);

		assertTaggedError(error, "BadRequest");
		expect(error.message).toContain("Before trigger failed: test_error");

		const events = await listEventsForEntity(client, entityId);
		expect(events).toHaveLength(0);
	});

	it("two triggers run in ascending position order", async () => {
		const { client, userId } = await createAuthenticatedClient();

		const { entityId, eventSchemaId } = await createBeforeTriggerFixture(client, {
			fields: { x: { type: "integer" as const, label: "X", description: "X" } },
		});

		const scriptPos100 = await createSandboxScript(client, {
			name: "position 100 trigger",
			slug: `pos100-${crypto.randomUUID()}`,
			code: `driver("trigger", async function() { return { action: "replace", body: { properties: { x: 2 } } }; });`,
		});

		const scriptPos200 = await createSandboxScript(client, {
			name: "position 200 trigger",
			slug: `pos200-${crypto.randomUUID()}`,
			code: `driver("trigger", async function() { return { action: "replace", body: { properties: { x: 3 } } }; });`,
		});

		await insertBeforeCreatePolicy(userId, eventSchemaId, scriptPos100.id, 100);
		await insertBeforeCreatePolicy(userId, eventSchemaId, scriptPos200.id, 200);

		await client.run((c) =>
			c.events.create({ payload: [{ entityId, eventSchemaId, properties: { x: 1 } }] }),
		);

		await waitForEventCount(client, entityId, 1, { timeoutMs: 20_000 });

		const events = await listEventsForEntity(client, entityId);
		expect(events).toHaveLength(1);
		expect(requirePresent(events[0], "Expected event").properties).toMatchObject({ x: 3 });
	});
});
