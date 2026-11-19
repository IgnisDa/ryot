import type { LifecycleCommand } from "@ryot-app/contract/modules/automations/lifecycle";
import type {
	IngestionOutcome,
	IngestionSummary,
} from "@ryot-app/contract/modules/imports/ingestion";
import type { GenericImportWriteItem } from "@ryot-app/plugin-backend-sdk/imports";
import { stableStringify } from "@ryot-app/ts-utils/json";

export const ingestionItemIdentity = (
	runId: LifecycleCommand["causation"]["importRunId"],
	operationId: string,
) => stableStringify(["ingestion", runId, operationId]);

export const ingestionOperationCommand = <Command extends LifecycleCommand>(
	command: Command,
	operationId: string,
): Command => ({
	...command,
	itemIdentity: ingestionItemIdentity(command.causation.importRunId, operationId),
});

const genericImportRecordOperationId = (item: GenericImportWriteItem) =>
	item.entities.find((entity) => entity.alias === item.subjectEntityAlias)?.operationId ??
	item.recordId;

export const genericImportRecordCommand = <Command extends LifecycleCommand>(
	command: Command,
	item: GenericImportWriteItem,
): Command => ingestionOperationCommand(command, genericImportRecordOperationId(item));

export const genericImportOperationIdentity = (
	runId: LifecycleCommand["causation"]["importRunId"],
	item: GenericImportWriteItem,
	operationId: string,
) => `${ingestionItemIdentity(runId, genericImportRecordOperationId(item))}:${operationId}`;

export const genericImportOperationCommand = <Command extends LifecycleCommand>(
	command: Command,
	item: GenericImportWriteItem,
	operationId: string,
): Command => ({
	...command,
	itemIdentity: genericImportOperationIdentity(command.causation.importRunId, item, operationId),
});

export const summarizeIngestionOutcomes = (
	outcomes: ReadonlyArray<Pick<IngestionOutcome, "unit" | "result" | "recordKind">>,
): IngestionSummary => {
	const summary: Array<IngestionSummary[number]> = [];
	for (const outcome of outcomes) {
		let row = summary.find(
			(value) => value.recordKind === outcome.recordKind && value.unit === outcome.unit,
		);
		if (!row) {
			row = {
				unit: outcome.unit,
				recordKind: outcome.recordKind,
				counts: { created: 0, updated: 0, skipped: 0, unchanged: 0, unsuccessful: 0 },
			};
			summary.push(row);
		}
		const index = summary.indexOf(row);
		summary[index] = {
			...row,
			counts: { ...row.counts, [outcome.result]: row.counts[outcome.result] + 1 },
		};
	}
	return summary.sort(
		(a, b) => a.recordKind.localeCompare(b.recordKind) || a.unit.localeCompare(b.unit),
	);
};
