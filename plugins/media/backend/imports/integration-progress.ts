import type { ScriptHost } from "@ryot-app/plugin-backend-sdk/core";
import { DateTime, Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";
import { eventReadRecipe, executeRyotqlRecipe } from "@ryot-app/plugin-backend-sdk/ryotql";
import type { JsonValue } from "@ryot-app/plugin-backend-sdk/wire";

import { isPositional, positionalProperties } from "../../shared/media-schema-slugs";
import { MediaSandboxError } from "../lib/failures";
import { eventTimestamp, jsonObject } from "../lib/records";
import type { MediaProgressEvent } from "../lib/ryotql";
import type { MediaImportWriteChunkInput } from "./schemas";

type Properties = Readonly<Record<string, JsonValue>>;
type ProgressEvent = Pick<MediaProgressEvent, "createdAt" | "properties" | "occurredAt">;
type Host = Pick<ScriptHost, "log" | "executeRyotql" | "getPluginConfig" | "getCurrentIntegration">;
const encodeProgressIdentity = Schema.encodeSync(
	Schema.fromJsonString(Schema.Array(Schema.String)),
);

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

const progressPosition = (entitySchemaSlug: string, properties: Properties) => {
	if (!isPositional(entitySchemaSlug)) {
		return null;
	}
	return parseProgressPercent(properties[positionalProperties[entitySchemaSlug].position]);
};

const consumedOnValue = (properties: Properties) =>
	typeof properties["consumedOn"] === "string" ? properties["consumedOn"] : "";

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
					return yield* new MediaSandboxError({
						message: "Integration progress subject is missing its resolved schema",
					});
				}
				const entitySchemaSlug = event.subjectEntitySchemaSlug ?? group.entityRef.entitySchemaSlug;
				const identity = [
					entityId,
					entitySchemaSlug,
					event.eventSchemaSlug,
					consumedOnValue(event.properties),
				];
				const fingerprint = encodeProgressIdentity(identity);
				const claimKey = encodeProgressIdentity([
					"media.integration-progress.v1",
					attribution.integrationId,
					...identity,
				]);
				const decideProgress = Effect.fnUntraced(function* decideProgress() {
					const parsed = parseProgressPercent(event.properties["progressPercent"]);
					const position = progressPosition(entitySchemaSlug, event.properties);
					if (parsed === null && position === null) {
						return { reason: "invalid_progress" };
					}
					const integration = yield* host.getCurrentIntegration();
					const minimum = toFiniteNumber(integration.minimumProgress) ?? 0;
					const maximum = toFiniteNumber(integration.maximumProgress) ?? 100;
					if (parsed !== null && parsed < minimum) {
						return { reason: "below_minimum_progress" };
					}
					const progressPercent = parsed !== null && parsed > maximum ? 100 : parsed;
					const { items } = yield* executeRyotqlRecipe(
						host.executeRyotql,
						eventReadRecipe({
							entityId,
							entitySchemaSlug,
							owner: { kind: "self" },
							eventSchemaSlug: "progress",
						}),
					);
					const matchingEvents = [
						...items.filter((item) => {
							const properties = jsonObject(item.properties);
							return (
								properties !== null &&
								consumedOnValue(properties) === consumedOnValue(event.properties)
							);
						}),
						...(pending.get(fingerprint) ?? []),
					].sort(sortLatestFirst);
					const comparable = (item: ProgressEvent) => {
						const properties = jsonObject(item.properties);
						if (properties === null) {
							return null;
						}
						return position === null
							? parseProgressPercent(properties["progressPercent"])
							: progressPosition(entitySchemaSlug, properties);
					};
					const latestComparable = matchingEvents.map(comparable).find((value) => value !== null);
					if (latestComparable === (position ?? progressPercent)) {
						return { reason: "duplicate_progress" };
					}
					const now = yield* DateTime.nowAsDate;
					if (progressPercent !== null && progressPercent >= 100) {
						const config = yield* host.getPluginConfig({
							optional: ["progressUpdateThresholdHours"],
						});
						const hours = toFiniteNumber(config["progressUpdateThresholdHours"]);
						const thresholdSeconds = hours !== null && hours > 0 ? Math.round(hours * 3600) : 7200;
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
					const admitted =
						parsed !== null && parsed > maximum
							? { ...event, properties: { ...event.properties, progressPercent: 100 } }
							: event;
					pending.set(fingerprint, [
						...(pending.get(fingerprint) ?? []),
						{ ...admitted, createdAt: now.toISOString() },
					]);
					return {
						event: admitted,
						reason: parsed !== null && parsed > maximum ? "normalized_completion" : "admitted",
					};
				});
				const decision = yield* decideProgress();
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
