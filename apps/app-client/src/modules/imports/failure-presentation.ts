import type { ImportRunFailureStage } from "@ryot/contract/modules/imports/types";
import type { ImportRunFailure } from "@ryot/ryotql-recipes/import-runs";
import { Match } from "effect";

export type ImportFailureGroup = {
	readonly pill: string;
	readonly heading: string;
	readonly stage: ImportRunFailureStage;
	readonly failures: readonly ImportRunFailure[];
};

const stagePresentation = {
	source_fetch: { pill: "Unreachable", heading: "Source unavailable" },
	database_commit: { pill: "Not saved", heading: "Couldn't be saved" },
	input_transformation: { pill: "Not read", heading: "Couldn't be read" },
	provider_details: { pill: "No details", heading: "Details unavailable" },
	event_policy: { pill: "Blocked", heading: "Blocked by one of your rules" },
	provider_resolution: { pill: "Not matched", heading: "Couldn't be matched" },
} as const satisfies Record<ImportRunFailureStage, { pill: string; heading: string }>;

const stageOrder = [
	"input_transformation",
	"provider_resolution",
	"provider_details",
	"event_policy",
	"database_commit",
	"source_fetch",
] as const satisfies readonly ImportRunFailureStage[];

const trimmed = (value: string | null) => {
	const text = value?.trim() ?? "";
	return text.length === 0 ? undefined : text;
};

export const importFailureStagePill = (stage: ImportRunFailureStage) =>
	stagePresentation[stage].pill;

export const importFailureStageHeading = (stage: ImportRunFailureStage) =>
	stagePresentation[stage].heading;

export const importFailureRowLabel = (
	failure: Pick<ImportRunFailure, "itemIndex" | "sourceLabel" | "sourceIdentifier">,
) =>
	trimmed(failure.sourceLabel) ?? trimmed(failure.sourceIdentifier) ?? `Item #${failure.itemIndex}`;

export const importFailureReasonDetail = (failure: ImportRunFailure) =>
	Match.value(failure.reason).pipe(
		Match.when({ code: "source-fetch-failed" }, () => "The source could not be read."),
		Match.when({ code: "input-transformation-failed" }, () => "The source data could not be read."),
		Match.when(
			{ code: "provider-resolution-failed" },
			() => "No matching provider item was found.",
		),
		Match.when({ code: "provider-details-failed" }, () => "Provider details were unavailable."),
		Match.when({ code: "event-policy-failed" }, () => "One of your rules blocked this item."),
		Match.when({ code: "database-commit-failed" }, () => "This item could not be saved."),
		Match.when({ code: "integration-not-found" }, () => "The integration was unavailable."),
		Match.when({ code: "integration-disabled" }, () => "The integration was paused."),
		Match.when({ code: "integrations-disabled" }, () => "Integrations were paused."),
		Match.when({ code: "pro-key-required" }, () => "Ryot Pro is required for this integration."),
		Match.when({ code: "queue-unavailable" }, () => "The work could not be started."),
		Match.when({ code: "unexpected-failure" }, () => "The import stopped unexpectedly."),
		Match.exhaustive,
	);

export const importFailureProvenanceEntries = (failure: ImportRunFailure) =>
	[
		["Source ID", failure.sourceIdentifier],
		["Entity schema", failure.entitySchemaSlug],
		["Event schema", failure.eventSchemaSlug],
	]
		.filter((entry): entry is [string, string] => entry[1] !== null)
		.map(([key, value]) => ({ key, value }));

export const groupImportFailuresByStage = (
	failures: readonly ImportRunFailure[],
): readonly ImportFailureGroup[] =>
	stageOrder.flatMap((stage) => {
		const grouped = failures.filter((failure) => failure.stage === stage);
		return grouped.length === 0
			? []
			: [
					{
						stage,
						failures: grouped,
						pill: importFailureStagePill(stage),
						heading: importFailureStageHeading(stage),
					},
				];
	});

export const buildImportFailureClipboardText = (input: {
	readonly runId: string;
	readonly sourceName: string;
	readonly failures: readonly ImportRunFailure[];
}) => {
	const lines = [
		"Ryot import failures",
		`Source: ${input.sourceName}`,
		`Run: ${input.runId}`,
		`Failures listed: ${input.failures.length}`,
	];
	for (const group of groupImportFailuresByStage(input.failures)) {
		lines.push("", `${group.heading} (${group.stage})`);
		for (const failure of group.failures) {
			lines.push(`- ${importFailureRowLabel(failure)}: ${importFailureReasonDetail(failure)}`);
			for (const entry of importFailureProvenanceEntries(failure)) {
				lines.push(`    ${entry.key}: ${entry.value}`);
			}
		}
	}
	return lines.join("\n");
};
