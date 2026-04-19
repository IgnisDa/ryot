import { dayjs } from "@ryot/ts-utils/dayjs";

import {
	createImportSourceFailure,
	type ImportSourceAdapterFailure,
} from "../../runtime/source-api";

export const isNotNullAdapterFailure = (
	value: ImportSourceAdapterFailure | null,
): value is ImportSourceAdapterFailure => value !== null;

export const parseDateInput = (
	value: number | string | null | undefined,
	options: { unixSeconds?: boolean } = {},
): string | null => {
	if (typeof value === "number") {
		const parsed = options.unixSeconds ? dayjs.unix(value) : dayjs(value);
		return parsed.isValid() ? parsed.toISOString() : null;
	}
	if (typeof value === "string") {
		const parsed = dayjs(value);
		return parsed.isValid() ? parsed.toISOString() : null;
	}
	return null;
};

export const createSourceFetchFailure = (input: {
	host: string;
	error: unknown;
	message: string;
	itemIndex: number;
	sourceLabel?: string;
	sourceIdentifier?: string;
}): ImportSourceAdapterFailure => createImportSourceFailure({ ...input, stage: "source_fetch" });
