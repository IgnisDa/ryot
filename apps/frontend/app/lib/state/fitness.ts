import type { NavigateFunction } from "@remix-run/react";
import {
	type CreateUserWorkoutMutationVariables,
	ExerciseDetailsDocument,
	type ExerciseLot,
	SetLot,
	UserExerciseDetailsDocument,
	type UserWorkoutSetRecord,
	WorkoutDetailsDocument,
	type WorkoutDetailsQuery,
	type WorkoutInformation,
	type WorkoutSetStatistic,
} from "@ryot/generated/graphql/backend/graphql";
import { queryOptions } from "@tanstack/react-query";
import type { Dayjs } from "dayjs";
import { createDraft, finishDraft } from "immer";
import { atom, useAtom } from "jotai";
import { atomWithReset, atomWithStorage } from "jotai/utils";
import Cookies from "js-cookie";
import { $path } from "remix-routes";
import { withFragment } from "ufo";
import { v4 as randomUUID } from "uuid";
import {
	CurrentWorkoutKey,
	clientGqlService,
	dayjsLib,
	getTimeOfDay,
	queryClient,
	queryFactory,
} from "~/lib/generals";

export type ExerciseSet = {
	statistic: WorkoutSetStatistic;
	lot: SetLot;
	confirmedAt: string | null;
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

export const useCurrentWorkout = () => useAtom(currentWorkoutAtom);

export const useGetExerciseAtIndex = (exerciseIdx: number) => {
	const [currentWorkout] = useCurrentWorkout();
	return currentWorkout?.exercises[exerciseIdx];
};

export const useGetSetAtIndex = (exerciseIdx: number, setIdx: number) => {
	const exercise = useGetExerciseAtIndex(exerciseIdx);
	return exercise?.sets[setIdx];
};

export const getDefaultWorkout = (): InProgressWorkout => {
	const date = new Date();
	return {
		name: `${getTimeOfDay(date.getHours())} Workout`,
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

export const getWorkoutDetailsQuery = (workoutId: string) =>
	queryOptions({
		queryKey: queryFactory.fitness.workoutDetails(workoutId).queryKey,
		queryFn: () =>
			clientGqlService
				.request(WorkoutDetailsDocument, { workoutId })
				.then((data) => data.workoutDetails),
	});

export const getWorkoutDetails = async (workoutId: string) =>
	queryClient.ensureQueryData(getWorkoutDetailsQuery(workoutId));

type TWorkoutDetails = WorkoutDetailsQuery["workoutDetails"];

export const convertHistorySetToCurrentSet = (
	s: Pick<
		TWorkoutDetails["details"]["information"]["exercises"][number]["sets"][number],
		"statistic" | "lot"
	>,
) =>
	({
		lot: s.lot,
		confirmedAt: null,
		statistic: s.statistic,
	}) satisfies ExerciseSet;

export const duplicateOldWorkout = async (
	workoutInformation: WorkoutInformation,
	name: string,
	repeatedFromId?: string,
) => {
	const inProgress = getDefaultWorkout();
	inProgress.name = name;
	inProgress.repeatedFrom = repeatedFromId;
	inProgress.comment = workoutInformation.comment || undefined;
	for (const [_exerciseIdx, ex] of workoutInformation.exercises.entries()) {
		const sets = ex.sets.map(convertHistorySetToCurrentSet);
		const exerciseDetails = await getExerciseDetails(ex.name);
		inProgress.exercises.push({
			identifier: randomUUID(),
			isShowDetailsOpen: false,
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
		});
	}
	for (const [idx, exercise] of workoutInformation.exercises.entries()) {
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
		const alreadyDoneSets = [];
		const allHistory = exerciseDetails.userDetails.history || [];
		for (const history of allHistory.slice(0, 3)) {
			const workout = await getWorkoutDetails(history.workoutId);
			const setStatistics = workout.details.information.exercises[
				history.idx
			].sets.map((s) => s.statistic);
			alreadyDoneSets.push({ statistic: setStatistics[0] });
		}
		draft.exercises.push({
			identifier: randomUUID(),
			isShowDetailsOpen: false,
			exerciseId: ex.name,
			exerciseDetails: {
				images: exerciseDetails.details.attributes.images,
			},
			lot: ex.lot,
			sets: [{ statistic: {}, lot: SetLot.Normal, confirmedAt: null }],
			supersetWith: [],
			alreadyDoneSets,
			restTimer: { duration: 60, enabled: true },
			notes: [],
			images: [],
			videos: [],
		});
	}
	const finishedDraft = finishDraft(draft);
	setCurrentWorkout(finishedDraft);
	const currentEntity = Cookies.get(CurrentWorkoutKey);
	navigate(
		withFragment(
			$path("/fitness/:action", {
				action:
					currentEntity === "workouts" ? "log-workout" : "create-template",
			}),
			idxOfNextExercise.toString(),
		),
	);
};

export const currentWorkoutToCreateWorkoutInput = (
	currentWorkout: InProgressWorkout,
	isCreatingTemplate: boolean,
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
			if (isCreatingTemplate || set.confirmedAt) {
				if (Object.keys(set.statistic).length === 0) continue;
				sets.push({
					lot: set.lot,
					confirmedAt: set.confirmedAt
						? new Date(set.confirmedAt).toISOString()
						: null,
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
