import type { AutomationInput } from "@ryot-app/sandbox-sdk/automation";
import { defineAutomation } from "@ryot-app/sandbox-sdk/automation";
import type { SandboxHost } from "@ryot-app/sandbox-sdk/core";
import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { Effect } from "@ryot-app/sandbox-sdk/effect";
import type { JsonValue } from "@ryot-app/sandbox-sdk/wire";

import {
	podcastEpisodicKindConfig,
	showEpisodicKindConfig,
	type EpisodicKindConfig,
} from "../../shared/lifecycle-expressions";
import {
	readEpisodicLifecycleSnapshot,
	type EpisodicLifecycleSnapshot,
	type EventOrderTuple,
} from "../contracts/lifecycle-recipes";

export const manifest = defineManifest({
	kind: "automation",
	automationType: "automation",
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
	name: "Auto-Complete Episodic Parent",
	slug: "automation.media-auto-complete-episodic-parent",
	capabilities: ["executeRyotql", "createEvents", "claimPersistentValue"],
	inputProjection: {
		event: { properties: [], compareProperties: [] },
		signal: { properties: ["entitySchemaSlug", "oldStatus", "newStatus"] },
	},
});

export const PARENT_COMPLETION_CLAIM_TTL_SECONDS = 3600;

type AutomationHost = SandboxHost<typeof manifest.capabilities>;
type Payload = AutomationInput["automation"]["payload"];
type AutomationEventSnapshot = Extract<
	Payload,
	{ resource: "event"; operation: "create"; category: "change" }
>["after"];
type CompletionTrigger = {
	readonly parentEntityId: string;
	readonly config: EpisodicKindConfig;
	readonly event: AutomationEventSnapshot | null;
};

const terminalProductionStatuses = new Set(["ended", "canceled", "cancelled"]);

const stringProperty = (properties: Readonly<Record<string, JsonValue>>, key: string) => {
	const value = properties[key];
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

const getCompletionTrigger = (source: Payload): CompletionTrigger | null => {
	if (
		source.category === "change" &&
		source.resource === "event" &&
		source.operation === "create"
	) {
		const event = source.after;
		const config = configForEpisode(event.entitySchemaSlug);
		if (!config || event.eventSchemaSlug !== "complete" || !event.sessionEntityId) {
			return null;
		}
		return { event, config, parentEntityId: event.sessionEntityId };
	}

	if (source.resource !== "signal" || source.signalSchemaSlug !== "media.status.changed") {
		return null;
	}
	const entitySchemaSlug = stringProperty(source.properties, "entitySchemaSlug");
	const config = entitySchemaSlug === null ? null : configForParent(entitySchemaSlug);
	if (
		!config ||
		!source.subjectEntityId ||
		isTerminalProductionStatus(stringProperty(source.properties, "oldStatus")) ||
		!isTerminalProductionStatus(stringProperty(source.properties, "newStatus"))
	) {
		return null;
	}
	return { config, event: null, parentEntityId: source.subjectEntityId };
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

const createParentCompletion = (
	host: AutomationHost,
	trigger: CompletionTrigger,
	snapshot: EpisodicLifecycleSnapshot & { readonly coverageClosingEvent: EventOrderTuple },
) => {
	const occurredAt = snapshot.coverageClosingEvent.occurredAt;
	return host
		.createEvents([
			{
				occurredAt,
				eventSchemaSlug: "complete",
				entityId: trigger.parentEntityId,
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
		return Effect.gen(function* () {
			const trigger = getCompletionTrigger(automation.payload);
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
			return yield* createParentCompletion(host, trigger, currentSnapshot);
		});
	},
});
