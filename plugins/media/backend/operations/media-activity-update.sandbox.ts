import type { ScriptHost, UpdateEventItem } from "@ryot-app/plugin-backend-sdk/core";
import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";
import { Effect, type Schema } from "@ryot-app/plugin-backend-sdk/effect";
import { defineOperation, OperationRejectedError } from "@ryot-app/plugin-backend-sdk/operation";
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
	MediaActivityLogOutput,
	type MediaActivityPatch,
	MediaActivityUpdateInput,
} from "../../shared/media-activity-operations";
import { resolveEpisodeParentRecipe } from "../contracts/episode-parent-recipe";
import {
	activityCombinations,
	type EditTarget,
	loadEditTargets,
	rejectHostFailure,
	requireDeclaredProperties,
	writePrecondition,
} from "./media-activity-edits";

const reject = (message: string) => Effect.fail(new OperationRejectedError({ message: message }));

const FIELD_LABELS: Readonly<Record<string, string>> = {
	timeSpent: "Time spent",
	startedOn: "A start date",
	progressPercent: "Progress",
	dateUnknown: "An unknown date",
	consumedOn: "Where it was consumed",
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
			resolveEpisodeParentRecipe({ reference, episodeEntityId, config: showEpisodicKindConfig }),
		).pipe(Effect.map((resolution) => resolution?.parentEntityId));
	}
	return executeRyotqlRecipe(
		host.executeRyotql,
		resolveEpisodeParentRecipe({ reference, episodeEntityId, config: podcastEpisodicKindConfig }),
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
			return yield* reject("Only watch and listen records can move to another episode.");
		}
		if (episodeEntityId === currentEntityId) {
			return undefined;
		}
		const currentParent = yield* episodeParentId(host, target.entitySchemaSlug, currentEntityId);
		const nextParent = yield* episodeParentId(host, target.entitySchemaSlug, episodeEntityId);
		if (nextParent === undefined) {
			return yield* reject("That episode isn't available.");
		}
		if (nextParent !== currentParent) {
			return yield* reject(
				`Records can only move to another episode of the same ${
					target.entitySchemaSlug === "show-episode" ? "show" : "podcast"
				}.`,
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
				: reject(`${FIELD_LABELS[key] ?? "Progress"} can't be changed on this record.`);
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
				return yield* reject("Supply pages or percent, not both");
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
	output: MediaActivityLogOutput,
	input: MediaActivityUpdateInput,
	run: (input, host) =>
		Effect.gen(function* () {
			const [target] = yield* loadEditTargets(
				host,
				[input.eventId],
				activityCombinations,
				"Only activity records can be edited here.",
			);
			if (target === undefined) {
				return yield* reject("This record no longer exists.");
			}
			yield* requireDeclaredProperties(
				target,
				mediaActivityDeclaredProperties(target.entitySchemaSlug, target.eventSchemaSlug),
			);
			const patch = yield* buildPatch(host, target, input.expected.entityId, input.patch);
			if (Object.keys(patch).length === 0) {
				return yield* reject("Nothing to change on this record.");
			}
			const { count } = yield* host
				.updateEvents([{ patch, eventId: target.id, expected: writePrecondition(input.expected) }])
				.pipe(Effect.catch(rejectHostFailure));
			return { count, status: "saved" as const };
		}),
});
