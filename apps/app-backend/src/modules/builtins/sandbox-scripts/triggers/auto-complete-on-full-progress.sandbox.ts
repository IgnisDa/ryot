import {
	defineManifest,
	type EventRecord,
	type EventSchemaRecord,
	type JsonValue,
	type SandboxHost,
} from "@ryot/sandbox-sdk";
import { defineAfterCreateTrigger, type AfterCreateTriggerInput } from "@ryot/sandbox-sdk/trigger";

export const manifest = defineManifest({
	kind: "trigger",
	mode: "after_create",
	requiredAppConfigKeys: [],
	name: "Auto-Complete on Full Progress",
	slug: "trigger.auto-complete-on-full-progress",
	capabilities: ["getEntity", "listEvents", "createEvents", "listEventSchemas"],
});

type Trigger = AfterCreateTriggerInput["trigger"];
type Properties = Readonly<Record<string, JsonValue>>;
type TriggerHost = SandboxHost<typeof manifest.capabilities>;
type CompletionCandidate = {
	readonly emitterEventId: string;
	readonly completionEvent: EventRecord;
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

const compareCoverageEvents = (left: EventRecord, right: EventRecord) => {
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
	events: readonly EventRecord[],
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

const getCompleteSchema = (host: TriggerHost, trigger: Trigger) =>
	host.listEventSchemas(trigger.entitySchemaId).then((result): EventSchemaRecord | null => {
		if (!result.success) {
			throw new Error(result.error);
		}
		return result.data.find((schema) => schema.slug === "complete") ?? null;
	});

const getEntityProperties = (host: TriggerHost, entityId: string) =>
	host.getEntity(entityId).then((result) => {
		if (!result.success) {
			throw new Error(result.error);
		}
		return jsonObject(result.data.properties) ?? {};
	});

const getProgressEvents = (host: TriggerHost, entityId: string) =>
	host.listEvents({ entityId, eventSchemaSlug: "progress" }).then((result) => {
		if (!result.success) {
			throw new Error(result.error);
		}
		return result.data;
	});

const getInheritedCompletionProperties = (source: Trigger | EventRecord) => {
	const properties = jsonObject(source.properties) ?? {};
	const inherited = "inheritedProperties" in source ? source.inheritedProperties : {};
	const consumedOn = properties["consumedOn"] ?? inherited["consumedOn"];
	return typeof consumedOn === "string" ? { consumedOn } : {};
};

const createCompletionEvent = (
	host: TriggerHost,
	trigger: Trigger,
	completeSchema: EventSchemaRecord,
	source: Trigger | EventRecord,
) => {
	const occurredAt = source.occurredAt || trigger.occurredAt;
	return host
		.createEvents([
			{
				entityId: trigger.entityId,
				eventSchemaId: completeSchema.id,
				occurredAt,
				properties: {
					...getInheritedCompletionProperties(source),
					completedOn: occurredAt,
					completionMode: "custom_timestamps",
				},
			},
		])
		.then((result) => {
			if (!result.success) {
				throw new Error(result.error);
			}
			return undefined;
		});
};

export default defineAfterCreateTrigger({
	manifest,
	run: ({ trigger }, host) => {
		if (trigger.properties["progressPercent"] !== 100) {
			return Promise.resolve();
		}
		const isEpisodic = trigger.entitySchemaSlug === "anime" || trigger.entitySchemaSlug === "manga";
		if (!isEpisodic) {
			return getCompleteSchema(host, trigger).then((completeSchema) =>
				completeSchema ? createCompletionEvent(host, trigger, completeSchema, trigger) : undefined,
			);
		}

		return Promise.all([
			getCompleteSchema(host, trigger),
			getEntityProperties(host, trigger.entityId),
			getProgressEvents(host, trigger.entityId),
		]).then(([completeSchema, entityProperties, progressEvents]) => {
			if (!completeSchema) {
				return undefined;
			}
			const requiredKeys = getRequiredCoverageKeys(trigger.entitySchemaSlug, entityProperties);
			if (!requiredKeys || requiredKeys.length === 0) {
				return undefined;
			}
			const completionCandidate = getCompletionCandidates(
				trigger.entitySchemaSlug,
				requiredKeys,
				progressEvents,
			).find((candidate) => candidate.emitterEventId === trigger.eventId);
			return completionCandidate
				? createCompletionEvent(host, trigger, completeSchema, completionCandidate.completionEvent)
				: undefined;
		});
	},
});
