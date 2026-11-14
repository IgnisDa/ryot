import { DateTime, Option, Result } from "@ryot-app/plugin-backend-sdk/effect";

import { poundsToKilograms } from "../../shared/workout-units";
import { readCsvCell, readOptionalCsvNumber, readRequiredCsvCell } from "./csv";
import {
	buildWorkoutItem,
	type WorkoutAdapterFailure,
	type WorkoutAdapterResult,
	type WorkoutImportSet,
} from "./workout-domain";

type HevyRow = {
	title: string;
	endTime: string;
	setType: string;
	setOrder: string;
	startTime: string;
	itemIndex: number;
	exerciseTitle: string;
	reps?: number | undefined;
	weight?: number | undefined;
	description?: string | undefined;
	exerciseNotes?: string | undefined;
	distanceMeters?: number | undefined;
	durationSeconds?: number | undefined;
};

const titleColumns = ["title", "Title"];

const readHevyWeight = (row: Record<string, string>) => {
	const kilograms = readOptionalCsvNumber(row, ["weight_kg", "Weight (kg)"]);
	if (kilograms !== undefined) {
		return kilograms;
	}

	const pounds = readOptionalCsvNumber(row, ["weight_lbs", "Weight (lbs)"]);
	return pounds !== undefined ? poundsToKilograms(pounds) : undefined;
};

const parseHevyRow = (row: Record<string, string>, rowIdx: number): HevyRow => {
	const distanceKm = readOptionalCsvNumber(row, ["distance_km"]);
	const distanceM = readOptionalCsvNumber(row, ["distance_m", "Distance (m)"]);
	const distanceMeters = distanceM ?? (distanceKm !== undefined ? distanceKm * 1000 : undefined);
	return {
		distanceMeters,
		itemIndex: rowIdx,
		weight: readHevyWeight(row),
		reps: readOptionalCsvNumber(row, ["reps", "Reps"]),
		title: readRequiredCsvCell(row, titleColumns, "Title"),
		description: readCsvCell(row, ["description", "Description"]),
		endTime: readRequiredCsvCell(row, ["end_time", "End Time", "EndTime"], "End Time"),
		setType: readRequiredCsvCell(row, ["set_type", "Set Type", "SetType"], "Set Type"),
		exerciseNotes: readCsvCell(row, ["exercise_notes", "Exercise Notes", "ExerciseNotes"]),
		startTime: readRequiredCsvCell(row, ["start_time", "Start Time", "StartTime"], "Start Time"),
		durationSeconds: readOptionalCsvNumber(row, [
			"duration_seconds",
			"Duration (seconds)",
			"Seconds",
		]),
		setOrder: readRequiredCsvCell(
			row,
			["set_order", "set_index", "Set Order", "SetOrder"],
			"Set Order",
		),
		exerciseTitle: readRequiredCsvCell(
			row,
			["exercise_title", "Exercise Title", "ExerciseTitle"],
			"Exercise Title",
		),
	};
};

const MONTH_ABBR: Record<string, string> = {
	Jan: "01",
	Feb: "02",
	Mar: "03",
	Apr: "04",
	May: "05",
	Jun: "06",
	Jul: "07",
	Aug: "08",
	Sep: "09",
	Oct: "10",
	Nov: "11",
	Dec: "12",
};

const toIsoFromDdMmmYyyy = (value: string) => {
	const m = /^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4}),\s*(\d{2}:\d{2})$/.exec(value);
	if (!m) {
		return null;
	}
	const [, day, mon, year, time] = m;
	if (!day || !mon || !year || !time) {
		return null;
	}
	const month = MONTH_ABBR[mon];
	return month ? `${year}-${month}-${day.padStart(2, "0")}T${time}:00` : null;
};

const toIsoFromMmmDdYyyy = (value: string) => {
	const m = /^([A-Za-z]{3})\s+(\d{1,2})\s+(\d{4}),\s*(\d{2}:\d{2})$/.exec(value);
	if (!m) {
		return null;
	}
	const [, mon, day, year, time] = m;
	if (!mon || !day || !year || !time) {
		return null;
	}
	const month = MONTH_ABBR[mon];
	return month ? `${year}-${month}-${day.padStart(2, "0")}T${time}:00` : null;
};

const toIsoFromMmmDdYyyyMeridiem = (value: string) => {
	const m = /^([A-Za-z]{3})\s+(\d{1,2}),\s*(\d{4}),\s*(\d{1,2}):(\d{2})\s*(AM|PM)$/.exec(value);
	if (!m) {
		return null;
	}
	const [, mon, day, year, hour, minute, meridiem] = m;
	if (!mon || !day || !year || !hour || !minute || !meridiem) {
		return null;
	}
	const month = MONTH_ABBR[mon];
	if (!month) {
		return null;
	}
	const hour24 = (Number.parseInt(hour, 10) % 12) + (meridiem === "PM" ? 12 : 0);
	return `${year}-${month}-${day.padStart(2, "0")}T${String(hour24).padStart(2, "0")}:${minute}:00`;
};

const parseHevyDate = (value: string, timezone: string) => {
	const isoStr =
		toIsoFromMmmDdYyyyMeridiem(value) ?? toIsoFromDdMmmYyyy(value) ?? toIsoFromMmmDdYyyy(value);
	return DateTime.makeZoned(isoStr ?? value.replace(" ", "T"), {
		timeZone: timezone,
		adjustForTimeZone: true,
	});
};

const toWorkoutSet = (row: HevyRow): WorkoutImportSet => {
	const setLots: Record<string, WorkoutImportSet["setLot"]> = {
		dropset: "drop",
		warmup: "warm_up",
		failure: "failure",
	};
	const set: WorkoutImportSet = {
		reps: row.reps,
		weight: row.weight,
		duration: row.durationSeconds,
		setLot: setLots[row.setType] ?? "normal",
		distance: row.distanceMeters !== undefined ? row.distanceMeters / 1000 : undefined,
	};
	if (row.exerciseNotes) {
		set.note = row.exerciseNotes;
	}
	return set;
};

const sourceLabelForWorkout = (row: HevyRow) => `${row.title} (${row.startTime})`;
const sourceIdentifierForWorkout = (row: Pick<HevyRow, "title" | "startTime">) =>
	`${row.startTime}:${row.title}`;

export const hevyWorkoutKey = (row: Record<string, string>) =>
	sourceIdentifierForWorkout({
		title: readCsvCell(row, titleColumns) ?? "",
		startTime: readCsvCell(row, ["start_time", "Start Time", "StartTime"]) ?? "",
	});

export const adaptHevyRows = (
	rows: ReadonlyArray<{ itemIndex: number; row: Record<string, string> }>,
	timezone: string,
): WorkoutAdapterResult => {
	const failures: WorkoutAdapterFailure[] = [];
	const parsedRows: HevyRow[] = [];
	for (const { row, itemIndex: rowIdx } of rows) {
		const parsed = Result.try(() => parseHevyRow(row, rowIdx));
		if (Result.isFailure(parsed)) {
			failures.push({
				unit: "workouts",
				itemIndex: rowIdx,
				sourceLabel: `Row ${rowIdx + 1}`,
				sourceIdentifier: String(rowIdx + 1),
				message:
					parsed.failure instanceof Error ? parsed.failure.message : "Could not parse Hevy row",
			});
			continue;
		}
		parsedRows.push(parsed.success);
	}

	const firstRow = parsedRows[0];
	if (!firstRow) {
		return { failures };
	}
	const sourceIdentifier = sourceIdentifierForWorkout(firstRow);
	const sourceLabel = sourceLabelForWorkout(firstRow);
	const startedAt = parseHevyDate(firstRow.startTime, timezone);
	if (Option.isNone(startedAt)) {
		failures.push({
			sourceLabel,
			unit: "workouts",
			sourceIdentifier,
			itemIndex: firstRow.itemIndex,
			message: `Could not parse workout start time "${firstRow.startTime}"`,
		});
		return { failures };
	}

	const endedAtParsed = parseHevyDate(firstRow.endTime, timezone);
	const endedAt = Option.isSome(endedAtParsed) ? DateTime.formatIso(endedAtParsed.value) : null;
	return buildWorkoutItem({
		failures,
		rows: parsedRows,
		toSet: toWorkoutSet,
		exerciseName: (row) => row.exerciseTitle,
		item: {
			endedAt,
			sourceLabel,
			sourceIdentifier,
			name: firstRow.title,
			itemIndex: firstRow.itemIndex,
			comment: firstRow.description ?? null,
			startedAt: DateTime.formatIso(startedAt.value),
		},
	});
};
