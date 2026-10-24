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

import {
	ConsumedItem,
	ConsumptionBasis,
	consumptionBasisFor,
	ConsumptionCalendarDate,
	consumptionPropertiesEqual,
	SourceProgress,
} from "../../shared/consumption";

export const manifest = defineManifest({
	kind: "automation",
	automationType: "policy",
	slug: "policy.media-consumption",
	name: "Retain media consumption evidence",
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
	const sourceRun = properties["sourceRun"];
	if (
		sourceRun !== undefined &&
		(typeof sourceRun !== "string" || sourceRun.trim().length === 0 || sourceRun.length > 200)
	) {
		return reject("Invalid source run identity");
	}
	if (draft.eventSchemaSlug === "item-complete") {
		const item = Schema.decodeUnknownOption(ConsumedItem)(properties["consumedItem"]);
		if (item._tag === "None") {
			return reject("A consumed item is required");
		}
		if (draft.entitySchemaSlug === "anime") {
			if (
				item.value.unit !== "episodes" ||
				!Number.isInteger(item.value.position) ||
				item.value.volume !== undefined
			) {
				return reject("Invalid independent anime episode");
			}
		} else if (draft.entitySchemaSlug !== "manga" || item.value.unit === "episodes") {
			return reject("Invalid independent consumed item");
		}
		if (item.value.volume !== undefined && item.value.unit !== "chapters") {
			return reject("Volume context belongs to a chapter occurrence");
		}
	}
	if (
		properties["sourceProgress"] !== undefined &&
		!Schema.is(SourceProgress)(properties["sourceProgress"])
	) {
		return reject("Invalid original source progress");
	}
	if (
		payload.operation === "update" &&
		!consumptionPropertiesEqual(
			payload.before.properties["sourceProgress"],
			properties["sourceProgress"],
		)
	) {
		return reject("Original source progress is immutable");
	}
	if (
		payload.operation === "update" &&
		!consumptionPropertiesEqual(payload.before.properties["sourceRun"], properties["sourceRun"])
	) {
		return reject("The source run is immutable");
	}
	if (
		properties["calendarDate"] !== undefined &&
		(!Schema.is(ConsumptionCalendarDate)(properties["calendarDate"]) ||
			properties["dateUnknown"] === true)
	) {
		return reject("Invalid consumption calendar date");
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
		return reject("Recorded consumption evidence is missing");
	}
	if (retained !== undefined) {
		if (!consumptionPropertiesEqual(retained, properties["consumptionBasis"])) {
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
		return reject("Automatic completions require retained consumption evidence");
	}
	if (sourceRun !== undefined) {
		return reject("Imported source runs require retained consumption evidence");
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
