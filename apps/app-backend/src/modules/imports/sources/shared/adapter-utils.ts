import {
	type ImportSourceAdapterFailure,
	createImportSourceFailure,
} from "../../runtime/source-api";

export const isNotNullAdapterFailure = (
	value: ImportSourceAdapterFailure | null,
): value is ImportSourceAdapterFailure => value !== null;

export const createSourceFetchFailure = (input: {
	host: string;
	error: unknown;
	message: string;
	itemIndex: number;
	sourceLabel?: string | undefined;
	sourceIdentifier?: string | undefined;
}): ImportSourceAdapterFailure => createImportSourceFailure({ ...input, stage: "source_fetch" });
