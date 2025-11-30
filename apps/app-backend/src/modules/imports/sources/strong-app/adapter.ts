import { dayjs } from "@ryot/ts-utils/dayjs";

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

type StrongAppRow = {
	date: string;
	reps?: number;
	notes?: string;
	weight?: number;
	seconds?: number;
	setOrder: string;
	distance?: number;
	itemIndex: number;
	workoutName: string;
	exerciseName: string;
	workoutNotes?: string;
	workoutDuration: string;
};

const parseStrongAppRow = (row: Record<string, string>, rowIdx: number): StrongAppRow => ({
	itemIndex: rowIdx,
	notes: readCsvCell(row, ["Notes"]),
	reps: readOptionalCsvNumber(row, ["Reps"]),
	seconds: readOptionalCsvNumber(row, ["Seconds"]),
	date: readRequiredCsvCell(row, ["Date"], "Date"),
	weight: readOptionalCsvNumber(row, ["Weight (kg)", "Weight"]),
	workoutNotes: readCsvCell(row, ["Workout Notes", "WorkoutNotes"]),
	distance: readOptionalCsvNumber(row, ["Distance (m)", "Distance"]),
	setOrder: readRequiredCsvCell(row, ["Set Order"], "Set Order"),
	workoutName: readRequiredCsvCell(row, ["Workout Name", "WorkoutName"], "Workout Name"),
	exerciseName: readRequiredCsvCell(row, ["Exercise Name", "ExerciseName"], "Exercise Name"),
	workoutDuration: readRequiredCsvCell(
		row,
		["Duration (sec)", "Duration", "Workout Duration", "WorkoutDuration"],
		"Duration",
	),
});

const parseWorkoutDurationSeconds = (value: string): number => {
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
		const start =
			minutesPosition >= 0 ? minutesPosition + 1 : hoursPosition >= 0 ? hoursPosition + 1 : 0;
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
	const setLot =
		row.setOrder === "W"
			? "warm_up"
			: row.setOrder === "F"
				? "failure"
				: row.setOrder === "D"
					? "drop"
					: "normal";

	const set: WorkoutImportSet = { setLot };
	if (row.notes) {
		set.note = row.notes;
	}
	if (row.reps !== undefined) {
		set.reps = row.reps;
	}
	if (row.weight !== undefined) {
		set.weight = row.weight || 1;
	}
	if (row.seconds !== undefined) {
		set.duration = row.seconds / 60;
	}
	if (row.distance !== undefined) {
		set.distance = row.distance / 1000;
	}
	return set;
};

const sourceLabelForWorkout = (row: StrongAppRow): string => `${row.workoutName} (${row.date})`;

const sourceIdentifierForWorkout = (row: Pick<StrongAppRow, "date" | "workoutName">): string =>
	`${row.date}:${row.workoutName}`;

export const adaptStrongAppCsv = (csvText: string): WorkoutAdapterResult => {
	const { headers, rows } = parseCsvText(csvText);
	if (headers.length === 0) {
		throw new Error("StrongApp CSV is empty or has no header row");
	}

	const failures: WorkoutAdapterFailure[] = [];
	const parsedRows: StrongAppRow[] = [];
	for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
		const row = rows[rowIdx];
		if (!row) {
			continue;
		}
		try {
			const parsed = parseStrongAppRow(row, rowIdx);
			if (parsed.setOrder !== "Rest Timer" && parsed.setOrder !== "Note") {
				parsedRows.push(parsed);
			}
		} catch (error) {
			failures.push({
				itemIndex: rowIdx,
				sourceLabel: `Row ${rowIdx + 1}`,
				sourceIdentifier: String(rowIdx + 1),
				message: error instanceof Error ? error.message : "Could not parse StrongApp row",
			});
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
		const startedAt = dayjs(date);
		if (!startedAt.isValid()) {
			failures.push({
				sourceLabel,
				sourceIdentifier,
				itemIndex: firstRow.itemIndex,
				message: `Could not parse workout date "${date}"`,
			});
			continue;
		}

		let durationSeconds: number;
		try {
			durationSeconds = parseWorkoutDurationSeconds(firstRow.workoutDuration);
		} catch (error) {
			failures.push({
				sourceLabel,
				sourceIdentifier,
				itemIndex: firstRow.itemIndex,
				message: error instanceof Error ? error.message : "Could not parse workout duration",
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
			startedAt: startedAt.toISOString(),
			comment: firstRow.workoutNotes ?? null,
			endedAt: startedAt.add(durationSeconds, "second").toISOString(),
		});
	}

	return { items, failures };
};
