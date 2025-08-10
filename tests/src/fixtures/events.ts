import type { Client } from "./auth";
import { createEntity } from "./entities";
import {
	createTrackerWithSchema,
	findBuiltinSchemaBySlug,
	listBuiltinEntitySchemas,
} from "./entity-schemas";
import { createEventSchema, listEventSchemas, requireEventSchemaBySlug } from "./event-schemas";
import { seedMediaEntity } from "./media";
import { type PollOptions, pollUntil } from "./polling";

const defaultMediaProperties = {
	genres: [],
	isNsfw: null,
	sourceUrl: null,
	description: null,
	publishYear: null,
	providerRating: null,
	productionStatus: null,
};

const defaultMediaPropertiesWithCreators = {
	...defaultMediaProperties,
	freeCreators: [],
};

type BuiltinMediaLifecycleFixtureOptions = {
	entitySchemaSlug?: string;
	properties?: Record<string, unknown>;
};

const propertiesBySchemaSlug: Record<string, Record<string, unknown>> = {
	book: { ...defaultMediaProperties },
	movie: { ...defaultMediaProperties, images: [] },
	anime: { ...defaultMediaProperties, images: [], episodes: null },
	manga: {
		...defaultMediaProperties,
		images: [],
		volumes: null,
		chapters: null,
	},
	show: {
		...defaultMediaPropertiesWithCreators,
		images: [],
		showSeasons: [],
	},
	podcast: {
		...defaultMediaPropertiesWithCreators,
		images: [],
		episodes: [],
		totalEpisodes: null,
	},
};

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
	const { schemaId: entitySchemaId } = await createTrackerWithSchema(client, cookies, {
		name: "Test Item",
		slug: `item-${crypto.randomUUID()}`,
	});
	const eventSchema = await createEventSchema(client, cookies, {
		entitySchemaId,
		name: "Finished",
		slug: `finished-${crypto.randomUUID()}`,
		propertiesSchema: {
			fields: {
				rating: {
					label: "Rating",
					type: "number" as const,
					description: "Rating score",
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
	const { schemaId: entitySchemaId } = await createTrackerWithSchema(client, cookies, {
		name: "Rule Test Item",
		slug: `rule-item-${crypto.randomUUID()}`,
	});
	const eventSchema = await createEventSchema(client, cookies, {
		entitySchemaId,
		name: "Progress Log",
		slug: `progress-log-${crypto.randomUUID()}`,
		propertiesSchema: {
			fields: {
				progressPercent: {
					type: "number" as const,
					label: "Progress Percent",
					description: "Progress percentage",
				},
				status: {
					label: "Status",
					type: "string" as const,
					description: "Workflow status",
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
	options: BuiltinMediaLifecycleFixtureOptions = {},
) {
	const entitySchemaSlug = options.entitySchemaSlug ?? "book";
	const { schema: selectedSchema } = await findBuiltinSchemaBySlug(
		client,
		cookies,
		entitySchemaSlug,
	);

	const providerScriptId = selectedSchema.providers[0]?.scriptId;
	if (!providerScriptId) {
		throw new Error(`Missing built-in ${entitySchemaSlug} provider`);
	}

	const eventSchemas = await listEventSchemas(client, cookies, selectedSchema.id);
	const backlogEventSchema = requireEventSchemaBySlug(eventSchemas, "backlog");
	const progressEventSchema = requireEventSchemaBySlug(eventSchemas, "progress");
	const completeEventSchema = requireEventSchemaBySlug(eventSchemas, "complete");
	const reviewEventSchema = requireEventSchemaBySlug(eventSchemas, "review");

	const { schemas } = await listBuiltinEntitySchemas(client, cookies);
	const otherSchema = schemas.find((schema) => schema.id !== selectedSchema.id);
	if (!otherSchema) {
		throw new Error("Missing mismatched built-in schema");
	}

	const otherEventSchemas = await listEventSchemas(client, cookies, otherSchema.id);
	const mismatchedBacklogEventSchema = requireEventSchemaBySlug(otherEventSchemas, "backlog");

	const entity = await seedMediaEntity({
		image: null,
		userId: null,
		entitySchemaId: selectedSchema.id,
		sandboxScriptId: providerScriptId,
		externalId: `${entitySchemaSlug}-${crypto.randomUUID()}`,
		name: `Built-in ${entitySchemaSlug} ${crypto.randomUUID()}`,
		properties: {
			...(propertiesBySchemaSlug[entitySchemaSlug] ?? defaultMediaProperties),
			...options.properties,
		},
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
