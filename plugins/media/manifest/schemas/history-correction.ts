import type {
	AppSchema,
	AppStringPropertyReference,
} from "@ryot-app/contract/schema/property-schema";

const text = (label: string, reference?: AppStringPropertyReference) => ({
	label,
	description: label,
	type: "string" as const,
	...(reference ? { reference } : {}),
});
const entity = (label: string) => text(label, { required: true, kind: "entity-id" });
const event = (label: string) => text(label, { kind: "event-id" });
const integer = (label: string) => ({ label, description: label, type: "integer" as const });
const boolean = (label: string) => ({ label, description: label, type: "boolean" as const });
const choices = (label: string, values: readonly string[]) => ({
	label,
	description: label,
	type: "enum" as const,
	choices: { kind: "static" as const, values: values.map((value) => ({ value })) },
});
const schema = (fields: AppSchema["fields"], optional: readonly string[] = []): AppSchema => ({
	unknownKeys: "strict",
	fields: Object.fromEntries(
		Object.entries(fields).map(([key, definition]) => [
			key,
			{
				...definition,
				validation: {
					...definition.validation,
					...(optional.includes(key) ? {} : { required: true }),
				},
			},
		]),
	),
});

export const historyCorrectionEventSchemas = [
	{
		name: "History correction",
		slug: "history-correction",
		propertiesSchema: schema(
			{
				step: integer("Step"),
				cycle: integer("Cycle"),
				runKey: text("Run identity"),
				after: text("History cursor"),
				workKey: text("Work identity"),
				requestKey: text("Requested run"),
				evidenceAfter: text("Evidence cursor"),
				basisId: event("Completion occurrence"),
				closingEventId: event("Closing activity"),
				subjectEntityId: entity("History subject"),
				sourceRevision: integer("Source revision"),
				userRevision: integer("Owned data revision"),
				globalRevision: integer("Provider data revision"),
				coverageFinished: boolean("Final coverage record"),
				liveSourceIds: {
					type: "array",
					label: "New sources",
					description: "New sources",
					validation: { maxItems: 60 },
					items: event("New activity"),
				},
				phase: choices("Phase", [
					"audit",
					"progress",
					"prune",
					"coverage",
					"reset-snapshot",
					"snapshot",
					"publish",
					"clear",
					"sweep",
					"done",
				]),
			},
			[
				"after",
				"basisId",
				"closingEventId",
				"evidenceAfter",
				"globalRevision",
				"userRevision",
				"coverageFinished",
			],
		),
	},
	{
		name: "Completion occurrence",
		slug: "completion-occurrence",
		propertiesSchema: schema(
			{
				entityId: entity("Completed item"),
				sessionEntityId: entity("Session"),
				runKey: text("Last reconciliation"),
				silent: boolean("Silent correction"),
				sourceEventId: event("Progress source"),
				subjectEntityId: entity("History subject"),
				frozen: boolean("Retained completion evidence"),
				expectedOrderKey: text("Expected source order"),
				rule: choices("Rule", ["progress", "coverage"]),
				expectedDateUnknown: boolean("Expected unknown date"),
				expectedConsumedOn: text("Expected consumption source"),
				status: choices("Status", ["building", "active", "inactive", "suppressed", "overridden"]),
				total: {
					type: "number",
					label: "Positional total",
					description: "Total retained when the occurrence completed",
				},
				expectedOccurredAt: {
					type: "datetime",
					label: "Expected completion time",
					description: "Expected completion time",
				},
				expectedOrderCreatedAt: {
					type: "datetime",
					label: "Expected source creation time",
					description: "Expected source creation time",
				},
			},
			[
				"sourceEventId",
				"sessionEntityId",
				"expectedOccurredAt",
				"expectedConsumedOn",
				"expectedDateUnknown",
				"expectedOrderKey",
				"expectedOrderCreatedAt",
			],
		),
	},
	{
		slug: "completion-episode",
		name: "Completion episode evidence",
		propertiesSchema: schema(
			{
				episodeId: entity("Required episode"),
				subjectEntityId: entity("History subject"),
				sourceEventId: event("Supporting activity"),
				occurrenceId: event("Completion occurrence"),
			},
			["sourceEventId"],
		),
	},
	{
		name: "History coverage",
		slug: "history-coverage",
		propertiesSchema: schema(
			{
				cycle: integer("Cycle"),
				runKey: text("Reconciliation run"),
				episodeId: entity("Covered episode"),
				dateUnknown: boolean("Unknown date"),
				consumedOn: text("Consumption source"),
				subjectEntityId: entity("History subject"),
				sourceEventId: event("Supporting activity"),
			},
			["consumedOn", "dateUnknown"],
		),
	},
];
