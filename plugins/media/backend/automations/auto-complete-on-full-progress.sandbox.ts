import type { AutomationInput } from "@ryot-app/plugin-backend-sdk/automation";
import { defineAutomation } from "@ryot-app/plugin-backend-sdk/automation";
import type { EventSchemaRecord, ScriptHost } from "@ryot-app/plugin-backend-sdk/core";
import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";
import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import {
	entityReadRecipe,
	eventReadRecipe,
	executeRyotqlRecipe,
} from "@ryot-app/plugin-backend-sdk/ryotql";
import type { JsonValue } from "@ryot-app/plugin-backend-sdk/wire";

import { MediaSandboxError } from "../lib/failures";

export const manifest = defineManifest({
	kind: "automation",
	automationType: "automation",
	name: "Auto-Complete on Full Progress",
	slug: "trigger.auto-complete-on-full-progress",
	inputProjection: {
		event: {
			compareProperties: [],
			properties: ["progressPercent", "animeEpisode", "mangaChapter", "consumedOn"],
		},
	},
});

type Properties = Readonly<Record<string, JsonValue>>;
type AutomationHost = Pick<ScriptHost, "executeRyotql" | "createEvents" | "listEventSchemas">;
type AutomationEventSnapshot = Extract<
	AutomationInput["automation"]["payload"],
	{ resource: "event"; operation: "create"; category: "change" }
>["after"];

const isJsonObject = (value: JsonValue): value is Properties =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const jsonObject = (value: JsonValue): Properties | null => (isJsonObject(value) ? value : null);

const toPositiveNumber = (value: JsonValue | undefined) =>
	typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;

const eventTimestamp = (value: string) => {
	const timestamp = Date.parse(value);
	return Number.isFinite(timestamp) ? timestamp : 0;
};

const positionalProperties = {
	anime: { total: "episodes", position: "animeEpisode" },
	manga: { total: "chapters", position: "mangaChapter" },
} as const;

const isPositional = (
	entitySchemaSlug: string,
): entitySchemaSlug is keyof typeof positionalProperties =>
	entitySchemaSlug === "anime" || entitySchemaSlug === "manga";

const reachesTotal = (
	entitySchemaSlug: keyof typeof positionalProperties,
	properties: Properties,
	entityProperties: Properties,
) => {
	const keys = positionalProperties[entitySchemaSlug];
	const position = toPositiveNumber(properties[keys.position]);
	const total = toPositiveNumber(entityProperties[keys.total]);
	return position !== null && total !== null && position >= total;
};

const getCompleteSchema = (host: AutomationHost, entitySchemaSlug: string) =>
	host
		.listEventSchemas([entitySchemaSlug])
		.pipe(
			Effect.map(
				(schemas): EventSchemaRecord | null =>
					schemas.find((schema) => schema.slug === "complete") ?? null,
			),
		);

const fetchEntity = (host: AutomationHost, entityId: string) =>
	executeRyotqlRecipe(host.executeRyotql, entityReadRecipe({ entityIds: [entityId] })).pipe(
		Effect.flatMap(({ items }) => {
			const entity = items[0];
			return entity
				? Effect.succeed(entity)
				: Effect.fail(new MediaSandboxError({ message: "Entity not found" }));
		}),
	);

const latestCompletionTime = (host: AutomationHost, entityId: string, entitySchemaSlug: string) =>
	executeRyotqlRecipe(
		host.executeRyotql,
		eventReadRecipe({
			entityId,
			entitySchemaSlug,
			owner: { kind: "self" },
			eventSchemaSlug: "complete",
		}),
	).pipe(
		Effect.map(({ items }) => {
			const latest = items[0];
			return latest === undefined ? Number.NEGATIVE_INFINITY : eventTimestamp(latest.occurredAt);
		}),
	);

const getInheritedCompletionProperties = (
	hookMetadata: JsonValue | null,
	properties: Properties,
) => {
	const metadata = hookMetadata ? jsonObject(hookMetadata) : null;
	const keys = metadata?.["inheritedProperties"];
	if (!Array.isArray(keys)) {
		return {};
	}
	return Object.fromEntries(
		keys.flatMap((key) =>
			typeof key === "string" && properties[key] !== undefined ? [[key, properties[key]]] : [],
		),
	);
};

const completionEvent = (
	hookMetadata: JsonValue | null,
	event: AutomationEventSnapshot,
	completeSchema: EventSchemaRecord,
) => ({
	entityId: event.entityId,
	occurredAt: event.occurredAt,
	eventSchemaSlug: completeSchema.slug,
	...(event.sessionEntityId === null ? {} : { sessionEntityId: event.sessionEntityId }),
	properties: getInheritedCompletionProperties(hookMetadata, jsonObject(event.properties) ?? {}),
});

export default defineAutomation({
	manifest,
	run: ({ automation }, host) => {
		const payload = automation.payload;
		if (
			payload.category !== "change" ||
			payload.resource !== "event" ||
			payload.operation !== "batch"
		) {
			return Effect.succeed(null);
		}
		const eventsByEntity = new Map<string, AutomationEventSnapshot[]>();
		for (const item of payload.items) {
			if (item.operation !== "create") {
				continue;
			}
			const { after } = item;
			const qualifies =
				after.properties["progressPercent"] === 100 || isPositional(after.entitySchemaSlug);
			if (!qualifies) {
				continue;
			}
			const entityEvents = eventsByEntity.get(after.entityId);
			if (entityEvents) {
				entityEvents.push(after);
			} else {
				eventsByEntity.set(after.entityId, [after]);
			}
		}
		return Effect.forEach(eventsByEntity, ([entityId, events]) =>
			Effect.gen(function* () {
				const first = events[0];
				if (!first) {
					return;
				}
				const entitySchemaSlug = first.entitySchemaSlug;
				const entity = yield* fetchEntity(host, entityId);
				const completeSchema = yield* getCompleteSchema(host, entity.entitySchemaSlug);
				if (!completeSchema) {
					return;
				}
				if (!isPositional(entitySchemaSlug)) {
					yield* host.createEvents(
						events.map((current) =>
							completionEvent(automation.hookMetadata ?? null, current, completeSchema),
						),
					);
					return;
				}
				const entityProperties = jsonObject(entity.properties) ?? {};
				const completing = events
					.filter(
						(current) =>
							current.properties["progressPercent"] === 100 ||
							reachesTotal(entitySchemaSlug, current.properties, entityProperties),
					)
					.sort(
						(left, right) => eventTimestamp(left.occurredAt) - eventTimestamp(right.occurredAt),
					);
				if (completing.length === 0) {
					return;
				}
				let completedThrough = yield* latestCompletionTime(host, entityId, entitySchemaSlug);
				const pending: ReturnType<typeof completionEvent>[] = [];
				for (const current of completing) {
					const occurredAt = eventTimestamp(current.occurredAt);
					if (completedThrough >= occurredAt) {
						continue;
					}
					completedThrough = occurredAt;
					pending.push(completionEvent(automation.hookMetadata ?? null, current, completeSchema));
				}
				if (pending.length > 0) {
					yield* host.createEvents(pending);
				}
			}),
		).pipe(Effect.as(null));
	},
});
