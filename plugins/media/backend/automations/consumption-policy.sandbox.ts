import {
	type AutomationPolicyBatchInput,
	type AutomationPolicyInput,
	defineAutomationPolicy,
} from "@ryot-app/plugin-backend-sdk/automation";
import type { ScriptHost } from "@ryot-app/plugin-backend-sdk/core";
import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";
import { Effect, Result, Schema } from "@ryot-app/plugin-backend-sdk/effect";
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
import { jsonValueEquals } from "@ryot-app/plugin-kit/schema";

import { ConsumedItem, ConsumptionBasis, consumptionBasisFor } from "../../shared/consumption";

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
				"animeEpisode",
				"mangaChapter",
				"mangaVolume",
				"timeSpent",
				"completionKey",
				"sourceRun",
				"sourceProgress",
				"consumedItem",
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

const DAY_MS = 86_400_000;

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
	const item = Schema.decodeUnknownOption(ConsumedItem)(properties["consumedItem"]);
	if (item._tag === "Some" && item.value.volume !== undefined && item.value.unit !== "chapters") {
		return reject("Volume context belongs to a chapter occurrence");
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
			Date.parse(`${calendarDate}T00:00:00.000Z`) - Date.parse(draft.occurredAt.slice(0, 10)),
		) > DAY_MS
	) {
		return reject("A calendar date must be within one day of the occurrence time");
	}
	const progress = ["progressPages", "progressPercent", "animeEpisode", "mangaChapter"].filter(
		(key) => properties[key] !== undefined,
	);
	if (progress.length > 1) {
		return reject("Supply one cumulative progress quantity");
	}
	if (
		draft.eventSchemaSlug === "item-complete" &&
		(progress.length > 0 || properties["mangaVolume"] !== undefined)
	) {
		return reject("An item occurrence is not cumulative progress");
	}
	if (
		properties["progressPages"] !== undefined &&
		!["book", "comic-book"].includes(draft.entitySchemaSlug)
	) {
		return reject("Pages require a book or comic book");
	}
	const retained =
		payload.operation === "update" ? payload.before.properties["consumptionBasis"] : undefined;
	if (payload.operation === "update" && retained === undefined) {
		return reject("Recorded consumption basis is missing");
	}
	if (retained !== undefined) {
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
	if (properties["consumptionBasis"] !== undefined) {
		const basis = Schema.decodeUnknownOption(ConsumptionBasis)(properties["consumptionBasis"]);
		const expected = consumptionBasisFor(draft.entitySchemaSlug, {});
		if (
			basis._tag === "None" ||
			basis.value.unit !== expected.unit ||
			basis.value.property !== expected.property ||
			(expected.property === undefined && basis.value.total !== undefined)
		) {
			return reject("Invalid consumption estimation basis");
		}
		return { action: "allow" } as const;
	}
	if (properties["completionKey"] !== undefined) {
		return reject("Automatic completions require a consumption basis");
	}
	if (properties["sourceRun"] !== undefined) {
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
					set: { consumptionBasis: consumptionBasisFor(draft.entitySchemaSlug, target.properties) },
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
