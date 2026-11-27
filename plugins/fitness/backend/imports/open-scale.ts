import { DateTime, Option, Schema } from "@ryot-app/plugin-backend-sdk/effect";

import { measurementMetricKey } from "../../shared/measurement-metrics";

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

const OpenScaleStatisticSchema = Schema.Struct({
	key: Schema.String,
	label: Schema.String,
	value: Schema.Finite,
});

const OpenScaleNormalizedItemSchema = Schema.Struct({
	itemIndex: Schema.Finite,
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
	itemIndex: Schema.Finite,
	sourceLabel: Schema.String,
	sourceIdentifier: Schema.String,
});

type OpenScaleAdapterFailure = typeof OpenScaleAdapterFailureSchema.Type;

type OpenScaleAdapterResult = {
	readonly item?: OpenScaleNormalizedItem;
	readonly failures: OpenScaleAdapterFailure[];
};

const parseOpenScaleDate = (raw: string, timezone: string) => {
	const value = raw.trim().replace(" ", "T");
	const offset = /(?:Z|[+-]\d{2}:?\d{2})$/i;
	const local = value.replace(offset, "");
	const wallClock = DateTime.make(local);
	if (
		Option.isNone(wallClock) ||
		!DateTime.formatIso(wallClock.value).startsWith(local.split(".")[0] ?? local)
	) {
		return Option.none();
	}
	if (offset.test(value)) {
		return DateTime.make(value);
	}
	const zoned = DateTime.makeZoned(wallClock.value, {
		timeZone: timezone,
		adjustForTimeZone: true,
		disambiguation: "earlier",
	});
	return Option.isSome(zoned) &&
		DateTime.toDate(zoned.value).getTime() === wallClock.value.epochMilliseconds
		? Option.some(DateTime.toUtc(zoned.value))
		: Option.none();
};

export const adaptOpenScaleRow = (
	{ row, itemIndex: rowIdx }: { itemIndex: number; row: Record<string, string> },
	headers: ReadonlyArray<string>,
	timezone: string,
): OpenScaleAdapterResult => {
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

	const failures: OpenScaleAdapterFailure[] = [];
	let datetimeRaw: string | undefined;
	if (hasDatetime) {
		datetimeRaw = headers[datetimeColIdx] ? row[headers[datetimeColIdx]] : undefined;
	} else if (hasDateAndTime) {
		const dateVal = dateColIdx >= 0 && headers[dateColIdx] ? (row[headers[dateColIdx]] ?? "") : "";
		const timeVal = timeColIdx >= 0 && headers[timeColIdx] ? (row[headers[timeColIdx]] ?? "") : "";
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
		return { failures };
	}

	const parsed = parseOpenScaleDate(datetimeRaw, timezone);
	if (Option.isNone(parsed)) {
		failures.push({
			itemIndex: rowIdx,
			sourceLabel: `Row ${rowIdx + 1}`,
			sourceIdentifier: String(rowIdx + 1),
			message: "Could not parse date/time value",
		});
		return { failures };
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
		statistics.push({ label: header, value: numVal, key: measurementMetricKey(header) });
	}

	if (hasBadNumeric) {
		return { failures };
	}
	if (statistics.length === 0) {
		failures.push({
			sourceLabel,
			sourceIdentifier,
			itemIndex: rowIdx,
			message: "OpenScale row has no measurement values",
		});
		return { failures };
	}
	return {
		failures,
		item: {
			sourceLabel,
			sourceIdentifier,
			itemIndex: rowIdx,
			properties: { comment, recordedAt, statistics },
		},
	};
};
