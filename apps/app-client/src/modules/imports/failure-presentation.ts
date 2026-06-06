import type { ImportRunFailureStage } from "@ryot/contract/modules/imports/types";
import type { ImportRunFailure } from "@ryot/ryotql-recipes/import-runs";

export type ImportFailureGroup = {
	readonly pill: string;
	readonly heading: string;
	readonly stage: ImportRunFailureStage;
	readonly failures: readonly ImportRunFailure[];
};

export type ImportFailureContextEntry = { readonly key: string; readonly value: string };

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

export const importFailureContextEntries = (
	context: Record<string, unknown> | null,
): readonly ImportFailureContextEntry[] => {
	if (context === null) {
		return [];
	}
	return Object.entries(context)
		.map(([key, value]) => ({ key, value: formatContextValue(value) }))
		.sort((left, right) => left.key.localeCompare(right.key));
};

function formatContextValue(value: unknown) {
	if (value === null || value === undefined) {
		return "—";
	}
	if (typeof value === "string") {
		return value;
	}
	if (typeof value === "number" || typeof value === "boolean") {
		return String(value);
	}
	return JSON.stringify(value);
}

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
			lines.push(`- ${importFailureRowLabel(failure)}: ${failure.message}`);
			for (const entry of importFailureContextEntries(failure.context)) {
				lines.push(`    ${entry.key}: ${entry.value}`);
			}
		}
	}
	return lines.join("\n");
};
