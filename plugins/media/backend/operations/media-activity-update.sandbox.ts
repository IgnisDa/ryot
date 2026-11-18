import type { ScriptHost, UpdateEventItem } from "@ryot-app/plugin-backend-sdk/core";
import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";
import { Effect, type Schema } from "@ryot-app/plugin-backend-sdk/effect";
import { defineOperation } from "@ryot-app/plugin-backend-sdk/operation";
import { executeRyotqlRecipe } from "@ryot-app/plugin-backend-sdk/ryotql";

import { mediaPositionError } from "../../shared/consumption";
import {
	podcastEpisodicKindConfig,
	showEpisodicKindConfig,
} from "../../shared/lifecycle-expressions";
import {
	mediaActivityDeclaredProperties,
	mediaActivityPatchableProperties,
	mediaProgressRuleError,
} from "../../shared/media-activity-fields";
import {
	MediaActivityEditOutput,
	type MediaActivityPatch,
	MediaActivityUpdateInput,
} from "../../shared/media-activity-operations";
import { catalogMessage } from "../../shared/messages.generated";
import { resolveEpisodeParentRecipe } from "../contracts/episode-parent-recipe";
import { reject } from "../lib/failures";
import {
	activityCombinations,
	type EditTarget,
	loadEditTargets,
	rejectHostFailure,
	requireDeclaredProperties,
	writePrecondition,
} from "./media-activity-edits";
import { reviewsNamingConsumption } from "./media-review-consumption";

const lockedField = (key: string) => {
	switch (key) {
		case "timeSpent":
		case "startedOn":
		case "consumedOn":
		case "dateUnknown":
			return key;
		default:
			return "progress";
	}
};

const episodeParentId = (
	host: Pick<ScriptHost, "executeRyotql">,
	entitySchemaSlug: string,
	episodeEntityId: string,
) => {
	const reference = { kind: "self" } as const;
	if (entitySchemaSlug === "show-episode") {
		return executeRyotqlRecipe(
			host.executeRyotql,
			resolveEpisodeParentRecipe({ reference: reference, config: showEpisodicKindConfig }),
			{ episodeEntityId },
		).pipe(Effect.map((resolution) => resolution?.parentEntityId));
	}
	return executeRyotqlRecipe(
		host.executeRyotql,
		resolveEpisodeParentRecipe({ reference: reference, config: podcastEpisodicKindConfig }),
		{ episodeEntityId },
	).pipe(Effect.map((resolution) => resolution?.parentEntityId));
};

/** The episode an edit moves the event to, or `undefined` when the event stays where it is. */
const retargetedEpisode = (
	host: Pick<ScriptHost, "executeRyotql">,
	target: EditTarget,
	currentEntityId: string,
	episodeEntityId: string,
) =>
	Effect.gen(function* () {
		const episodic =
			target.entitySchemaSlug === "show-episode" || target.entitySchemaSlug === "podcast-episode";
		if (
			!episodic ||
			(target.eventSchemaSlug !== "complete" && target.eventSchemaSlug !== "progress")
		) {
			return yield* reject(catalogMessage("rejection.activity.episode-move-unsupported"));
		}
		if (episodeEntityId === currentEntityId) {
			return undefined;
		}
		const currentParent = yield* episodeParentId(host, target.entitySchemaSlug, currentEntityId);
		const nextParent = yield* episodeParentId(host, target.entitySchemaSlug, episodeEntityId);
		if (nextParent === undefined) {
			return yield* reject(catalogMessage("rejection.activity.episode-unavailable"));
		}
		if (nextParent !== currentParent) {
			return yield* reject(
				catalogMessage("rejection.activity.episode-move-other-parent", {
					parent: target.entitySchemaSlug === "show-episode" ? "show" : "podcast",
				}),
			);
		}
		return episodeEntityId;
	});

type PropertiesPatch = { remove: string[]; set: Record<string, Schema.Json> };

const assign = (patch: PropertiesPatch, key: string, value: null | Schema.Json) => {
	if (value === null) {
		patch.remove.push(key);
	} else {
		patch.set[key] = value;
	}
};

/** Maps the edit onto the event, refusing any field its schema does not let an edit change. */
const buildPatch = (
	host: Pick<ScriptHost, "executeRyotql">,
	target: EditTarget,
	currentEntityId: string,
	patch: MediaActivityPatch,
) =>
	Effect.gen(function* () {
		const patchable = new Set(
			mediaActivityPatchableProperties(target.entitySchemaSlug, target.eventSchemaSlug),
		);
		const allow = (key: string) =>
			patchable.has(key)
				? Effect.void
				: reject(catalogMessage("rejection.activity.field-locked", { field: lockedField(key) }));
		const progressError = mediaProgressRuleError(
			target.entitySchemaSlug,
			{ position: patch.position !== undefined, percent: patch.progressPercent !== undefined },
			false,
		);
		if (progressError !== undefined) {
			return yield* reject(progressError);
		}
		const properties: PropertiesPatch = { set: {}, remove: [] };
		const entityId =
			patch.episodeEntityId === undefined
				? undefined
				: yield* retargetedEpisode(host, target, currentEntityId, patch.episodeEntityId);
		if (patch.position !== undefined) {
			yield* allow("position");
			const positionError = mediaPositionError(target.entitySchemaSlug, patch.position);
			if (positionError !== undefined) {
				return yield* reject(positionError);
			}
			properties.set["position"] = patch.position;
		}
		let occurredAt: string | undefined;
		if (patch.when?.kind === "unknown") {
			yield* allow("dateUnknown");
			properties.set["dateUnknown"] = true;
			properties.remove.push("calendarDate");
			if (patchable.has("startedOn")) {
				properties.remove.push("startedOn");
			}
		}
		if (patch.when?.kind === "date") {
			if (patch.when.calendarDate === undefined) {
				if (patchable.has("calendarDate")) {
					properties.remove.push("calendarDate");
				}
			} else {
				yield* allow("calendarDate");
				properties.set["calendarDate"] = patch.when.calendarDate;
			}
			occurredAt = patch.when.finishedOn;
			if (patch.when.startedOn !== undefined) {
				yield* allow("startedOn");
				properties.set["startedOn"] = patch.when.startedOn;
			} else if (patchable.has("startedOn")) {
				properties.remove.push("startedOn");
			}
			if (patchable.has("dateUnknown")) {
				properties.remove.push("dateUnknown");
			}
		}
		if (patch.consumedOn !== undefined) {
			yield* allow("consumedOn");
			assign(properties, "consumedOn", patch.consumedOn);
		}
		if (patch.timeSpent !== undefined) {
			yield* allow("timeSpent");
			assign(properties, "timeSpent", patch.timeSpent);
		}
		if (patch.progressPercent !== undefined) {
			yield* allow("progressPercent");
			assign(properties, "progressPercent", patch.progressPercent);
			if (patch.progressPercent !== null && patchable.has("progressPages")) {
				properties.remove.push("progressPages");
			}
		}
		if (patch.progressPages !== undefined) {
			yield* allow("progressPages");
			if (patch.progressPages !== null && patch.progressPercent != null) {
				return yield* reject(catalogMessage("rejection.activity.pages-and-percent"));
			}
			assign(properties, "progressPages", patch.progressPages);
			if (patch.progressPages !== null) {
				properties.remove.push("progressPercent");
			}
		}
		const hasProperties = properties.remove.length > 0 || Object.keys(properties.set).length > 0;
		return {
			...(entityId === undefined ? {} : { entityId }),
			...(occurredAt === undefined ? {} : { occurredAt }),
			...(hasProperties ? { properties } : {}),
		} satisfies UpdateEventItem["patch"];
	});

export const manifest = defineManifest({
	kind: "operation",
	name: "Update media activity",
	slug: "operation.media-activity-update",
});

export default defineOperation({
	manifest,
	output: MediaActivityEditOutput,
	input: MediaActivityUpdateInput,
	run: (input, host) =>
		Effect.gen(function* () {
			const [target] = yield* loadEditTargets(
				host,
				[input.eventId],
				activityCombinations,
				catalogMessage("rejection.record.activity-only-edit"),
			);
			if (target === undefined) {
				return yield* reject(catalogMessage("rejection.record.not-found"));
			}
			yield* requireDeclaredProperties(
				target,
				mediaActivityDeclaredProperties(target.entitySchemaSlug, target.eventSchemaSlug),
			);
			const patch = yield* buildPatch(host, target, input.expected.entityId, input.patch);
			if (Object.keys(patch).length === 0) {
				return yield* reject(catalogMessage("rejection.activity.nothing-to-change"));
			}
			const unlinked =
				patch.entityId === undefined ? [] : yield* reviewsNamingConsumption(host, target.id);
			const { count } = yield* host
				.updateEvents([
					{ patch, eventId: target.id, expected: writePrecondition(input.expected) },
					...unlinked.map((eventId) => ({
						eventId,
						patch: { properties: { set: {}, remove: ["consumptionEventId"] } },
					})),
				])
				.pipe(Effect.catch(rejectHostFailure));
			return { status: "saved" as const, count: count - unlinked.length };
		}).pipe(Effect.map((output) => ({ output }))),
});
