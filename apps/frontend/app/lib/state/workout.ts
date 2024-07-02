import { $path } from "@ignisda/remix-routes";
import {
	type CreateUserWorkoutMutationVariables,
	ExerciseDetailsDocument,
	type ExerciseLot,
	SetLot,
	UserExerciseDetailsDocument,
	type UserWorkoutSetRecord,
	type WorkoutDetailsQuery,
	type WorkoutSetStatistic,
} from "@ryot/generated/graphql/backend/graphql";
import type { Dayjs } from "dayjs";
import { createDraft, finishDraft } from "immer";
import { useAtom } from "jotai";
import { atomWithReset, atomWithStorage } from "jotai/utils";
import { v4 as randomUUID } from "uuid";
import { CurrentWorkoutKey, clientGqlService } from "~/lib/generals";

export type ExerciseSet = {
	statistic: WorkoutSetStatistic;
	lot: SetLot;
	confirmed: boolean;
	confirmedAt?: string | null;
};

type AlreadyDoneExerciseSet = Pick<ExerciseSet, "statistic">;

type Media = { imageSrc: string; key: string };

export type Exercise = {
	identifier: string;
	exerciseId: string;
	exerciseDetails: { images: Array<string> };
	lot: ExerciseLot;
	notes: Array<string>;
	sets: Array<ExerciseSet>;
	alreadyDoneSets: Array<AlreadyDoneExerciseSet>;
	restTimer?: { enabled: boolean; duration: number } | null;
	videos: Array<Media>;
	images: Array<Media>;
	supersetWith: Array<string>;
	isShowDetailsOpen: boolean;
};

export type InProgressWorkout = {
	repeatedFrom?: string;
	startTime: string;
	endTime?: string;
	name: string;
	comment?: string;
	exercises: Array<Exercise>;
	videos: Array<string>;
	images: Array<string>;
};

type CurrentWorkout = InProgressWorkout | null;

const currentWorkoutAtom = atomWithStorage<CurrentWorkout>(
	CurrentWorkoutKey,
	null,
);

export const useCurrentWorkout = () => {
	const [currentWorkout, setCurrentWorkout] = useAtom(currentWorkoutAtom);
	return [currentWorkout, setCurrentWorkout] as const;
};

function getTimeOfDay(date: Date) {
	const hours = date.getHours();
	if (hours >= 5 && hours < 12) return "Morning";
	if (hours >= 12 && hours < 17) return "Afternoon";
	if (hours >= 17 && hours < 21) return "Evening";
	return "Night";
}

export const getDefaultWorkout = (): InProgressWorkout => {
	const date = new Date();
	return {
		name: `${getTimeOfDay(date)} Workout`,
		startTime: date.toISOString(),
		exercises: [],
		images: [],
		videos: [],
	};
};

export const getExerciseDetails = async (exerciseId: string) => {
	const [{ exerciseDetails }, { userExerciseDetails }] = await Promise.all([
		clientGqlService.request(ExerciseDetailsDocument, { exerciseId }),
		clientGqlService.request(UserExerciseDetailsDocument, {
			input: { exerciseId, takeHistory: 1 },
		}),
	]);
	const json = {
		details: { images: exerciseDetails.attributes.images },
		history: userExerciseDetails.history,
	};
	return json;
};

export const duplicateOldWorkout = async (
	workout: WorkoutDetailsQuery["workoutDetails"],
) => {
	const inProgress = getDefaultWorkout();
	inProgress.name = workout.name;
	inProgress.repeatedFrom = workout.id;
	for (const [_exerciseIdx, ex] of workout.information.exercises.entries()) {
		const sets = ex.sets.map((s) => ({
			confirmed: false,
			lot: s.lot,
			statistic: {
				...s.statistic,
				duration: s.statistic.duration
					? Number(s.statistic.duration)
					: undefined,
				distance: s.statistic.distance
					? Number(s.statistic.distance)
					: undefined,
				weight: s.statistic.weight ? Number(s.statistic.weight) : undefined,
			},
			endedAt: s.confirmedAt,
		}));
		const exerciseDetails = await getExerciseDetails(ex.name);
		inProgress.exercises.push({
			identifier: randomUUID(),
			isShowDetailsOpen: false,
			exerciseDetails: { images: exerciseDetails.details.images },
			images: [],
			videos: [],
			// biome-ignore lint/suspicious/noExplicitAny: required here
			alreadyDoneSets: sets.map((s) => ({ statistic: s.statistic }) as any),
			exerciseId: ex.name,
			lot: ex.lot,
			notes: ex.notes,
			supersetWith: [],
			restTimer: ex.restTime ? { duration: ex.restTime, enabled: true } : null,
			// biome-ignore lint/suspicious/noExplicitAny: required here
			sets: sets as any,
		});
	}
	for (const [idx, exercise] of workout.information.exercises.entries()) {
		const supersetWith = exercise.supersetWith.map(
			(index) => inProgress.exercises[index].identifier,
		);
		inProgress.exercises[idx].supersetWith = supersetWith;
	}
	return inProgress;
};

export const addExerciseToWorkout = async (
	currentWorkout: InProgressWorkout,
	setCurrentWorkout: (v: InProgressWorkout) => void,
	selectedExercises: Array<{ name: string; lot: ExerciseLot }>,
	navigate: (path: string) => void,
) => {
	const draft = createDraft(currentWorkout);
	for (const [_exerciseIdx, ex] of selectedExercises.entries()) {
		const userExerciseDetails = await getExerciseDetails(ex.name);
		draft.exercises.push({
			identifier: randomUUID(),
			isShowDetailsOpen: false,
			exerciseId: ex.name,
			exerciseDetails: { images: userExerciseDetails.details.images },
			lot: ex.lot,
			sets: [
				{
					confirmed: false,
					statistic: {},
					lot: SetLot.Normal,
				},
			],
			supersetWith: [],
			alreadyDoneSets:
				userExerciseDetails.history?.at(0)?.sets.map((s) => ({
					// biome-ignore lint/suspicious/noExplicitAny: required here
					statistic: s.statistic as any,
				})) || [],
			restTimer: { duration: 60, enabled: true },
			notes: [],
			images: [],
			videos: [],
		});
	}
	const finishedDraft = finishDraft(draft);
	setCurrentWorkout(finishedDraft);
	navigate($path("/fitness/workouts/current"));
};

export const currentWorkoutToCreateWorkoutInput = (
	currentWorkout: InProgressWorkout,
) => {
	const input: CreateUserWorkoutMutationVariables = {
		input: {
			endTime: new Date().toISOString(),
			startTime: new Date(currentWorkout.startTime).toISOString(),
			name: currentWorkout.name,
			comment: currentWorkout.comment,
			repeatedFrom: currentWorkout.repeatedFrom,
			exercises: [],
			assets: {
				images: [...currentWorkout.images],
				videos: [...currentWorkout.videos],
			},
		},
	};
	for (const exercise of currentWorkout.exercises) {
		const sets = Array<UserWorkoutSetRecord>();
		for (const set of exercise.sets)
			if (set.confirmed) {
				sets.push({
					lot: set.lot,
					confirmedAt: set.confirmedAt
						? new Date(set.confirmedAt).toISOString()
						: undefined,
					statistic: {
						...set.statistic,
						distance: set.statistic.distance?.toString(),
						duration: set.statistic.duration?.toString(),
						weight: set.statistic.weight?.toString(),
						// biome-ignore lint/suspicious/noExplicitAny: required here
					} as any,
				});
			}
		if (sets.length === 0) continue;
		const notes = Array<string>();
		for (const note of exercise.notes) if (note) notes.push(note);
		const toAdd = {
			identifier: exercise.identifier,
			exerciseId: exercise.exerciseId,
			notes,
			sets,
			// biome-ignore lint/suspicious/noExplicitAny: required here
			supersetWith: exercise.supersetWith as any,
			assets: {
				images: exercise.images.map((m) => m.key),
				videos: exercise.videos.map((m) => m.key),
			},
			restTime: exercise.restTimer?.enabled
				? exercise.restTimer.duration
				: undefined,
		};
		input.input.exercises.push(toAdd);
	}
	for (const ex of input.input.exercises) {
		let supersetWith = ex.supersetWith.map((identifier) =>
			// biome-ignore lint/suspicious/noExplicitAny: required here
			input.input.exercises.findIndex((e: any) => e.identifier === identifier),
		);
		supersetWith = supersetWith.filter((idx) => idx !== -1);
		ex.supersetWith = supersetWith;
	}
	for (const ex of input.input.exercises) {
		// biome-ignore lint/suspicious/noExplicitAny: required here
		(ex as any).identifier = undefined;
	}
	return input;
};

type Timer = {
	totalTime: number;
	endAt: Dayjs;
	triggeredBy?: { exerciseIdentifier: string; setIdx: number };
};

export const timerAtom = atomWithReset<Timer | null>(null);
