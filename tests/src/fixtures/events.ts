import { EntityId, EventSchemaSlug } from "@ryot/contract/schema/brands";
import { Effect } from "effect";

import { assertPresent } from "~/support/assertions";

import type { Client } from "./auth";
import { createEntity } from "./entities";
import { createPluginSchema, findBuiltinSchemaBySlug } from "./entity-schemas";
import { createEventSchema, listEventSchemas, requireEventSchemaBySlug } from "./event-schemas";
import { seedMediaEntity } from "./media";
import { pollUntil } from "./polling";

const defaultMediaProperties = {
	genres: [],
	isNsfw: null,
	sourceUrl: null,
	description: null,
	publishYear: null,
	providerRating: null,
	productionStatus: null,
};

const defaultMediaPropertiesWithUnlinkedCreators = {
	...defaultMediaProperties,
	unlinkedCreators: [],
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
		...defaultMediaPropertiesWithUnlinkedCreators,
		images: [],
		totalSeasons: null,
		totalEpisodes: null,
	},
	podcast: {
		...defaultMediaPropertiesWithUnlinkedCreators,
		images: [],
		episodes: [],
		totalEpisodes: null,
	},
};

export const waitForEventCount = (client: Client, entityId: string, expectedCount: number) =>
	pollUntil(
		`${expectedCount} events on entity ${entityId}`,
		Effect.gen(function* () {
			const events = yield* listEventsForEntity(client, entityId);
			return events.length >= expectedCount ? events : null;
		}),
	);

export const createEventTestFixture = (client: Client) =>
	Effect.gen(function* () {
		const { schemaId: entitySchemaSlug } = yield* createPluginSchema(client, {
			name: "Test Item",
			slug: `item-${crypto.randomUUID()}`,
		});
		const eventSchema = yield* createEventSchema(client, {
			entitySchemaSlug,
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
		const entity = yield* createEntity(client, {
			entitySchemaSlug,
			name: "Test Book",
			properties: { title: "Test" },
		});
		return { entityId: entity.id, entitySchemaSlug, eventSchemaSlug: eventSchema.id };
	});

export const createRuleEventFixture = (client: Client) =>
	Effect.gen(function* () {
		const { schemaId: entitySchemaSlug } = yield* createPluginSchema(client, {
			name: "Rule Test Item",
			slug: `rule-item-${crypto.randomUUID()}`,
		});
		const eventSchema = yield* createEventSchema(client, {
			entitySchemaSlug,
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
		const entity = yield* createEntity(client, {
			entitySchemaSlug,
			name: "Rule Test Book",
			properties: { title: "Rule Test" },
		});
		return { entityId: entity.id, eventSchemaSlug: eventSchema.id };
	});

export const listEventsForEntity = (
	client: Client,
	entityId: string,
	options: { eventSchemaSlug?: string } = {},
) =>
	client.call((c) =>
		c.events.list({
			query: {
				entityId: EntityId.make(entityId),
				...(options.eventSchemaSlug
					? { eventSchemaSlug: EventSchemaSlug.make(options.eventSchemaSlug) }
					: {}),
			},
		}),
	);

export const waitForEventWithSchema = (client: Client, entityId: string, eventSchemaSlug: string) =>
	pollUntil(
		`${eventSchemaSlug} event on entity ${entityId}`,
		Effect.gen(function* () {
			const events = yield* listEventsForEntity(client, entityId);
			return events.find((event) => event.eventSchemaSlug === eventSchemaSlug) ?? null;
		}),
	);

export const listEventSlugs = (client: Client, entityId: string) =>
	Effect.gen(function* () {
		const events = yield* listEventsForEntity(client, entityId);
		return events.map((event) => event.eventSchemaSlug);
	});

export const waitForEventSlugs = (client: Client, entityId: string, requiredSlug: string) =>
	pollUntil(
		`'${requiredSlug}' event on entity ${entityId}`,
		Effect.gen(function* () {
			const slugs = yield* listEventSlugs(client, entityId);
			return slugs.some((slug) => slug === requiredSlug) ? slugs : null;
		}),
	);

export const createBuiltinMediaLifecycleFixture = (
	client: Client,
	options: BuiltinMediaLifecycleFixtureOptions = {},
) =>
	Effect.gen(function* () {
		const entitySchemaSlug = options.entitySchemaSlug ?? "book";
		const { schema: selectedSchema } = yield* findBuiltinSchemaBySlug(client, entitySchemaSlug);

		const providerId = selectedSchema.providers[0]?.providerId;
		assertPresent(providerId, `Missing built-in ${entitySchemaSlug} provider`);

		const eventSchemas = yield* listEventSchemas(client, selectedSchema.id);
		const backlogEventSchema = requireEventSchemaBySlug(eventSchemas, "backlog");
		const progressEventSchema = requireEventSchemaBySlug(eventSchemas, "progress");
		const completeEventSchema = requireEventSchemaBySlug(eventSchemas, "complete");
		const reviewEventSchema = requireEventSchemaBySlug(eventSchemas, "review");
		const droppedEventSchema = requireEventSchemaBySlug(eventSchemas, "dropped");
		const onHoldEventSchema = requireEventSchemaBySlug(eventSchemas, "on_hold");

		const entity = yield* seedMediaEntity({
			userId: null,
			entitySchemaSlug: selectedSchema.id,
			providerId,
			externalId: `${entitySchemaSlug}-${crypto.randomUUID()}`,
			name: `Built-in ${entitySchemaSlug} ${crypto.randomUUID()}`,
			properties: {
				...(propertiesBySchemaSlug[entitySchemaSlug] ?? defaultMediaProperties),
				...options.properties,
			},
		});

		return {
			entityId: entity.id,
			reviewEventSchemaSlug: reviewEventSchema.id,
			onHoldEventSchemaSlug: onHoldEventSchema.id,
			backlogEventSchemaSlug: backlogEventSchema.id,
			droppedEventSchemaSlug: droppedEventSchema.id,
			completeEventSchemaSlug: completeEventSchema.id,
			progressEventSchemaSlug: progressEventSchema.id,
		};
	});
