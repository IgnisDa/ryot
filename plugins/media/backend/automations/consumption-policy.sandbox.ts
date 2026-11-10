import {
	type AutomationPolicyBatchInput,
	type AutomationPolicyInput,
	defineAutomationPolicy,
} from "@ryot-app/plugin-backend-sdk/automation";
import type { ScriptHost } from "@ryot-app/plugin-backend-sdk/core";
import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";
import { DateTime, Effect, Result, Schema } from "@ryot-app/plugin-backend-sdk/effect";
import {
	and,
	ascending,
	column,
	defineRecipe,
	entitySchemaPredicate,
	eq,
	executeRyotqlRecipe,
	literal,
	selectedField,
	selectedOptionalRow,
	table,
} from "@ryot-app/plugin-backend-sdk/ryotql";
import { calendarDaysBetween, jsonValueEquals } from "@ryot-app/plugin-kit/schema";

import {
	CALENDAR_DATE_TOLERANCE_DAYS,
	ConsumptionBasis,
	consumptionBasisFor,
	consumptionBasisRule,
	hasStrayVolume,
	MediaPosition,
	SourceProgress,
} from "../../shared/consumption";

export const manifest = defineManifest({
	kind: "automation",
	automationType: "policy",
	slug: "policy.media-consumption",
	name: "Retain media consumption basis",
	inputProjection: {
		event: {
			properties: [
				"consumptionBasis",
				"calendarDate",
				"dateUnknown",
				"progressPages",
				"progressPercent",
				"position",
				"timeSpent",
				"completionKey",
				"sourceRun",
				"sourceProgress",
			],
		},
	},
});

const targetRecipe = defineRecipe(
	(input: { readonly entityId: string; readonly schemaSlug: string }) => {
		const entity = table("entity", "consumptionTarget");
		return {
			map: ({ target }) => Result.succeed(target),
			queries: {
				target: selectedOptionalRow(entity, {
					orderBy: [ascending(column(entity, "id"))],
					where: and(
						eq(column(entity, "id"), literal(input.entityId)),
						entitySchemaPredicate(entity, input.schemaSlug, { kind: "self" }),
					),
					selection: {
						properties: selectedField(
							column(entity, "properties"),
							Schema.Record(Schema.String, Schema.Json),
						),
					},
				}),
			},
		};
	},
);

const reject = (reason: string) => ({ reason, action: "reject" }) as const;

const decide = Effect.fn("retainConsumptionFacts")(function* (
	payload: AutomationPolicyInput["automation"]["payload"],
	host: Pick<ScriptHost, "executeRyotql">,
) {
	if (payload.resource !== "event" || payload.operation === "delete") {
		return { action: "allow" } as const;
	}
	const { draft } = payload;
	const properties = draft.properties;
	const position = Schema.decodeUnknownOption(MediaPosition)(properties["position"]);
	const sourceProgress = Schema.decodeUnknownOption(SourceProgress)(properties["sourceProgress"]);
	if (
		(position._tag === "Some" && hasStrayVolume(position.value)) ||
		(sourceProgress._tag === "Some" && hasStrayVolume(sourceProgress.value))
	) {
		return reject("Volume context belongs to a chapter position");
	}
	if (
		payload.operation === "update" &&
		!jsonValueEquals(payload.before.properties["sourceProgress"], properties["sourceProgress"])
	) {
		return reject("Original source progress is immutable");
	}
	if (
		payload.operation === "update" &&
		!jsonValueEquals(payload.before.properties["sourceRun"], properties["sourceRun"])
	) {
		return reject("The source run is immutable");
	}
	const calendarDate = properties["calendarDate"];
	if (calendarDate !== undefined && properties["dateUnknown"] === true) {
		return reject("A calendar date cannot be unknown");
	}
	if (
		typeof calendarDate === "string" &&
		Math.abs(
			calendarDaysBetween(
				DateTime.formatIsoDate(DateTime.makeUnsafe(draft.occurredAt)),
				calendarDate,
			),
		) > CALENDAR_DATE_TOLERANCE_DAYS
	) {
		return reject("A calendar date must be within one day of the occurrence time");
	}
	const item = draft.eventSchemaSlug === "item-complete";
	const progress = ["progressPages", "progressPercent", ...(item ? [] : ["position"])].filter(
		(key) => properties[key] !== undefined,
	);
	if (progress.length > 1) {
		return reject("Supply one cumulative progress quantity");
	}
	if (item && progress.length > 0) {
		return reject("An item occurrence is not cumulative progress");
	}
	if (
		properties["progressPages"] !== undefined &&
		!["book", "comic-book"].includes(draft.entitySchemaSlug)
	) {
		return reject("Pages require a book or comic book");
	}
	const runUnit = item || position._tag === "None" ? undefined : position.value.unit;
	const retained =
		payload.operation === "update" ? payload.before.properties["consumptionBasis"] : undefined;
	if (payload.operation === "update" && retained === undefined) {
		return reject("Recorded consumption basis is missing");
	}
	const retainedUnit = Schema.decodeUnknownOption(ConsumptionBasis)(retained);
	const unitChanged =
		runUnit !== undefined &&
		retainedUnit._tag === "Some" &&
		retainedUnit.value.unit !== consumptionBasisRule(draft.entitySchemaSlug, runUnit).unit;
	if (retained !== undefined && !unitChanged) {
		if (!jsonValueEquals(retained, properties["consumptionBasis"])) {
			return {
				action: "transform",
				patch: {
					resource: "event",
					draft: { properties: { remove: [], set: { consumptionBasis: retained } } },
				},
			} as const;
		}
		return { action: "allow" } as const;
	}
	if (properties["consumptionBasis"] !== undefined && !unitChanged) {
		const basis = Schema.decodeUnknownOption(ConsumptionBasis)(properties["consumptionBasis"]);
		const expected =
			runUnit === undefined
				? [
						consumptionBasisRule(draft.entitySchemaSlug),
						consumptionBasisRule(draft.entitySchemaSlug, "volumes"),
					]
				: [consumptionBasisRule(draft.entitySchemaSlug, runUnit)];
		if (
			basis._tag === "None" ||
			!expected.some(
				(rule) =>
					basis.value.unit === rule.unit &&
					basis.value.property === rule.property &&
					(rule.property !== undefined || basis.value.total === undefined),
			)
		) {
			return reject("Invalid consumption estimation basis");
		}
		return { action: "allow" } as const;
	}
	if (properties["completionKey"] !== undefined) {
		return reject("Automatic completions require a consumption basis");
	}
	if (properties["sourceRun"] !== undefined && !unitChanged) {
		return reject("Imported source runs require a consumption basis");
	}
	const target = yield* executeRyotqlRecipe(
		host.executeRyotql,
		targetRecipe({ entityId: draft.entityId, schemaSlug: draft.entitySchemaSlug }),
	);
	if (target === undefined) {
		return reject("Consumption target is unavailable");
	}
	return {
		action: "transform",
		patch: {
			resource: "event",
			draft: {
				properties: {
					remove: [],
					set: {
						consumptionBasis: consumptionBasisFor(
							draft.entitySchemaSlug,
							target.properties,
							runUnit,
						),
					},
				},
			},
		},
	} as const;
});

export default defineAutomationPolicy({
	manifest,
	run: ({ items }: AutomationPolicyBatchInput, host) =>
		Effect.forEach(items, ({ payload, itemIdentity }) =>
			decide(payload, host).pipe(Effect.map((decision) => ({ decision, itemIdentity }))),
		).pipe(Effect.map((decisions) => ({ items: decisions }))),
});
