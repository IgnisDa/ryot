import { DateTime, Option, Schema } from "@ryot/sandbox-sdk/effect";

import { parseCsvText } from "./csv";

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

const normalizeKey = (label: string) =>
	label
		.toLowerCase()
		.trim()
		.replace(/\s+/g, "_")
		.replace(/[^a-z0-9_]/g, "")
		.replace(/_+/g, "_")
		.replace(/^_|_$/g, "");

const OpenScaleStatisticSchema = Schema.Struct({
	key: Schema.String,
	label: Schema.String,
	value: Schema.Number,
});

const OpenScaleNormalizedItemSchema = Schema.Struct({
	itemIndex: Schema.Number,
	sourceLabel: Schema.String,
	sourceIdentifier: Schema.String,
	properties: Schema.Struct({
		recordedAt: Schema.String,
		comment: Schema.optional(Schema.NullOr(Schema.String)),
		statistics: Schema.mutable(Schema.Array(OpenScaleStatisticSchema)),
	}),
});

export type OpenScaleNormalizedItem = typeof OpenScaleNormalizedItemSchema.Type;

const OpenScaleAdapterFailureSchema = Schema.Struct({
	message: Schema.String,
	itemIndex: Schema.Number,
	sourceLabel: Schema.String,
	sourceIdentifier: Schema.String,
});

type OpenScaleAdapterFailure = typeof OpenScaleAdapterFailureSchema.Type;

const OpenScaleAdapterResultSchema = Schema.Struct({
	items: Schema.mutable(Schema.Array(OpenScaleNormalizedItemSchema)),
	failures: Schema.mutable(Schema.Array(OpenScaleAdapterFailureSchema)),
});

type OpenScaleAdapterResult = typeof OpenScaleAdapterResultSchema.Type;

export const adaptOpenScaleCsv = (csvText: string): OpenScaleAdapterResult => {
	const { headers, rows } = parseCsvText(csvText);
	if (headers.length === 0) {
		throw new Error("OpenScale CSV is empty or has no header row");
	}

	const normalizedHeaders = headers.map((header) => header.toLowerCase().trim());
	const datetimeColIdx =
		DATETIME_COLUMN_NAMES.map((name) => normalizedHeaders.indexOf(name)).find(
			(index) => index >= 0,
		) ?? -1;
	const dateColIdx =
		DATE_COLUMN_NAMES.map((name) => normalizedHeaders.indexOf(name)).find((index) => index >= 0) ??
		-1;
	const timeColIdx =
		TIME_COLUMN_NAMES.map((name) => normalizedHeaders.indexOf(name)).find((index) => index >= 0) ??
		-1;
	const commentColIdx =
		COMMENT_COLUMN_NAMES.map((name) => normalizedHeaders.indexOf(name)).find(
			(index) => index >= 0,
		) ?? -1;

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

		const parsed = DateTime.make(datetimeRaw.trim().replace(" ", "T"));
		if (Option.isNone(parsed)) {
			failures.push({
				itemIndex: rowIdx,
				sourceLabel: `Row ${rowIdx + 1}`,
				message: "Could not parse date/time value",
				sourceIdentifier: String(rowIdx + 1),
			});
			continue;
		}

		const recordedAt = DateTime.formatIso(parsed.value);
		const sourceLabel = recordedAt.slice(0, 16).replace("T", " ");
		const sourceIdentifier = recordedAt;
		const commentKey = commentColIdx >= 0 && headers[commentColIdx] ? headers[commentColIdx] : null;
		const rawComment = commentKey ? row[commentKey]?.trim() : undefined;
		const comment = rawComment?.length ? rawComment : null;
		const statistics: Array<typeof OpenScaleStatisticSchema.Type> = [];
		const normalizedSkip = new Set(
			headers.filter((_, index) => {
				const normalized = normalizedHeaders[index] ?? "";
				return (
					SKIP_COLUMN_NAMES.has(normalized) ||
					index === datetimeColIdx ||
					index === dateColIdx ||
					index === timeColIdx ||
					index === commentColIdx
				);
			}),
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
