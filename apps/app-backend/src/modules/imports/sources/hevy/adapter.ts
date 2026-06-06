import { dayjs } from "@ryot/ts-utils/dayjs";

import { parseCsvText } from "../../file-helpers";
import {
	determineWorkoutExerciseKind,
	type WorkoutAdapterFailure,
	type WorkoutAdapterResult,
	type WorkoutImportExercise,
	type WorkoutImportSet,
} from "../workout/domain";

type HevyRow = {
	title: string;
	reps?: number;
	weight?: number;
	endTime: string;
	setType: string;
	setOrder: string;
	startTime: string;
	itemIndex: number;
	description?: string;
	exerciseTitle: string;
	exerciseNotes?: string;
	distanceMeters?: number;
	durationSeconds?: number;
};

const normalizeHeader = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]/g, "");

const readCell = (row: Record<string, string>, aliases: string[]): string | undefined => {
	const wanted = new Set(aliases.map(normalizeHeader));
	for (const [key, value] of Object.entries(row)) {
		if (wanted.has(normalizeHeader(key))) {
			const trimmed = value.trim();
			return trimmed.length > 0 ? trimmed : undefined;
		}
	}
	return undefined;
};

const readRequiredCell = (
	row: Record<string, string>,
	aliases: string[],
	label: string,
): string => {
	const value = readCell(row, aliases);
	if (!value) {
		throw new Error(`Row is missing ${label}`);
	}
	return value;
};

const readOptionalNumber = (row: Record<string, string>, aliases: string[]): number | undefined => {
	const value = readCell(row, aliases);
	if (!value) {
		return undefined;
	}
	const normalized = value.includes(".") ? value : value.replace(",", ".");
	const parsed = Number(normalized);
	if (Number.isNaN(parsed)) {
		throw new Error(`Could not parse numeric value "${value}"`);
	}
	return parsed;
};

const parseHevyRow = (row: Record<string, string>, rowIdx: number): HevyRow => ({
	itemIndex: rowIdx,
	reps: readOptionalNumber(row, ["reps", "Reps"]),
	description: readCell(row, ["description", "Description"]),
	title: readRequiredCell(row, ["title", "Title"], "Title"),
	exerciseNotes: readCell(row, ["exercise_notes", "Exercise Notes", "ExerciseNotes"]),
	endTime: readRequiredCell(row, ["end_time", "End Time", "EndTime"], "End Time"),
	setType: readRequiredCell(row, ["set_type", "Set Type", "SetType"], "Set Type"),
	distanceMeters: readOptionalNumber(row, ["distance_m", "Distance (m)", "distance_km"]),
	weight: readOptionalNumber(row, ["weight_kg", "weight_lbs", "Weight (kg)", "Weight (lbs)"]),
	durationSeconds: readOptionalNumber(row, ["duration_seconds", "Duration (seconds)", "Seconds"]),
	startTime: readRequiredCell(row, ["start_time", "Start Time", "StartTime"], "Start Time"),
	setOrder: readRequiredCell(row, ["set_order", "set_index", "Set Order", "SetOrder"], "Set Order"),
	exerciseTitle: readRequiredCell(
		row,
		["exercise_title", "Exercise Title", "ExerciseTitle"],
		"Exercise Title",
	),
});

// Hevy exports timestamps like "01 Jan 2026, 10:00".
// Some regional exports swap to "Jan 01 2026, 10:00", so both are tried.
const HEVY_DATE_FORMATS = ["DD MMM YYYY, HH:mm", "MMM DD YYYY, HH:mm"];

const parseHevyDate = (value: string): ReturnType<typeof dayjs> => {
	for (const fmt of HEVY_DATE_FORMATS) {
		const parsed = dayjs(value, fmt, true);
		if (parsed.isValid()) {
			return parsed;
		}
	}
	return dayjs(value);
};

const toWorkoutSet = (row: HevyRow): WorkoutImportSet => {
	const setLot =
		row.setType === "warmup"
			? "warm_up"
			: row.setType === "failure"
				? "failure"
				: row.setType === "dropset"
					? "drop"
					: "normal";

	const set: WorkoutImportSet = { setLot };
	if (row.exerciseNotes) {
		set.note = row.exerciseNotes;
	}
	if (row.reps !== undefined) {
		set.reps = row.reps;
	}
	if (row.weight !== undefined) {
		set.weight = row.weight;
	}
	if (row.durationSeconds !== undefined) {
		set.duration = row.durationSeconds;
	}
	if (row.distanceMeters !== undefined) {
		set.distance = row.distanceMeters / 1000;
	}
	return set;
};

const sourceLabelForWorkout = (row: HevyRow): string => `${row.title} (${row.startTime})`;

const sourceIdentifierForWorkout = (row: Pick<HevyRow, "startTime" | "title">): string =>
	`${row.startTime}:${row.title}`;

const pushFailure = (
	failures: WorkoutAdapterFailure[],
	input: {
		message: string;
		itemIndex: number;
		sourceLabel: string;
		sourceIdentifier: string;
	},
) => {
	failures.push({
		message: input.message,
		itemIndex: input.itemIndex,
		sourceLabel: input.sourceLabel,
		sourceIdentifier: input.sourceIdentifier,
	});
};

export const adaptHevyCsv = (csvText: string): WorkoutAdapterResult => {
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
		try {
			parsedRows.push(parseHevyRow(row, rowIdx));
		} catch (error) {
			pushFailure(failures, {
				itemIndex: rowIdx,
				sourceLabel: `Row ${rowIdx + 1}`,
				sourceIdentifier: String(rowIdx + 1),
				message: error instanceof Error ? error.message : "Could not parse Hevy row",
			});
		}
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
		const startedAt = parseHevyDate(firstRow.startTime);
		if (!startedAt.isValid()) {
			pushFailure(failures, {
				sourceLabel,
				sourceIdentifier,
				itemIndex: firstRow.itemIndex,
				message: `Could not parse workout start time "${firstRow.startTime}"`,
			});
			continue;
		}

		const endedAtParsed = parseHevyDate(firstRow.endTime);
		const endedAt = endedAtParsed.isValid() ? endedAtParsed.toISOString() : null;

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
				pushFailure(failures, {
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
			pushFailure(failures, {
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
			startedAt: startedAt.toISOString(),
			comment: firstRow.description ?? null,
		});
	}

	return { items, failures };
};
