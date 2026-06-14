import { DateTime, Either, Option } from "effect";

import {
	parseCsvText,
	readCsvCell,
	readOptionalCsvNumber,
	readRequiredCsvCell,
} from "../../runtime/csv";
import {
	determineWorkoutExerciseKind,
	type WorkoutAdapterFailure,
	type WorkoutAdapterResult,
	type WorkoutImportExercise,
	type WorkoutImportSet,
} from "../../workout/domain";

type HevyRow = {
	title: string;
	reps?: number | undefined;
	weight?: number | undefined;
	endTime: string;
	setType: string;
	setOrder: string;
	startTime: string;
	itemIndex: number;
	description?: string | undefined;
	exerciseTitle: string;
	exerciseNotes?: string | undefined;
	distanceMeters?: number | undefined;
	durationSeconds?: number | undefined;
};

const POUNDS_TO_KILOGRAMS = 0.45359237;

const readHevyWeight = (row: Record<string, string>): number | undefined => {
	const kilograms = readOptionalCsvNumber(row, ["weight_kg", "Weight (kg)"]);
	if (kilograms !== undefined) {
		return kilograms;
	}

	const pounds = readOptionalCsvNumber(row, ["weight_lbs", "Weight (lbs)"]);
	return pounds !== undefined ? pounds * POUNDS_TO_KILOGRAMS : undefined;
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
		description: readCsvCell(row, ["description", "Description"]),
		title: readRequiredCsvCell(row, ["title", "Title"], "Title"),
		exerciseNotes: readCsvCell(row, ["exercise_notes", "Exercise Notes", "ExerciseNotes"]),
		endTime: readRequiredCsvCell(row, ["end_time", "End Time", "EndTime"], "End Time"),
		setType: readRequiredCsvCell(row, ["set_type", "Set Type", "SetType"], "Set Type"),
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

const toIsoFromDdMmmYyyy = (value: string): string | null => {
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

const toIsoFromMmmDdYyyy = (value: string): string | null => {
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

const parseHevyDate = (value: string, timezone: string) => {
	const isoStr = toIsoFromDdMmmYyyy(value) ?? toIsoFromMmmDdYyyy(value);
	return DateTime.makeZoned(isoStr ?? value.replace(" ", "T"), {
		timeZone: timezone,
		adjustForTimeZone: true,
	});
};

const toWorkoutSet = (row: HevyRow): WorkoutImportSet => {
	let setLot: WorkoutImportSet["setLot"];
	switch (row.setType) {
		case "warmup":
			setLot = "warm_up";
			break;
		case "failure":
			setLot = "failure";
			break;
		case "dropset":
			setLot = "drop";
			break;
		default:
			setLot = "normal";
	}

	const set: WorkoutImportSet = { setLot };
	if (row.exerciseNotes) {
		set.note = row.exerciseNotes;
	}
	if (row.reps !== undefined) {
		set.reps = row.reps;
	}
	if (row.weight !== undefined) {
		set.weight = row.weight || 1;
	}
	if (row.durationSeconds !== undefined) {
		set.duration = row.durationSeconds / 60;
	}
	if (row.distanceMeters !== undefined) {
		set.distance = row.distanceMeters / 1000;
	}
	return set;
};

const sourceLabelForWorkout = (row: HevyRow): string => `${row.title} (${row.startTime})`;

const sourceIdentifierForWorkout = (row: Pick<HevyRow, "startTime" | "title">): string =>
	`${row.startTime}:${row.title}`;

export const adaptHevyCsv = (csvText: string, timezone: string): WorkoutAdapterResult => {
	const { headers, rows } = parseCsvText(csvText);
	if (headers.length === 0) {
		throw new Error("Hevy CSV is empty or has no header row");
	}

	const failures: WorkoutAdapterFailure[] = [];
	const parsedRows: HevyRow[] = [];
	for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
		const row = rows[rowIdx];
		if (!row) {
			continue;
		}
		const parsed = Either.try(() => parseHevyRow(row, rowIdx));
		if (Either.isLeft(parsed)) {
			failures.push({
				itemIndex: rowIdx,
				sourceLabel: `Row ${rowIdx + 1}`,
				sourceIdentifier: String(rowIdx + 1),
				message: parsed.left instanceof Error ? parsed.left.message : "Could not parse Hevy row",
			});
			continue;
		}
		parsedRows.push(parsed.right);
	}

	const workoutsBySourceKey = new Map<string, HevyRow[]>();
	for (const row of parsedRows) {
		const sourceKey = sourceIdentifierForWorkout(row);
		const workoutRows = workoutsBySourceKey.get(sourceKey) ?? [];
		workoutRows.push(row);
		workoutsBySourceKey.set(sourceKey, workoutRows);
	}

	const items: WorkoutAdapterResult["items"] = [];
	for (const [sourceIdentifier, workoutRows] of workoutsBySourceKey) {
		const firstRow = workoutRows[0];
		if (!firstRow) {
			continue;
		}

		const sourceLabel = sourceLabelForWorkout(firstRow);
		const startedAt = parseHevyDate(firstRow.startTime, timezone);
		if (Option.isNone(startedAt)) {
			failures.push({
				sourceLabel,
				sourceIdentifier,
				itemIndex: firstRow.itemIndex,
				message: `Could not parse workout start time "${firstRow.startTime}"`,
			});
			continue;
		}

		const endedAtParsed = parseHevyDate(firstRow.endTime, timezone);
		const endedAt = Option.isSome(endedAtParsed) ? DateTime.formatIso(endedAtParsed.value) : null;

		const exercisesByName = new Map<string, HevyRow[]>();
		for (const row of workoutRows) {
			const exerciseRows = exercisesByName.get(row.exerciseTitle) ?? [];
			exerciseRows.push(row);
			exercisesByName.set(row.exerciseTitle, exerciseRows);
		}

		const exercises: WorkoutImportExercise[] = [];
		for (const [exerciseName, exerciseRows] of exercisesByName) {
			const sets = exerciseRows.map(toWorkoutSet);
			const kind = determineWorkoutExerciseKind(sets);
			if (!kind) {
				failures.push({
					sourceLabel: `Exercise: ${exerciseName}`,
					sourceIdentifier: `${sourceIdentifier}:${exerciseName}`,
					itemIndex: exerciseRows[0]?.itemIndex ?? firstRow.itemIndex,
					message: `Could not determine exercise kind from ${sets.length} sets`,
				});
				continue;
			}
			exercises.push({ kind, sets, name: exerciseName });
		}

		if (exercises.length === 0) {
			failures.push({
				sourceLabel,
				sourceIdentifier,
				itemIndex: firstRow.itemIndex,
				message: "Workout has no importable exercises",
			});
			continue;
		}

		items.push({
			endedAt,
			exercises,
			sourceLabel,
			sourceIdentifier,
			name: firstRow.title,
			itemIndex: firstRow.itemIndex,
			startedAt: DateTime.formatIso(startedAt.value),
			comment: firstRow.description ?? null,
		});
	}

	return { items, failures };
};
