import { $path } from "@ignisda/remix-routes";
import type { NavigateFunction } from "@remix-run/react";
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
import { isString } from "@ryot/ts-utils";
import { queryOptions } from "@tanstack/react-query";
import type { Dayjs } from "dayjs";
import { createDraft, finishDraft } from "immer";
import { atom, useAtom } from "jotai";
import { atomWithReset, atomWithStorage } from "jotai/utils";
import { withFragment } from "ufo";
import { v4 as randomUUID } from "uuid";
import {
	CurrentWorkoutKey,
	clientGqlService,
	dayjsLib,
	queryClient,
	queryFactory,
} from "~/lib/generals";

export type ExerciseSet = {
	statistic: WorkoutSetStatistic;
	lot: SetLot;
	confirmedAt: string | null;
	note?: boolean | string | null;
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
	openedDetailsTab?: "images" | "history";
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

export const useCurrentWorkout = () => useAtom(currentWorkoutAtom);

export const useGetExerciseAtIndex = (exerciseIdx: number) => {
	const [currentWorkout] = useCurrentWorkout();
	return currentWorkout?.exercises[exerciseIdx];
};

export const useGetSetAtIndex = (exerciseIdx: number, setIdx: number) => {
	const exercise = useGetExerciseAtIndex(exerciseIdx);
	return exercise?.sets[setIdx];
};

const getTimeOfDay = (date: Date) => {
	const hours = date.getHours();
	if (hours >= 5 && hours < 12) return "Morning";
	if (hours >= 12 && hours < 17) return "Afternoon";
	if (hours >= 17 && hours < 21) return "Evening";
	return "Night";
};

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

export const getExerciseDetailsQuery = (exerciseId: string) =>
	queryOptions({
		queryKey: queryFactory.fitness.exerciseDetails(exerciseId).queryKey,
		queryFn: () =>
			clientGqlService
				.request(ExerciseDetailsDocument, { exerciseId })
				.then((data) => data.exerciseDetails),
		staleTime: dayjsLib.duration(1, "day").asMilliseconds(),
	});

export const getUserExerciseDetailsQuery = (exerciseId: string) =>
	queryOptions({
		queryKey: queryFactory.fitness.userExerciseDetails(exerciseId).queryKey,
		queryFn: () =>
			clientGqlService
				.request(UserExerciseDetailsDocument, { exerciseId })
				.then((data) => data.userExerciseDetails),
	});

const getExerciseDetails = async (exerciseId: string) => {
	const [details, userDetails] = await Promise.all([
		queryClient.ensureQueryData(getExerciseDetailsQuery(exerciseId)),
		queryClient.ensureQueryData(getUserExerciseDetailsQuery(exerciseId)),
	]);
	return { details, userDetails };
};

type TWorkoutDetails = WorkoutDetailsQuery["workoutDetails"];

export const convertHistorySetToCurrentSet = (
	s: Pick<
		TWorkoutDetails["information"]["exercises"][number]["sets"][number],
		"statistic" | "lot"
	>,
) =>
	({
		lot: s.lot,
		confirmedAt: null,
		statistic: s.statistic,
	}) satisfies ExerciseSet;

export const duplicateOldWorkout = async (workout: TWorkoutDetails) => {
	const inProgress = getDefaultWorkout();
	inProgress.name = workout.name;
	inProgress.repeatedFrom = workout.id;
	for (const [exerciseIdx, ex] of workout.information.exercises.entries()) {
		const sets = ex.sets.map(convertHistorySetToCurrentSet);
		const exerciseDetails = await getExerciseDetails(ex.name);
		inProgress.exercises.push({
			identifier: randomUUID(),
			isShowDetailsOpen: exerciseIdx === 0,
			exerciseDetails: { images: exerciseDetails.details.attributes.images },
			images: [],
			videos: [],
			alreadyDoneSets: sets.map((s) => ({ statistic: s.statistic })),
			exerciseId: ex.name,
			lot: ex.lot,
			notes: ex.notes,
			supersetWith: [],
			restTimer: ex.restTime ? { duration: ex.restTime, enabled: true } : null,
			sets: sets,
			openedDetailsTab:
				(exerciseDetails.userDetails.history?.length || 0) > 0
					? "history"
					: "images",
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
	navigate: NavigateFunction,
) => {
	const draft = createDraft(currentWorkout);
	const idxOfNextExercise = draft.exercises.length;
	for (const [_exerciseIdx, ex] of selectedExercises.entries()) {
		const exerciseDetails = await getExerciseDetails(ex.name);
		draft.exercises.push({
			identifier: randomUUID(),
			isShowDetailsOpen: true,
			exerciseId: ex.name,
			exerciseDetails: {
				images: exerciseDetails.details.attributes.images,
			},
			lot: ex.lot,
			sets: [{ statistic: {}, lot: SetLot.Normal, confirmedAt: null }],
			supersetWith: [],
			alreadyDoneSets:
				exerciseDetails.userDetails.history?.at(0)?.sets.map((s) => ({
					statistic: s.statistic,
				})) || [],
			restTimer: { duration: 60, enabled: true },
			notes: [],
			images: [],
			videos: [],
			openedDetailsTab:
				(exerciseDetails.userDetails.history?.length || 0) > 0
					? "history"
					: "images",
		});
	}
	const finishedDraft = finishDraft(draft);
	setCurrentWorkout(finishedDraft);
	navigate(
		withFragment(
			$path("/fitness/workouts/current"),
			idxOfNextExercise.toString(),
		),
	);
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
			if (set.confirmedAt) {
				const note = isString(set.note) ? set.note : undefined;
				sets.push({
					note,
					lot: set.lot,
					confirmedAt: new Date(set.confirmedAt).toISOString(),
					statistic: set.statistic,
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

export const exerciseHasDetailsToShow = (exercise: Exercise) =>
	exercise.exerciseDetails.images.length > 0;

type Timer = {
	totalTime: number;
	endAt: Dayjs;
	triggeredBy?: { exerciseIdentifier: string; setIdx: number };
};

const timerAtom = atomWithReset<Timer | null>(null);

export const useTimerAtom = () => useAtom(timerAtom);

const measurementsDrawerOpenAtom = atom(false);

export const useMeasurementsDrawerOpen = () =>
	useAtom(measurementsDrawerOpenAtom);
