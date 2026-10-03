import { DateTime, Duration, Result, Option } from "@ryot-app/sandbox-sdk/effect";

import { normalizeWorkoutMeasurements } from "../../shared/workout-records";
import { parseCsvText, readCsvCell, readOptionalCsvNumber, readRequiredCsvCell } from "./csv";
import {
	determineWorkoutExerciseKind,
	type WorkoutAdapterFailure,
	type WorkoutAdapterResult,
	type WorkoutImportExercise,
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
		date: readRequiredCsvCell(row, ["Date"], "Date"),
		setOrder: readRequiredCsvCell(row, ["Set Order"], "Set Order"),
		workoutNotes: readCsvCell(row, ["Workout Notes", "WorkoutNotes"]),
		workoutName: readRequiredCsvCell(row, ["Workout Name", "WorkoutName"], "Workout Name"),
		exerciseName: readRequiredCsvCell(row, ["Exercise Name", "ExerciseName"], "Exercise Name"),
		weight: weightKilograms ?? (weightPounds !== undefined ? weightPounds * 0.45359237 : undefined),
		workoutDuration: readRequiredCsvCell(
			row,
			["Duration (sec)", "Duration", "Workout Duration", "WorkoutDuration"],
			"Duration",
		),
		distance:
			distanceMeters !== undefined
				? distanceMeters / 1000
				: (distanceKilometers ??
					(distanceMiles !== undefined ? distanceMiles * 1.609344 : undefined)),
	};
};

const parseWorkoutDurationSeconds = (value: string) => {
	const trimmed = value.trim();
	if (/^\d+$/.test(trimmed)) {
		return Number(trimmed);
	}

	let totalSeconds = 0;
	const normalized = trimmed.toLowerCase();
	const hoursPosition = normalized.indexOf("h");
	if (hoursPosition >= 0) {
		const hours = Number(normalized.slice(0, hoursPosition).trim());
		if (Number.isNaN(hours)) {
			throw new Error(`Could not parse workout duration "${value}"`);
		}
		totalSeconds += hours * 3600;
	}

	const minutesPosition = normalized.indexOf("m");
	if (minutesPosition >= 0) {
		const start = hoursPosition >= 0 ? hoursPosition + 1 : 0;
		const minutesText = normalized.slice(start, minutesPosition).trim();
		if (minutesText.length > 0) {
			const minutes = Number(minutesText);
			if (Number.isNaN(minutes)) {
				throw new Error(`Could not parse workout duration "${value}"`);
			}
			totalSeconds += minutes * 60;
		}
	}

	const secondsPosition = normalized.indexOf("s");
	if (secondsPosition >= 0) {
		let start = 0;
		if (minutesPosition >= 0) {
			start = minutesPosition + 1;
		} else if (hoursPosition >= 0) {
			start = hoursPosition + 1;
		}
		const secondsText = normalized.slice(start, secondsPosition).trim();
		if (secondsText.length > 0) {
			const seconds = Number(secondsText);
			if (Number.isNaN(seconds)) {
				throw new Error(`Could not parse workout duration "${value}"`);
			}
			totalSeconds += seconds;
		}
	}

	return totalSeconds;
};

const toWorkoutSet = (row: StrongAppRow): WorkoutImportSet => {
	const setLots: Record<string, WorkoutImportSet["setLot"]> = {
		D: "drop",
		W: "warm_up",
		F: "failure",
	};
	const set: WorkoutImportSet = {
		...normalizeWorkoutMeasurements({
			reps: row.reps,
			weight: row.weight,
			duration: row.seconds,
			distance: row.distance,
		}),
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

export const adaptStrongAppCsv = (csvText: string, timezone: string): WorkoutAdapterResult => {
	const { rows, headers } = parseCsvText(csvText);
	if (headers.length === 0) {
		throw new Error("StrongApp CSV is empty or has no header row");
	}
	return adaptStrongAppRows(
		rows.map((row, itemIndex) => ({ row, itemIndex })),
		timezone,
	);
};

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

	const workoutsBySourceKey = new Map<string, StrongAppRow[]>();
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
		const date = firstRow.date;
		const sourceLabel = sourceLabelForWorkout(firstRow);
		const startedAt = DateTime.makeZoned(date.replace(" ", "T"), {
			timeZone: timezone,
			adjustForTimeZone: true,
		});
		if (Option.isNone(startedAt)) {
			failures.push({
				sourceLabel,
				sourceIdentifier,
				itemIndex: firstRow.itemIndex,
				message: `Could not parse workout date "${date}"`,
			});
			continue;
		}

		const parsedDuration = Result.try(() => parseWorkoutDurationSeconds(firstRow.workoutDuration));
		if (Result.isFailure(parsedDuration)) {
			failures.push({
				sourceLabel,
				sourceIdentifier,
				itemIndex: firstRow.itemIndex,
				message:
					parsedDuration.failure instanceof Error
						? parsedDuration.failure.message
						: "Could not parse workout duration",
			});
			continue;
		}

		const exercisesByName = new Map<string, StrongAppRow[]>();
		for (const row of workoutRows) {
			const exerciseRows = exercisesByName.get(row.exerciseName) ?? [];
			exerciseRows.push(row);
			exercisesByName.set(row.exerciseName, exerciseRows);
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
			exercises,
			sourceLabel,
			sourceIdentifier,
			name: firstRow.workoutName,
			itemIndex: firstRow.itemIndex,
			comment: firstRow.workoutNotes ?? null,
			startedAt: DateTime.formatIso(startedAt.value),
			endedAt: DateTime.formatIso(
				DateTime.addDuration(startedAt.value, Duration.seconds(parsedDuration.success)),
			),
		});
	}

	return { items, failures };
};
