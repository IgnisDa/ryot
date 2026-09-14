import type { AutomationOccurrenceSource } from "@ryot-app/sandbox-sdk/automation";
import { defineAutomation } from "@ryot-app/sandbox-sdk/automation";
import type { EventSchemaRecord, SandboxHost } from "@ryot-app/sandbox-sdk/core";
import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { Effect } from "@ryot-app/sandbox-sdk/effect";
import { automationOccurrenceRecipe, executeRyotqlRecipe } from "@ryot-app/sandbox-sdk/ryotql";
import type { JsonValue } from "@ryot-app/sandbox-sdk/wire";

import {
	showEpisodicKindConfig,
	type EpisodicKindConfig,
} from "../../shared/lifecycle-expressions";
import {
	podcastEpisodicKindConfig,
	readEpisodicLifecycleSnapshot,
	type EpisodicLifecycleSnapshot,
	type EventOrderTuple,
} from "../contracts/lifecycle-recipes";

export const manifest = defineManifest({
	kind: "automation",
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
	name: "Auto-Complete Episodic Parent",
	slug: "automation.media-auto-complete-episodic-parent",
	capabilities: ["executeRyotql", "createEvents", "listEventSchemas", "claimPersistentValue"],
});

export const PARENT_COMPLETION_CLAIM_TTL_SECONDS = 3600;

type AutomationHost = SandboxHost<typeof manifest.capabilities>;
type AutomationEventSnapshot = NonNullable<
	Extract<AutomationOccurrenceSource, { readonly kind: "event" }>["after"]
>;
type CompletionTrigger = {
	readonly parentEntityId: string;
	readonly config: EpisodicKindConfig;
	readonly event: AutomationEventSnapshot | null;
};

const terminalProductionStatuses = new Set(["ended", "canceled", "cancelled"]);

const productionStatus = (properties: Readonly<Record<string, JsonValue>>) => {
	const value = properties["productionStatus"];
	return typeof value === "string" ? value : null;
};

const isTerminalProductionStatus = (value: string | null) =>
	value !== null && terminalProductionStatuses.has(value.trim().toLowerCase());

const compareEventOrder = (left: EventOrderTuple, right: EventOrderTuple) => {
	const occurredAtDifference = Date.parse(left.occurredAt) - Date.parse(right.occurredAt);
	if (occurredAtDifference !== 0) {
		return occurredAtDifference;
	}
	const createdAtDifference = Date.parse(left.createdAt) - Date.parse(right.createdAt);
	if (createdAtDifference !== 0) {
		return createdAtDifference;
	}
	if (left.id === right.id) {
		return 0;
	}
	return left.id < right.id ? -1 : 1;
};

const configForParent = (entitySchemaSlug: string) => {
	if (entitySchemaSlug === "show") {
		return showEpisodicKindConfig;
	}
	return entitySchemaSlug === "podcast" ? podcastEpisodicKindConfig : null;
};

const configForEpisode = (entitySchemaSlug: string) => {
	if (entitySchemaSlug === "show-episode") {
		return showEpisodicKindConfig;
	}
	return entitySchemaSlug === "podcast-episode" ? podcastEpisodicKindConfig : null;
};

const getCompletionTrigger = (
	operation: "create" | "update" | "delete" | "signal",
	source: AutomationOccurrenceSource,
): CompletionTrigger | null => {
	if (source.kind === "event") {
		const event = source.after;
		const config = event ? configForEpisode(event.subject.entitySchemaSlug) : null;
		if (
			operation !== "create" ||
			!event ||
			!config ||
			event.eventSchemaSlug !== "complete" ||
			!event.sessionEntityId
		) {
			return null;
		}
		return { event, config, parentEntityId: event.sessionEntityId };
	}

	if (source.kind !== "entity" || operation !== "update") {
		return null;
	}
	const before = source.before;
	const after = source.after;
	const config = after ? configForParent(after.entitySchemaSlug) : null;
	if (!before || !after || !config) {
		return null;
	}
	const beforeStatus = productionStatus(before.properties);
	const afterStatus = productionStatus(after.properties);
	if (isTerminalProductionStatus(beforeStatus) || !isTerminalProductionStatus(afterStatus)) {
		return null;
	}
	return { config, event: null, parentEntityId: after.id };
};

const snapshotCanComplete = (
	snapshot: EpisodicLifecycleSnapshot | null,
	trigger: CompletionTrigger,
): snapshot is EpisodicLifecycleSnapshot & { readonly coverageClosingEvent: EventOrderTuple } => {
	if (
		!snapshot ||
		snapshot.parentEntityId !== trigger.parentEntityId ||
		snapshot.state !== "caught_up" ||
		!snapshot.coverageComplete ||
		!snapshot.coverageClosingEvent ||
		!isTerminalProductionStatus(snapshot.productionStatus)
	) {
		return false;
	}
	return (
		trigger.event === null ||
		snapshot.boundaryCompleteEvent === null ||
		compareEventOrder(trigger.event, snapshot.boundaryCompleteEvent) > 0
	);
};

const readSnapshot = (host: AutomationHost, trigger: CompletionTrigger) =>
	readEpisodicLifecycleSnapshot(
		{ config: trigger.config, parentEntityId: trigger.parentEntityId },
		host.executeRyotql,
	);

const getCompleteSchema = (host: AutomationHost, config: EpisodicKindConfig) =>
	host
		.listEventSchemas([config.parentSchemaSlug])
		.pipe(
			Effect.map(
				(schemas): EventSchemaRecord | null =>
					schemas.find(
						(schema) =>
							schema.slug === "complete" && schema.entitySchemaSlug === config.parentSchemaSlug,
					) ?? null,
			),
		);

const createParentCompletion = (
	host: AutomationHost,
	trigger: CompletionTrigger,
	snapshot: EpisodicLifecycleSnapshot & { readonly coverageClosingEvent: EventOrderTuple },
	completeSchema: EventSchemaRecord,
) => {
	const occurredAt = snapshot.coverageClosingEvent.occurredAt;
	return host
		.createEvents([
			{
				occurredAt,
				entityId: trigger.parentEntityId,
				eventSchemaSlug: completeSchema.id,
				sessionEntityId: trigger.parentEntityId,
				properties: {
					completedOn: occurredAt,
					completionMode: "custom_timestamps",
					...(snapshot.agreedConsumedOn === null ? {} : { consumedOn: snapshot.agreedConsumedOn }),
				},
			},
		])
		.pipe(Effect.as(null));
};

export default defineAutomation({
	manifest,
	run: ({ automation }, host) => {
		if (automation.source.kind !== "event" && automation.source.kind !== "entity") {
			return Effect.succeed(null);
		}
		return Effect.gen(function* () {
			const occurrence = yield* executeRyotqlRecipe(
				host.executeRyotql,
				automationOccurrenceRecipe(automation.occurrenceId),
			);
			const trigger = occurrence
				? getCompletionTrigger(automation.operation, occurrence.source)
				: null;
			if (!trigger) {
				return null;
			}
			const initialSnapshot = yield* readSnapshot(host, trigger);
			if (!snapshotCanComplete(initialSnapshot, trigger)) {
				return null;
			}

			const boundaryId = initialSnapshot.boundaryCompleteEventId ?? "initial";
			const claim = yield* host.claimPersistentValue(
				`media-parent-completion:${trigger.parentEntityId}:${boundaryId}`,
				true,
				PARENT_COMPLETION_CLAIM_TTL_SECONDS,
			);
			if (!claim.claimed) {
				return null;
			}

			const currentSnapshot = yield* readSnapshot(host, trigger);
			if (!snapshotCanComplete(currentSnapshot, trigger)) {
				return null;
			}
			const completeSchema = yield* getCompleteSchema(host, trigger.config);
			return completeSchema
				? yield* createParentCompletion(host, trigger, currentSnapshot, completeSchema)
				: null;
		});
	},
});
