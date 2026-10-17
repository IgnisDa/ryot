import type { AutomationInput } from "@ryot-app/plugin-backend-sdk/automation";
import { defineAutomation } from "@ryot-app/plugin-backend-sdk/automation";
import type { ScriptHost } from "@ryot-app/plugin-backend-sdk/core";
import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";
import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import type { JsonValue } from "@ryot-app/plugin-backend-sdk/wire";

import {
	type EpisodicKindConfig,
	podcastEpisodicKindConfig,
	showEpisodicKindConfig,
} from "../../shared/lifecycle-expressions";
import {
	type EpisodicLifecycleSnapshot,
	type EventOrderTuple,
	readEpisodicLifecycleSnapshot,
} from "../contracts/lifecycle-recipes";

export const manifest = defineManifest({
	kind: "automation",
	automationType: "automation",
	name: "Auto-Complete Episodic Parent",
	slug: "automation.media-auto-complete-episodic-parent",
	inputProjection: {
		event: { properties: [], compareProperties: [] },
		signal: { properties: ["entitySchemaSlug", "oldStatus", "newStatus"] },
	},
});

export const PARENT_COMPLETION_CLAIM_TTL_SECONDS = 3600;

type AutomationHost = Pick<ScriptHost, "executeRyotql" | "createEvents" | "claimPersistentValue">;
type Payload = AutomationInput["automation"]["payload"];
type AutomationEventSnapshot = Extract<
	Extract<Payload, { resource: "event"; operation: "batch" }>["items"][number],
	{ operation: "create" }
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

const getCompletionTriggers = (source: Payload): ReadonlyArray<CompletionTrigger> => {
	if (source.resource === "event" && source.operation === "batch") {
		const latestByParent = new Map<
			string,
			CompletionTrigger & { event: AutomationEventSnapshot }
		>();
		for (const item of source.items) {
			if (item.operation !== "create") {
				continue;
			}
			const event = item.after;
			const config = configForEpisode(event.entitySchemaSlug);
			if (!config || event.eventSchemaSlug !== "complete" || !event.sessionEntityId) {
				continue;
			}
			const latest = latestByParent.get(event.sessionEntityId);
			if (!latest || compareEventOrder(event, latest.event) > 0) {
				latestByParent.set(event.sessionEntityId, {
					event,
					config,
					parentEntityId: event.sessionEntityId,
				});
			}
		}
		return [...latestByParent.values()];
	}

	if (source.resource !== "signal" || source.signalSchemaSlug !== "media.status.changed") {
		return [];
	}
	const entitySchemaSlug = stringProperty(source.properties, "entitySchemaSlug");
	const config = entitySchemaSlug === null ? null : configForParent(entitySchemaSlug);
	if (
		!config ||
		!source.subjectEntityId ||
		isTerminalProductionStatus(stringProperty(source.properties, "oldStatus")) ||
		!isTerminalProductionStatus(stringProperty(source.properties, "newStatus"))
	) {
		return [];
	}
	return [{ config, event: null, parentEntityId: source.subjectEntityId }];
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
		{ config: trigger.config, reference: { kind: "self" }, parentEntityId: trigger.parentEntityId },
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
					...(snapshot.agreedConsumedOn === null ? {} : { consumedOn: snapshot.agreedConsumedOn }),
					...(snapshot.allDatesUnknown ? { dateUnknown: true } : {}),
				},
			},
		])
		.pipe(Effect.as(null));
};

const completeParent = (host: AutomationHost, trigger: CompletionTrigger) =>
	Effect.gen(function* () {
		const initialSnapshot = yield* readSnapshot(host, trigger);
		if (!snapshotCanComplete(initialSnapshot, trigger)) {
			return;
		}

		const boundaryId = initialSnapshot.boundaryCompleteEvent?.id ?? "initial";
		const claim = yield* host.claimPersistentValue(
			`media-parent-completion:${trigger.parentEntityId}:${boundaryId}`,
			true,
			PARENT_COMPLETION_CLAIM_TTL_SECONDS,
		);
		if (!claim.claimed) {
			return;
		}

		const currentSnapshot = yield* readSnapshot(host, trigger);
		if (!snapshotCanComplete(currentSnapshot, trigger)) {
			return;
		}
		yield* createParentCompletion(host, trigger, currentSnapshot);
	});

export default defineAutomation({
	manifest,
	run: ({ automation }, host) =>
		Effect.forEach(
			getCompletionTriggers(automation.payload),
			(trigger) => completeParent(host, trigger),
			{ discard: true },
		).pipe(Effect.as(null)),
});
