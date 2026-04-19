import { dayjs } from "@ryot/ts-utils/dayjs";

import { parseCsvText } from "../../runtime/csv";

const DATE_COLUMN_NAMES = ["date"];
const TIME_COLUMN_NAMES = ["time"];
const COMMENT_COLUMN_NAMES = ["comment", "notes", "note"];
const DATETIME_COLUMN_NAMES = ["datetime", "date_time", "timestamp"];
const SKIP_COLUMN_NAMES = new Set([
	...DATETIME_COLUMN_NAMES,
	...DATE_COLUMN_NAMES,
	...TIME_COLUMN_NAMES,
	...COMMENT_COLUMN_NAMES,
]);

const normalizeKey = (label: string): string =>
	label
		.toLowerCase()
		.trim()
		.replace(/\s+/g, "_")
		.replace(/[^a-z0-9_]/g, "")
		.replace(/_+/g, "_")
		.replace(/^_|_$/g, "");

export type OpenScaleNormalizedItem = {
	itemIndex: number;
	sourceLabel: string;
	sourceIdentifier: string;
	properties: {
		recordedAt: string;
		comment?: string | null;
		statistics: Array<{ key: string; label: string; value: number }>;
	};
};

type OpenScaleAdapterFailure = {
	message: string;
	itemIndex: number;
	sourceLabel: string;
	sourceIdentifier: string;
};

type OpenScaleAdapterResult = {
	items: OpenScaleNormalizedItem[];
	failures: OpenScaleAdapterFailure[];
};

export const adaptOpenScaleCsv = (csvText: string, timezone: string): OpenScaleAdapterResult => {
	const { headers, rows } = parseCsvText(csvText);

	if (headers.length === 0) {
		throw new Error("OpenScale CSV is empty or has no header row");
	}

	const normalizedHeaders = headers.map((h) => h.toLowerCase().trim());

	const datetimeColIdx =
		DATETIME_COLUMN_NAMES.map((n) => normalizedHeaders.indexOf(n)).find((i) => i >= 0) ?? -1;
	const dateColIdx =
		DATE_COLUMN_NAMES.map((n) => normalizedHeaders.indexOf(n)).find((i) => i >= 0) ?? -1;
	const timeColIdx =
		TIME_COLUMN_NAMES.map((n) => normalizedHeaders.indexOf(n)).find((i) => i >= 0) ?? -1;
	const commentColIdx =
		COMMENT_COLUMN_NAMES.map((n) => normalizedHeaders.indexOf(n)).find((i) => i >= 0) ?? -1;

	const hasDatetime = datetimeColIdx >= 0;
	const hasDateAndTime = dateColIdx >= 0 && timeColIdx >= 0;
	const hasDateOnly = dateColIdx >= 0 && timeColIdx < 0;

	if (!hasDatetime && !hasDateAndTime && !hasDateOnly) {
		throw new Error(
			"OpenScale CSV does not contain a recognizable date/time column. Expected a column named 'dateTime', 'date', or similar.",
		);
	}

	const items: OpenScaleNormalizedItem[] = [];
	const failures: OpenScaleAdapterFailure[] = [];

	for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
		const row = rows[rowIdx];
		if (!row) {
			continue;
		}

		let datetimeRaw: string | undefined;
		if (hasDatetime) {
			datetimeRaw = headers[datetimeColIdx] ? row[headers[datetimeColIdx]] : undefined;
		} else if (hasDateAndTime) {
			const dateVal =
				dateColIdx >= 0 && headers[dateColIdx] ? (row[headers[dateColIdx]] ?? "") : "";
			const timeVal =
				timeColIdx >= 0 && headers[timeColIdx] ? (row[headers[timeColIdx]] ?? "") : "";
			datetimeRaw = `${dateVal}T${timeVal}`;
		} else if (hasDateOnly) {
			datetimeRaw = dateColIdx >= 0 && headers[dateColIdx] ? row[headers[dateColIdx]] : undefined;
		}

		if (!datetimeRaw || datetimeRaw.trim().length === 0) {
			failures.push({
				itemIndex: rowIdx,
				sourceLabel: `Row ${rowIdx + 1}`,
				sourceIdentifier: String(rowIdx + 1),
				message: "Row is missing a date/time value",
			});
			continue;
		}

		const parsed = dayjs.tz(datetimeRaw.trim(), timezone);
		if (!parsed.isValid()) {
			failures.push({
				itemIndex: rowIdx,
				sourceLabel: `Row ${rowIdx + 1}`,
				message: "Could not parse date/time value",
				sourceIdentifier: String(rowIdx + 1),
			});
			continue;
		}

		const recordedAt = parsed.toISOString();
		const sourceLabel = parsed.format("YYYY-MM-DD HH:mm");
		const sourceIdentifier = recordedAt;

		const commentKey = commentColIdx >= 0 && headers[commentColIdx] ? headers[commentColIdx] : null;
		const rawComment = commentKey ? row[commentKey]?.trim() : undefined;
		const comment = rawComment?.length ? rawComment : null;

		const statistics: Array<{ key: string; label: string; value: number }> = [];
		const normalizedSkip = new Set(
			headers
				.filter((_, i) => {
					const norm = normalizedHeaders[i] ?? "";
					return (
						SKIP_COLUMN_NAMES.has(norm) ||
						i === datetimeColIdx ||
						i === dateColIdx ||
						i === timeColIdx ||
						i === commentColIdx
					);
				})
				.map((h) => h),
		);

		let hasBadNumeric = false;
		for (const header of headers) {
			if (normalizedSkip.has(header)) {
				continue;
			}
			const raw = row[header];
			if (!raw || raw.trim() === "") {
				continue;
			}

			const numVal = Number(raw.trim());
			if (Number.isNaN(numVal)) {
				failures.push({
					sourceLabel,
					sourceIdentifier,
					itemIndex: rowIdx,
					message: `Could not parse numeric value for column "${header}"`,
				});
				hasBadNumeric = true;
				break;
			}
			statistics.push({ key: normalizeKey(header), label: header, value: numVal });
		}

		if (hasBadNumeric) {
			continue;
		}

		items.push({
			sourceLabel,
			sourceIdentifier,
			itemIndex: rowIdx,
			properties: { recordedAt, comment, statistics },
		});
	}

	return { items, failures };
};
