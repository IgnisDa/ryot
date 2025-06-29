import type { Client } from "./auth";
import { createEntity } from "./entities";
import { createTrackerWithSchema, listEntitySchemas } from "./entity-schemas";
import { createEventSchema, listEventSchemas } from "./event-schemas";
import { seedMediaEntity } from "./media";
import { type PollOptions, pollUntil } from "./polling";
import { findBuiltinTracker } from "./trackers";

export async function waitForEventCount(
	client: Client,
	cookies: string,
	entityId: string,
	expectedCount: number,
	options: PollOptions = {},
) {
	return pollUntil(
		`${expectedCount} events on entity ${entityId}`,
		async () => {
			const result = await client.GET("/events", {
				headers: { Cookie: cookies },
				params: { query: { entityId } },
			});
			const events = result.data?.data ?? [];
			return events.length >= expectedCount ? events : null;
		},
		{ timeoutMs: 5000, intervalMs: 200, ...options },
	);
}

export async function createEventTestFixture(client: Client, cookies: string) {
	const { schemaId: entitySchemaId } = await createTrackerWithSchema(
		client,
		cookies,
		{ name: "Test Item", slug: `item-${crypto.randomUUID()}` },
	);
	const eventSchema = await createEventSchema(client, cookies, {
		entitySchemaId,
		name: "Finished",
		slug: `finished-${crypto.randomUUID()}`,
		propertiesSchema: {
			fields: {
				rating: {
					label: "Rating",
					type: "number" as const,
					validation: { required: true as const },
				},
			},
		},
	});
	const entity = await createEntity(client, cookies, {
		image: null,
		entitySchemaId,
		name: "Test Book",
		properties: { title: "Test" },
	});
	return { entityId: entity.id, eventSchemaId: eventSchema.id };
}

export async function createRuleEventFixture(client: Client, cookies: string) {
	const { schemaId: entitySchemaId } = await createTrackerWithSchema(
		client,
		cookies,
		{ name: "Rule Test Item", slug: `rule-item-${crypto.randomUUID()}` },
	);
	const eventSchema = await createEventSchema(client, cookies, {
		entitySchemaId,
		name: "Progress Log",
		slug: `progress-log-${crypto.randomUUID()}`,
		propertiesSchema: {
			fields: {
				progressPercent: {
					type: "number" as const,
					label: "Progress Percent",
				},
				status: {
					type: "string" as const,
					label: "Status",
					validation: { required: true as const },
				},
			},
			rules: [
				{
					path: ["progressPercent"],
					kind: "validation" as const,
					validation: { required: true as const },
					when: {
						path: ["status"],
						value: "completed",
						operator: "eq" as const,
					},
				},
			],
		},
	});
	const entity = await createEntity(client, cookies, {
		image: null,
		entitySchemaId,
		name: "Rule Test Book",
		properties: { title: "Rule Test" },
	});
	return { entityId: entity.id, eventSchemaId: eventSchema.id };
}

export async function createBuiltinMediaLifecycleFixture(
	client: Client,
	cookies: string,
	userId: string,
) {
	const builtinTracker = await findBuiltinTracker(client, cookies);
	const schemas = await listEntitySchemas(client, cookies, {
		trackerId: builtinTracker.id,
	});

	const bookSchema = schemas.find((schema) => schema.slug === "book");
	if (!bookSchema) {
		throw new Error("Missing built-in book schema");
	}

	const providerScriptId = bookSchema.providers[0]?.scriptId;
	if (!providerScriptId) {
		throw new Error("Missing built-in book provider");
	}

	const eventSchemas = await listEventSchemas(client, cookies, bookSchema.id);

	const backlogEventSchema = eventSchemas.find((s) => s.slug === "backlog");
	if (!backlogEventSchema) {
		throw new Error("Missing built-in backlog event schema");
	}

	const progressEventSchema = eventSchemas.find((s) => s.slug === "progress");
	if (!progressEventSchema) {
		throw new Error("Missing built-in progress event schema");
	}

	const completeEventSchema = eventSchemas.find((s) => s.slug === "complete");
	if (!completeEventSchema) {
		throw new Error("Missing built-in complete event schema");
	}

	const reviewEventSchema = eventSchemas.find((s) => s.slug === "review");
	if (!reviewEventSchema) {
		throw new Error("Missing built-in review event schema");
	}

	const otherSchema = schemas.find((schema) => schema.slug === "anime");
	if (!otherSchema) {
		throw new Error("Missing built-in anime schema");
	}

	const otherEventSchemas = await listEventSchemas(
		client,
		cookies,
		otherSchema.id,
	);
	const mismatchedBacklogEventSchema = otherEventSchemas.find(
		(s) => s.slug === "backlog",
	);
	if (!mismatchedBacklogEventSchema) {
		throw new Error("Missing mismatched backlog event schema");
	}

	const entity = await seedMediaEntity({
		userId,
		image: null,
		properties: {},
		entitySchemaId: bookSchema.id,
		sandboxScriptId: providerScriptId,
		externalId: `book-${crypto.randomUUID()}`,
		name: `Built-in Book ${crypto.randomUUID()}`,
	});

	return {
		entityId: entity.id,
		reviewEventSchemaId: reviewEventSchema.id,
		backlogEventSchemaId: backlogEventSchema.id,
		completeEventSchemaId: completeEventSchema.id,
		progressEventSchemaId: progressEventSchema.id,
		mismatchedEventSchemaId: mismatchedBacklogEventSchema.id,
	};
}
