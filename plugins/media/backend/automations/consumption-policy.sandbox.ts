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
	eq,
	executeRyotqlRecipe,
	parameters,
	schemaOwnerPredicate,
	selectedField,
	selectedOptionalRow,
	table,
} from "@ryot-app/plugin-backend-sdk/ryotql";
import type { LocalMessage } from "@ryot-app/plugin-kit/messages";
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
import { catalogMessage } from "../../shared/messages.generated";

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
const targetRecipe = (() => {
	const inputParameters = parameters({
		fields: {
			entityId: {
				type: "string",
				validation: { required: true },
				description: "entityId to read",
				label: catalogMessage("query-parameter.entity"),
			},
			schemaSlug: {
				type: "string",
				validation: { required: true },
				description: "schemaSlug to read",
				label: catalogMessage("query-parameter.media-type"),
			},
		},
	});
	const entity = table("entity", "consumptionTarget");
	return defineRecipe({
		parameters: inputParameters.schema,
		map: ({ target }) => Result.succeed(target),
		queries: {
			target: selectedOptionalRow(entity, {
				orderBy: [ascending(column(entity, "id"))],
				selection: {
					properties: selectedField(
						column(entity, "properties"),
						Schema.Record(Schema.String, Schema.Json),
					),
				},
				where: and(
					eq(column(entity, "id"), inputParameters.value("entityId")),
					and(
						schemaOwnerPredicate(entity, "entitySchemaPluginId", { kind: "self" }),
						eq(column(entity, "entitySchemaSlug"), inputParameters.value("schemaSlug")),
					),
				),
			}),
		},
	});
})();
const reject = (reason: LocalMessage) => ({ reason, action: "reject" }) as const;

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
		return reject(catalogMessage("rejection.position.volume-without-chapter"));
	}
	if (
		payload.operation === "update" &&
		!jsonValueEquals(payload.before.properties["sourceProgress"], properties["sourceProgress"])
	) {
		return reject(catalogMessage("rejection.consumption.source-progress-immutable"));
	}
	if (
		payload.operation === "update" &&
		!jsonValueEquals(payload.before.properties["sourceRun"], properties["sourceRun"])
	) {
		return reject(catalogMessage("rejection.consumption.source-run-immutable"));
	}
	const calendarDate = properties["calendarDate"];
	if (calendarDate !== undefined && properties["dateUnknown"] === true) {
		return reject(catalogMessage("rejection.consumption.date-unknown-conflict"));
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
		return reject(catalogMessage("rejection.consumption.date-out-of-range"));
	}
	const item = draft.eventSchemaSlug === "item-complete";
	const progress = ["progressPages", "progressPercent", ...(item ? [] : ["position"])].filter(
		(key) => properties[key] !== undefined,
	);
	if (progress.length > 1) {
		return reject(catalogMessage("rejection.consumption.multiple-progress"));
	}
	if (item && progress.length > 0) {
		return reject(catalogMessage("rejection.consumption.item-progress"));
	}
	if (
		properties["progressPages"] !== undefined &&
		!["book", "comic-book"].includes(draft.entitySchemaSlug)
	) {
		return reject(catalogMessage("rejection.consumption.pages-unsupported"));
	}
	const runUnit = item || position._tag === "None" ? undefined : position.value.unit;
	const retained =
		payload.operation === "update" ? payload.before.properties["consumptionBasis"] : undefined;
	if (payload.operation === "update" && retained === undefined) {
		return reject(catalogMessage("rejection.consumption.basis-missing"));
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
			return reject(catalogMessage("rejection.consumption.basis-invalid"));
		}
		return { action: "allow" } as const;
	}
	if (properties["completionKey"] !== undefined) {
		return reject(catalogMessage("rejection.consumption.basis-required-for-completion"));
	}
	if (properties["sourceRun"] !== undefined && !unitChanged) {
		return reject(catalogMessage("rejection.consumption.basis-required-for-import"));
	}
	const target = yield* executeRyotqlRecipe(host.executeRyotql, targetRecipe, {
		entityId: draft.entityId,
		schemaSlug: draft.entitySchemaSlug,
	});
	if (target === undefined) {
		return reject(catalogMessage("rejection.activity.entity-not-found"));
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
