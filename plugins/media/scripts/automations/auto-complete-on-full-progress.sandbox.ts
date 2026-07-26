import {
	defineAutomation,
	type AutomationContext,
	type AutomationEventSnapshot,
} from "@ryot/sandbox-sdk/automation";
import type { EventSchemaRecord, SandboxHost } from "@ryot/sandbox-sdk/core";
import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { DateTime, Effect, Option } from "@ryot/sandbox-sdk/effect";
import { buildEntityReadDocument, buildEventReadDocument } from "@ryot/sandbox-sdk/ryotql";
import type { JsonValue } from "@ryot/sandbox-sdk/wire";

import {
	decodeEntityReadResponse,
	decodeProgressEvents,
	type MediaProgressEvent,
} from "../../shared/ryotql";

export const manifest = defineManifest({
	kind: "automation",
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
	name: "Auto-Complete on Full Progress",
	slug: "trigger.auto-complete-on-full-progress",
	capabilities: ["executeRyotql", "createEvents", "listEventSchemas"],
});

type Properties = Readonly<Record<string, JsonValue>>;
type AutomationHost = SandboxHost<typeof manifest.capabilities>;
type CompletionCandidate = {
	readonly emitterEventId: string;
	readonly completionEvent: MediaProgressEvent;
};

const isJsonObject = (value: JsonValue): value is Properties =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const jsonObject = (value: JsonValue): Properties | null => (isJsonObject(value) ? value : null);

const toPositiveInteger = (value: JsonValue | undefined) =>
	typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;

const toPositiveNumber = (value: JsonValue | undefined) =>
	typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;

const buildCountKeys = (count: number) => {
	const keys: string[] = [];
	for (let index = 1; index <= count; index += 1) {
		keys.push(String(index));
	}
	return keys;
};

const buildMangaChapterKeys = (totalChapters: number) => {
	const wholeChapters = Math.floor(totalChapters);
	const keys = buildCountKeys(wholeChapters);
	if (totalChapters !== wholeChapters) {
		keys.push(String(totalChapters));
	}
	return keys;
};

const getCoverageKeyFromProperties = (entitySchemaSlug: string, value: JsonValue) => {
	const properties = jsonObject(value);
	if (properties?.["progressPercent"] !== 100) {
		return null;
	}
	if (entitySchemaSlug === "anime") {
		const episodeNumber = toPositiveInteger(properties["animeEpisode"]);
		return episodeNumber !== null ? String(episodeNumber) : null;
	}
	if (entitySchemaSlug === "manga") {
		const chapterNumber = toPositiveNumber(properties["mangaChapter"]);
		return chapterNumber !== null ? String(chapterNumber) : null;
	}
	return null;
};

const eventTimestamp = (value: string) => {
	const timestamp = Date.parse(value);
	return Number.isFinite(timestamp) ? timestamp : 0;
};

const normalizeDate = (value: string) => {
	const date = DateTime.make(value);
	if (Option.isNone(date)) {
		return value;
	}
	const iso = DateTime.formatIso(date.value);
	return iso.endsWith("Z") ? iso.replace(/\.000Z$/, "+00:00").replace(/Z$/, "+00:00") : iso;
};

const compareCoverageEvents = (left: MediaProgressEvent, right: MediaProgressEvent) => {
	const occurredAtDiff = eventTimestamp(left.occurredAt) - eventTimestamp(right.occurredAt);
	if (occurredAtDiff !== 0) {
		return occurredAtDiff;
	}
	const createdAtDiff = eventTimestamp(left.createdAt) - eventTimestamp(right.createdAt);
	return createdAtDiff !== 0 ? createdAtDiff : left.id.localeCompare(right.id);
};

const getRequiredCoverageKeys = (entitySchemaSlug: string, properties: Properties) => {
	if (entitySchemaSlug === "anime") {
		const episodeCount = toPositiveInteger(properties["episodes"]);
		return episodeCount === null ? null : buildCountKeys(episodeCount);
	}
	if (entitySchemaSlug === "manga") {
		const chapterCount = toPositiveNumber(properties["chapters"]);
		return chapterCount === null ? null : buildMangaChapterKeys(chapterCount);
	}
	return null;
};

const getCompletionCandidates = (
	entitySchemaSlug: string,
	requiredKeys: readonly string[],
	events: readonly MediaProgressEvent[],
) => {
	const completionCandidates: CompletionCandidate[] = [];
	let coveredKeys = new Set<string>();
	for (const event of [...events].sort(compareCoverageEvents)) {
		const coverageKey = getCoverageKeyFromProperties(entitySchemaSlug, event.properties);
		if (coverageKey === null) {
			continue;
		}
		coveredKeys.add(coverageKey);
		if (!requiredKeys.every((requiredKey) => coveredKeys.has(requiredKey))) {
			continue;
		}
		completionCandidates.push({ completionEvent: event, emitterEventId: event.id });
		coveredKeys = new Set();
	}
	return completionCandidates;
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

const fetchEntity = (host: AutomationHost, entityId: string, entitySchemaSlug: string) =>
	host
		.executeRyotql(
			buildEntityReadDocument({ entityIds: [entityId], entitySchemaSlugs: [entitySchemaSlug] }),
		)
		.pipe(Effect.map(decodeEntityReadResponse));

const getProgressEvents = (host: AutomationHost, entityId: string, entitySchemaSlug: string) =>
	host
		.executeRyotql(
			buildEventReadDocument({ entityId, entitySchemaSlug, eventSchemaSlug: "progress" }),
		)
		.pipe(Effect.map(decodeProgressEvents));

const getInheritedCompletionProperties = (
	automation: AutomationContext,
	properties: Properties,
) => {
	const metadata = automation.ruleMetadata ? jsonObject(automation.ruleMetadata) : null;
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

const createCompletionEvent = (
	host: AutomationHost,
	automation: AutomationContext,
	event: AutomationEventSnapshot,
	completeSchema: EventSchemaRecord,
	source: AutomationEventSnapshot | MediaProgressEvent,
) => {
	const occurredAt =
		source === event ? source.occurredAt || event.occurredAt : normalizeDate(source.occurredAt);
	const properties = jsonObject(source.properties) ?? {};
	return host
		.createEvents([
			{
				entityId: event.subject.id,
				eventSchemaSlug: completeSchema.id,
				occurredAt,
				properties: {
					...getInheritedCompletionProperties(automation, properties),
					completedOn: occurredAt,
					completionMode: "custom_timestamps",
				},
			},
		])
		.pipe(Effect.as(null));
};

export default defineAutomation({
	manifest,
	run: ({ automation }, host) => {
		const event = automation.source.kind === "event" ? automation.source.after : undefined;
		if (event?.properties["progressPercent"] !== 100) {
			return Effect.succeed(null);
		}
		const entityId = event.subject.id;
		const entitySchemaSlug = event.subject.entitySchemaSlug;
		return Effect.gen(function* () {
			const entity = yield* fetchEntity(host, entityId, entitySchemaSlug);
			const isEpisodic = entitySchemaSlug === "anime" || entitySchemaSlug === "manga";
			if (!isEpisodic) {
				const completeSchema = yield* getCompleteSchema(host, entity.entitySchemaSlug);
				return completeSchema
					? yield* createCompletionEvent(host, automation, event, completeSchema, event)
					: null;
			}

			const [completeSchema, progressEvents] = yield* Effect.all(
				[
					getCompleteSchema(host, entity.entitySchemaSlug),
					getProgressEvents(host, entityId, entitySchemaSlug),
				],
				{ concurrency: "unbounded" },
			);
			if (!completeSchema) {
				return null;
			}
			const entityProperties = jsonObject(entity.properties) ?? {};
			const requiredKeys = getRequiredCoverageKeys(entitySchemaSlug, entityProperties);
			if (!requiredKeys || requiredKeys.length === 0) {
				return null;
			}
			const completionCandidate = getCompletionCandidates(
				entitySchemaSlug,
				requiredKeys,
				progressEvents,
			).find((candidate) => candidate.emitterEventId === event.id);
			return completionCandidate
				? yield* createCompletionEvent(
						host,
						automation,
						event,
						completeSchema,
						completionCandidate.completionEvent,
					)
				: null;
		});
	},
});
