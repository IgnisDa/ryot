import type { UpdateEventItem } from "@ryot-app/plugin-backend-sdk/core";
import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";
import { Effect, type Schema } from "@ryot-app/plugin-backend-sdk/effect";
import { defineOperation, OperationRejectedError } from "@ryot-app/plugin-backend-sdk/operation";

import {
	mediaActivityDeclaredProperties,
	mediaActivityPatchableProperties,
	mediaProgressPositionProperty,
	mediaProgressRuleError,
} from "../../shared/media-activity-fields";
import {
	MediaActivityLogOutput,
	type MediaActivityPatch,
	MediaActivityUpdateInput,
} from "../../shared/media-activity-operations";
import {
	activityCombinations,
	type EditTarget,
	loadEditTargets,
	rejectHostFailure,
	requireDeclaredProperties,
	writePrecondition,
} from "./media-activity-edits";

const reject = (message: string) => Effect.fail(new OperationRejectedError(message));

const FIELD_LABELS: Readonly<Record<string, string>> = {
	timeSpent: "Time spent",
	startedOn: "A start date",
	progressPercent: "Progress",
	dateUnknown: "An unknown date",
	consumedOn: "Where it was consumed",
};

type PropertiesPatch = { remove: string[]; set: Record<string, Schema.Json> };

const assign = (patch: PropertiesPatch, key: string, value: null | Schema.Json) => {
	if (value === null) {
		patch.remove.push(key);
	} else {
		patch.set[key] = value;
	}
};

/** Maps the edit onto the event, refusing any field its schema does not let an edit change. */
const buildPatch = (target: EditTarget, patch: MediaActivityPatch) =>
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
		let occurredAt: string | undefined;
		if (patch.when?.kind === "unknown") {
			yield* allow("dateUnknown");
			properties.set["dateUnknown"] = true;
			if (patchable.has("startedOn")) {
				properties.remove.push("startedOn");
			}
		}
		if (patch.when?.kind === "date") {
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
		}
		const position = mediaProgressPositionProperty(target.entitySchemaSlug);
		if (patch.position !== undefined && position !== undefined) {
			yield* allow(position);
			properties.set[position] = patch.position;
		}
		const hasProperties = properties.remove.length > 0 || Object.keys(properties.set).length > 0;
		return {
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
			const patch = yield* buildPatch(target, input.patch);
			if (Object.keys(patch).length === 0) {
				return yield* reject("Nothing to change on this record.");
			}
			const { count } = yield* host
				.updateEvents(
					[{ patch, eventId: target.id, expected: writePrecondition(input.expected) }],
					{ submittedAt: input.submittedAt, idempotencyKey: `${input.submissionId}:write` },
				)
				.pipe(Effect.catch(rejectHostFailure));
			return { count, status: "saved" as const };
		}),
});
