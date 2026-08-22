import type { SandboxHost } from "@ryot-app/sandbox-sdk/core";
import { DateTime, Effect } from "@ryot-app/sandbox-sdk/effect";
import { eventReadRecipe, executeRyotqlRecipe } from "@ryot-app/sandbox-sdk/ryotql";
import type { JsonValue } from "@ryot-app/sandbox-sdk/wire";

import type { MediaProgressEvent } from "../lib/ryotql";
import type { MediaImportWriteChunkInput } from "./schemas";
import type { manifest } from "./write-chunks.sandbox";

type Host = SandboxHost<typeof manifest.capabilities>;
type Properties = Readonly<Record<string, JsonValue>>;
type ProgressEvent = Pick<MediaProgressEvent, "properties" | "occurredAt" | "createdAt">;

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

const isJsonObject = (value: JsonValue): value is Properties =>
	typeof value === "object" && value !== null && !Array.isArray(value);
const jsonObject = (value: JsonValue): Properties | null => (isJsonObject(value) ? value : null);

const subitemSignature = (properties: Properties) => {
	const parts: string[] = [];
	for (const key of ["animeEpisode", "mangaVolume", "mangaChapter"] as const) {
		const value = properties[key];
		if (typeof value === "number" || typeof value === "string") {
			parts.push(`${key}=${String(value)}`);
		}
	}
	return parts.join(",");
};

const consumedOnValue = (properties: Properties) =>
	typeof properties["consumedOn"] === "string" ? properties["consumedOn"] : "";

const eventTimestamp = (value: string) => {
	const timestamp = Date.parse(value);
	return Number.isFinite(timestamp) ? timestamp : 0;
};

const sortLatestFirst = (left: ProgressEvent, right: ProgressEvent) =>
	eventTimestamp(right.occurredAt) - eventTimestamp(left.occurredAt) ||
	eventTimestamp(right.createdAt) - eventTimestamp(left.createdAt);

export const admitIntegrationProgress = (input: MediaImportWriteChunkInput, host: Host) =>
	Effect.gen(function* () {
		const attribution = input.integration;
		if (!attribution) {
			return input;
		}
		const populationByIndex = new Map(
			input.populationResults.map((result) => [result.index, result]),
		);
		const pending = new Map<string, ProgressEvent[]>();
		const entityGroups: MediaImportWriteChunkInput["entityGroups"][number][] = [];
		for (const [groupIndex, group] of input.entityGroups.entries()) {
			const population = populationByIndex.get(groupIndex);
			if (population?.status !== "completed") {
				entityGroups.push(group);
				continue;
			}
			const events: (typeof group.events)[number][] = [];
			for (const [eventIndex, event] of group.events.entries()) {
				if (event.eventSchemaSlug !== "progress") {
					events.push(event);
					continue;
				}
				const entityId = event.subjectEntityId ?? population.entityId;
				if (event.subjectEntityId && !event.subjectEntitySchemaSlug) {
					return yield* Effect.fail(
						new Error("Integration progress subject is missing its resolved schema"),
					);
				}
				const entitySchemaSlug = event.subjectEntitySchemaSlug ?? group.entityRef.entitySchemaSlug;
				const identity = [
					entityId,
					entitySchemaSlug,
					event.eventSchemaSlug,
					consumedOnValue(event.properties),
					subitemSignature(event.properties),
				];
				const fingerprint = JSON.stringify(identity);
				const claimKey = JSON.stringify([
					"media.integration-progress.v1",
					attribution.integrationId,
					...identity,
				]);
				const decision = yield* Effect.gen(function* () {
					const parsed = parseProgressPercent(event.properties["progressPercent"]);
					if (parsed === null) {
						return { reason: "invalid_progress" };
					}
					const integration = yield* host.getCurrentIntegration();
					const minimum = toFiniteNumber(integration.minimumProgress) ?? 0;
					const maximum = toFiniteNumber(integration.maximumProgress) ?? 100;
					if (parsed < minimum) {
						return { reason: "below_minimum_progress" };
					}
					const progressPercent = parsed > maximum ? 100 : parsed;
					const { items } = yield* executeRyotqlRecipe(
						host.executeRyotql,
						eventReadRecipe({ entityId, entitySchemaSlug, eventSchemaSlug: "progress" }),
					);
					const matchingEvents = [
						...items.filter((item) => {
							const properties = jsonObject(item.properties);
							return (
								properties !== null &&
								consumedOnValue(properties) === consumedOnValue(event.properties) &&
								subitemSignature(properties) === subitemSignature(event.properties)
							);
						}),
						...(pending.get(fingerprint) ?? []),
					].sort(sortLatestFirst);
					const latest = matchingEvents[0] ? jsonObject(matchingEvents[0].properties) : null;
					if (latest && parseProgressPercent(latest["progressPercent"]) === progressPercent) {
						return { reason: "duplicate_progress" };
					}
					const now = yield* DateTime.nowAsDate;
					if (progressPercent >= 100) {
						const config = yield* host.getPluginConfig(["progressUpdateThresholdHours"]);
						const hours = toFiniteNumber(config["progressUpdateThresholdHours"]);
						const thresholdSeconds = hours !== null && hours > 0 ? Math.round(hours * 3600) : 7200;
						const claim = yield* host.claimPersistentValue(claimKey, true, thresholdSeconds);
						if (!claim.claimed) {
							const completion = matchingEvents.find((item) => {
								const properties = jsonObject(item.properties);
								return (
									properties !== null && parseProgressPercent(properties["progressPercent"]) === 100
								);
							});
							if (
								completion &&
								now.getTime() - eventTimestamp(completion.occurredAt) <= thresholdSeconds * 1000
							) {
								return { reason: "completed_recently" };
							}
						}
					}
					const admitted =
						parsed > maximum
							? { ...event, properties: { ...event.properties, progressPercent: 100 } }
							: event;
					pending.set(fingerprint, [
						...(pending.get(fingerprint) ?? []),
						{ ...admitted, createdAt: now.toISOString() },
					]);
					return {
						event: admitted,
						reason: parsed > maximum ? "normalized_completion" : "admitted",
					};
				});
				yield* host.log([
					{
						level: "debug",
						message: "Integration progress admission",
						attributes: {
							...attribution,
							entityId,
							claimKey,
							eventIndex,
							entitySchemaSlug,
							reason: decision.reason,
							itemIndex: group.itemIndex,
						},
					},
				]);
				if (decision.event) {
					events.push(decision.event);
				}
			}
			entityGroups.push({ ...group, events });
		}
		return { ...input, entityGroups };
	});
