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
import { requirePresent } from "../test-support/assertions";

const insertBeforeCreateTrigger = async (
	userId: string,
	eventSchemaId: string,
	sandboxScriptId: string,
	position: number,
) => {
	const pg = getPgClient();
	const id = crypto.randomUUID();
	await pg.query(
		`INSERT INTO event_schema_trigger
			(id, name, position, is_active, is_builtin, phase, metadata, user_id, event_schema_id, sandbox_script_id)
		VALUES ($1, $2, $3, true, false, 'before_create', '{}'::jsonb, $4, $5, $6)`,
		[id, "test-before-create-trigger", position, userId, eventSchemaId, sandboxScriptId],
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
		image: null,
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

		await insertBeforeCreateTrigger(userId, eventSchemaId, script.id, 100);

		await client.run((c) =>
			c.events.create({ payload: [{ entityId, eventSchemaId, properties: {} }] }),
		);

		await new Promise<void>((resolve) => setTimeout(resolve, 8000));

		const events = await listEventsForEntity(client, entityId);
		expect(events).toHaveLength(0);
	}, 30_000);

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

		await insertBeforeCreateTrigger(userId, eventSchemaId, script.id, 100);

		await client.run((c) =>
			c.events.create({ payload: [{ entityId, eventSchemaId, properties: { value: 1 } }] }),
		);

		await waitForEventCount(client, entityId, 1, { timeoutMs: 20_000 });

		const events = await listEventsForEntity(client, entityId);
		expect(events).toHaveLength(1);
		expect(requirePresent(events[0], "Expected event").properties).toMatchObject({ value: 999 });
	}, 40_000);

	it("fail-closed: before-trigger error happens after enqueue and prevents event creation", async () => {
		const { client, userId } = await createAuthenticatedClient();

		const { entityId, eventSchemaId } = await createBeforeTriggerFixture(client, {
			fields: { note: { type: "string" as const, label: "Note", description: "Note" } },
		});

		const script = await createSandboxScript(client, {
			name: "error trigger",
			slug: `error-${crypto.randomUUID()}`,
			code: `driver("trigger", async function() { throw new Error("test_error"); });`,
		});

		await insertBeforeCreateTrigger(userId, eventSchemaId, script.id, 100);

		const result = await client.run((c) =>
			c.events.create({ payload: [{ entityId, eventSchemaId, properties: {} }] }),
		);

		expect(result.count).toBe(1);

		await new Promise<void>((resolve) => setTimeout(resolve, 8000));

		const events = await listEventsForEntity(client, entityId);
		expect(events).toHaveLength(0);
	}, 30_000);

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

		await insertBeforeCreateTrigger(userId, eventSchemaId, scriptPos100.id, 100);
		await insertBeforeCreateTrigger(userId, eventSchemaId, scriptPos200.id, 200);

		await client.run((c) =>
			c.events.create({ payload: [{ entityId, eventSchemaId, properties: { x: 1 } }] }),
		);

		await waitForEventCount(client, entityId, 1, { timeoutMs: 20_000 });

		const events = await listEventsForEntity(client, entityId);
		expect(events).toHaveLength(1);
		expect(requirePresent(events[0], "Expected event").properties).toMatchObject({ x: 3 });
	}, 40_000);
});
