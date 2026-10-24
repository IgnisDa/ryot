import { DateTime, Duration, Option, Result } from "@ryot-app/plugin-backend-sdk/effect";

import { milesToKilometers, poundsToKilograms } from "../../shared/workout-units";
import { readCsvCell, readOptionalCsvNumber, readRequiredCsvCell } from "./csv";
import {
	buildWorkoutItem,
	type WorkoutAdapterFailure,
	type WorkoutAdapterResult,
	type WorkoutImportSet,
} from "./workout-domain";

type StrongAppRow = {
	date: string;
	setOrder: string;
	itemIndex: number;
	workoutName: string;
	exerciseName: string;
	workoutDuration: string;
	reps?: number | undefined;
	notes?: string | undefined;
	weight?: number | undefined;
	seconds?: number | undefined;
	distance?: number | undefined;
	workoutNotes?: string | undefined;
};

const dateColumns = ["Date"];
const workoutNameColumns = ["Workout Name", "WorkoutName"];

const parseStrongAppRow = (row: Record<string, string>, rowIdx: number): StrongAppRow => {
	const unlabelledWeight = readCsvCell(row, ["Weight"]);
	if (unlabelledWeight !== undefined) {
		throw new Error('Weight values need a unit label; use "Weight (kg)" or "Weight (lbs)"');
	}
	const unlabelledDistance = readCsvCell(row, ["Distance"]);
	if (unlabelledDistance !== undefined) {
		throw new Error(
			'Distance values need a unit label; use "Distance (m)", "Distance (km)", or "Distance (mi)"',
		);
	}

	const weightKilograms = readOptionalCsvNumber(row, ["Weight (kg)"]);
	const weightPounds = readOptionalCsvNumber(row, ["Weight (lbs)"]);
	const distanceMeters = readOptionalCsvNumber(row, ["Distance (m)"]);
	const distanceKilometers = readOptionalCsvNumber(row, ["Distance (km)"]);
	const distanceMiles = readOptionalCsvNumber(row, ["Distance (mi)"]);
	return {
		itemIndex: rowIdx,
		notes: readCsvCell(row, ["Notes"]),
		reps: readOptionalCsvNumber(row, ["Reps"]),
		seconds: readOptionalCsvNumber(row, ["Seconds"]),
		date: readRequiredCsvCell(row, dateColumns, "Date"),
		setOrder: readRequiredCsvCell(row, ["Set Order"], "Set Order"),
		workoutNotes: readCsvCell(row, ["Workout Notes", "WorkoutNotes"]),
		workoutName: readRequiredCsvCell(row, workoutNameColumns, "Workout Name"),
		exerciseName: readRequiredCsvCell(row, ["Exercise Name", "ExerciseName"], "Exercise Name"),
		weight:
			weightKilograms ?? (weightPounds !== undefined ? poundsToKilograms(weightPounds) : undefined),
		workoutDuration: readRequiredCsvCell(
			row,
			["Duration (sec)", "Duration", "Workout Duration", "WorkoutDuration"],
			"Duration",
		),
		distance:
			distanceMeters !== undefined
				? distanceMeters / 1000
				: (distanceKilometers ??
					(distanceMiles !== undefined ? milesToKilometers(distanceMiles) : undefined)),
	};
};

const parseWorkoutDurationSeconds = (value: string) => {
	const trimmed = value.trim();
	const components =
		/^(?:(\d+(?:\.\d+)?)\s*h\s*)?(?:(\d+(?:\.\d+)?)\s*m\s*)?(?:(\d+(?:\.\d+)?)\s*s\s*)?$/i.exec(
			trimmed,
		);
	let seconds = Number.NaN;
	if (/^\d+(?:\.\d+)?$/.test(trimmed)) {
		seconds = Number(trimmed);
	} else if (components && trimmed.length > 0) {
		seconds =
			Number(components[1] ?? 0) * 3600 +
			Number(components[2] ?? 0) * 60 +
			Number(components[3] ?? 0);
	}
	if (!Number.isFinite(seconds) || seconds < 0 || !Number.isSafeInteger(Math.trunc(seconds))) {
		throw new Error(`Could not parse workout duration "${value}"`);
	}
	return seconds;
};

const toWorkoutSet = (row: StrongAppRow): WorkoutImportSet => {
	const setLots: Record<string, WorkoutImportSet["setLot"]> = {
		D: "drop",
		W: "warm_up",
		F: "failure",
	};
	const set: WorkoutImportSet = {
		reps: row.reps,
		weight: row.weight,
		duration: row.seconds,
		distance: row.distance,
		setLot: setLots[row.setOrder] ?? "normal",
	};
	if (row.notes) {
		set.note = row.notes;
	}
	return set;
};

const sourceLabelForWorkout = (row: StrongAppRow) => `${row.workoutName} (${row.date})`;
const sourceIdentifierForWorkout = (row: Pick<StrongAppRow, "date" | "workoutName">) =>
	`${row.date}:${row.workoutName}`;

export const strongAppWorkoutKey = (row: Record<string, string>) =>
	sourceIdentifierForWorkout({
		date: readCsvCell(row, dateColumns) ?? "",
		workoutName: readCsvCell(row, workoutNameColumns) ?? "",
	});

export const adaptStrongAppRows = (
	rows: ReadonlyArray<{ row: Record<string, string>; itemIndex: number }>,
	timezone: string,
): WorkoutAdapterResult => {
	const failures: WorkoutAdapterFailure[] = [];
	const parsedRows: StrongAppRow[] = [];
	for (const { row, itemIndex: rowIdx } of rows) {
		const parsed = Result.try(() => parseStrongAppRow(row, rowIdx));
		if (Result.isFailure(parsed)) {
			failures.push({
				unit: "workouts",
				itemIndex: rowIdx,
				sourceLabel: `Row ${rowIdx + 1}`,
				sourceIdentifier: String(rowIdx + 1),
				message:
					parsed.failure instanceof Error
						? parsed.failure.message
						: "Could not parse StrongApp row",
			});
			continue;
		}
		if (parsed.success.setOrder !== "Rest Timer" && parsed.success.setOrder !== "Note") {
			parsedRows.push(parsed.success);
		}
	}

	const firstRow = parsedRows[0];
	if (!firstRow) {
		return { failures };
	}
	const sourceIdentifier = sourceIdentifierForWorkout(firstRow);
	const date = firstRow.date;
	const sourceLabel = sourceLabelForWorkout(firstRow);
	const startedAt = DateTime.makeZoned(date.replace(" ", "T"), {
		timeZone: timezone,
		adjustForTimeZone: true,
	});
	if (Option.isNone(startedAt)) {
		failures.push({
			sourceLabel,
			unit: "workouts",
			sourceIdentifier,
			itemIndex: firstRow.itemIndex,
			message: `Could not parse workout date "${date}"`,
		});
		return { failures };
	}

	const parsedDuration = Result.try(() => parseWorkoutDurationSeconds(firstRow.workoutDuration));
	if (Result.isFailure(parsedDuration)) {
		failures.push({
			sourceLabel,
			unit: "workouts",
			sourceIdentifier,
			itemIndex: firstRow.itemIndex,
			message:
				parsedDuration.failure instanceof Error
					? parsedDuration.failure.message
					: "Could not parse workout duration",
		});
		return { failures };
	}

	return buildWorkoutItem({
		failures,
		rows: parsedRows,
		toSet: toWorkoutSet,
		exerciseName: (row) => row.exerciseName,
		item: {
			sourceLabel,
			sourceIdentifier,
			name: firstRow.workoutName,
			itemIndex: firstRow.itemIndex,
			comment: firstRow.workoutNotes ?? null,
			startedAt: DateTime.formatIso(startedAt.value),
			activeDuration: Math.trunc(parsedDuration.success),
			endedAt: DateTime.formatIso(
				DateTime.addDuration(startedAt.value, Duration.seconds(parsedDuration.success)),
			),
		},
	});
};
