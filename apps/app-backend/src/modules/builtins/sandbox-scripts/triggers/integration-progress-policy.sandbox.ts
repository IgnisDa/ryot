import {
	defineManifest,
	type EventRecord,
	type JsonValue,
	type SandboxHost,
} from "@ryot/sandbox-sdk";
import {
	defineBeforeCreateTrigger,
	type BeforeCreateTriggerInput,
} from "@ryot/sandbox-sdk/trigger";

const SUBITEM_KEYS = ["animeEpisode", "mangaVolume", "mangaChapter"] as const;
const DEFAULT_THRESHOLD_SECONDS = 7200;

export const manifest = defineManifest({
	kind: "trigger",
	mode: "before_create",
	name: "Integration Progress Policy",
	slug: "trigger.integration-progress-policy",
	requiredAppConfigKeys: ["scheduler.progressUpdateThresholdHours"],
	capabilities: ["listEvents", "getIntegration", "claimCachedValue", "getAppConfigValue"],
});

type Trigger = BeforeCreateTriggerInput["trigger"];
type TriggerHost = SandboxHost<typeof manifest.capabilities>;
type Properties = Readonly<Record<string, JsonValue>>;

const isJsonObject = (value: JsonValue): value is Properties =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const jsonObject = (value: JsonValue): Properties | null => (isJsonObject(value) ? value : null);

const parseProgressPercent = (value: JsonValue | undefined) => {
	if (typeof value === "number") {
		return Number.isFinite(value) ? value : null;
	}
	if (typeof value === "string" && value.trim() !== "") {
		const parsed = Number(value);
		return Number.isFinite(parsed) ? parsed : null;
	}
	return null;
};

const toFiniteNumber = (value: unknown) => {
	const parsed = typeof value === "string" ? Number(value) : value;
	return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : null;
};

const subitemSignature = (properties: Properties) => {
	const parts: string[] = [];
	for (const key of SUBITEM_KEYS) {
		const value = properties[key];
		if (typeof value === "number" || typeof value === "string") {
			parts.push(`${key}=${String(value)}`);
		}
	}
	return parts.join(",");
};

const consumedOnValue = (properties: Properties) =>
	typeof properties["consumedOn"] === "string" ? properties["consumedOn"] : "";

const buildFingerprint = (trigger: Trigger, properties: Properties) =>
	[
		trigger.entityId,
		trigger.eventSchemaSlug,
		consumedOnValue(properties),
		subitemSignature(properties),
	].join("|");

const hasSameIdentity = (eventProperties: Properties, triggerProperties: Properties) =>
	consumedOnValue(eventProperties) === consumedOnValue(triggerProperties) &&
	subitemSignature(eventProperties) === subitemSignature(triggerProperties);

const eventTimestamp = (value: string) => {
	const timestamp = Date.parse(value);
	return Number.isFinite(timestamp) ? timestamp : 0;
};

const sortLatestFirst = (left: EventRecord, right: EventRecord) => {
	const occurredDiff = eventTimestamp(right.occurredAt) - eventTimestamp(left.occurredAt);
	return occurredDiff !== 0
		? occurredDiff
		: eventTimestamp(right.createdAt) - eventTimestamp(left.createdAt);
};

const getThresholdSeconds = (host: TriggerHost) =>
	host.getAppConfigValue("scheduler.progressUpdateThresholdHours").then((result) => {
		const hours = result.success ? toFiniteNumber(result.data) : null;
		return hours !== null && hours > 0 ? Math.round(hours * 3600) : DEFAULT_THRESHOLD_SECONDS;
	});

const getMatchingEvents = (host: TriggerHost, trigger: Trigger, properties: Properties) =>
	host.listEvents({ entityId: trigger.entityId, eventSchemaSlug: "progress" }).then((result) => {
		if (!result.success) {
			return [];
		}
		return [...result.data]
			.filter((event) => {
				const eventProperties = jsonObject(event.properties);
				return eventProperties !== null && hasSameIdentity(eventProperties, properties);
			})
			.sort(sortLatestFirst);
	});

export default defineBeforeCreateTrigger({
	manifest,
	run: ({ trigger }, host) => {
		if (trigger.origin !== "integration") {
			return Promise.resolve({ action: "allow" });
		}

		const properties = trigger.properties;
		const parsedProgressPercent = parseProgressPercent(properties["progressPercent"]);
		if (parsedProgressPercent === null) {
			return Promise.resolve({ action: "skip", reason: "invalid_progress" });
		}
		let progressPercent: number = parsedProgressPercent;
		if (!trigger.integrationId) {
			return Promise.resolve({ action: "allow" });
		}

		return host.getIntegration(trigger.integrationId).then((integrationResult) => {
			if (!integrationResult.success) {
				return { action: "allow" } as const;
			}
			const minimumProgress = toFiniteNumber(integrationResult.data.minimumProgress) ?? 0;
			const maximumProgress = toFiniteNumber(integrationResult.data.maximumProgress) ?? 100;
			if (progressPercent < minimumProgress) {
				return { action: "skip", reason: "below_minimum_progress" } as const;
			}

			let replaced = false;
			if (progressPercent > maximumProgress) {
				progressPercent = 100;
				replaced = true;
			}

			return getMatchingEvents(host, trigger, properties).then((matchingEvents) => {
				const latestProperties = matchingEvents[0]
					? jsonObject(matchingEvents[0].properties)
					: null;
				if (
					latestProperties &&
					parseProgressPercent(latestProperties["progressPercent"]) === progressPercent
				) {
					return { action: "skip", reason: "duplicate_progress" } as const;
				}

				const checkCompletion = () => {
					if (progressPercent < 100) {
						return Promise.resolve(false);
					}
					return getThresholdSeconds(host).then((thresholdSeconds) =>
						host
							.claimCachedValue(buildFingerprint(trigger, properties), true, thresholdSeconds)
							.then((claim) => {
								if (!claim.success || claim.data.claimed) {
									return false;
								}
								const recentCompletion = matchingEvents.find((event) => {
									const eventProperties = jsonObject(event.properties);
									return (
										eventProperties !== null &&
										parseProgressPercent(eventProperties["progressPercent"]) === 100
									);
								});
								return recentCompletion
									? Date.now() - eventTimestamp(recentCompletion.occurredAt) <=
											thresholdSeconds * 1000
									: false;
							}),
					);
				};

				return checkCompletion().then((completedRecently) => {
					if (completedRecently) {
						return { action: "skip", reason: "completed_recently" } as const;
					}
					return replaced
						? {
								action: "replace" as const,
								body: { properties: { ...properties, progressPercent: 100 } },
							}
						: ({ action: "allow" } as const);
				});
			});
		});
	},
});
