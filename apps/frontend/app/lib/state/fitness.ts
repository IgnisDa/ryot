import type { NavigateFunction } from "@remix-run/react";
import {
	type CreateOrUpdateUserWorkoutMutationVariables,
	ExerciseDetailsDocument,
	type ExerciseLot,
	SetLot,
	type SetRestTimersSettings,
	UserExerciseDetailsDocument,
	UserWorkoutDetailsDocument,
	type UserWorkoutDetailsQuery,
	type UserWorkoutSetRecord,
	UserWorkoutTemplateDetailsDocument,
	type WorkoutInformation,
	type WorkoutSetStatistic,
	type WorkoutSupersetsInformation,
} from "@ryot/generated/graphql/backend/graphql";
import { isNumber, isString, mergeWith } from "@ryot/ts-utils";
import { queryOptions } from "@tanstack/react-query";
import { createDraft, finishDraft } from "immer";
import { atom, useAtom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import Cookies from "js-cookie";
import { $path } from "remix-routes";
import { match } from "ts-pattern";
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
import type { useCoreDetails } from "../hooks";

export type ExerciseSet = {
	lot: SetLot;
	confirmedAt: string | null;
	statistic: WorkoutSetStatistic;
	note?: boolean | string | null;
	restTimer?: { duration: number; hasElapsed?: boolean } | null;
};

type AlreadyDoneExerciseSet = Pick<ExerciseSet, "statistic">;

type Media = { imageSrc: string; key: string };

export type Exercise = {
	lot: ExerciseLot;
	identifier: string;
	exerciseId: string;
	notes: Array<string>;
	videos: Array<Media>;
	images: Array<Media>;
	isCollapsed?: boolean;
	sets: Array<ExerciseSet>;
	openedDetailsTab?: "images" | "history";
	alreadyDoneSets: Array<AlreadyDoneExerciseSet>;
};

export type Superset = Omit<WorkoutSupersetsInformation, "exercises"> & {
	identifier: string;
	exercises: Array<string>;
};

export type InProgressWorkout = {
	name: string;
	comment?: string;
	endTime?: string;
	startTime: string;
	templateId?: string;
	videos: Array<string>;
	repeatedFrom?: string;
	supersets: Superset[];
	images: Array<string>;
	updateWorkoutId?: string;
	exercises: Array<Exercise>;
	replacingExerciseIdx?: number;
	updateWorkoutTemplateId?: string;
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
		images: [],
		videos: [],
		supersets: [],
		exercises: [],
		startTime: date.toISOString(),
		name: `${getTimeOfDay(date.getHours())} Workout`,
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
				.request(UserWorkoutDetailsDocument, { workoutId })
				.then((data) => data.userWorkoutDetails),
	});

export const getWorkoutDetails = async (workoutId: string) =>
	queryClient.ensureQueryData(getWorkoutDetailsQuery(workoutId));

export const getWorkoutTemplateDetailsQuery = (workoutTemplateId: string) =>
	queryOptions({
		queryKey:
			queryFactory.fitness.workoutTemplateDetails(workoutTemplateId).queryKey,
		queryFn: () =>
			clientGqlService
				.request(UserWorkoutTemplateDetailsDocument, { workoutTemplateId })
				.then((data) => data.userWorkoutTemplateDetails),
	});

type TWorkoutDetails = UserWorkoutDetailsQuery["userWorkoutDetails"];
type TSet =
	TWorkoutDetails["details"]["information"]["exercises"][number]["sets"][number];

export const convertHistorySetToCurrentSet = (
	set: Pick<TSet, "statistic" | "lot" | "note" | "restTime">,
	confirmedAt?: string | null,
) =>
	({
		lot: set.lot,
		note: set.note,
		statistic: set.statistic,
		confirmedAt: confirmedAt ?? null,
		restTimer: set.restTime ? { duration: set.restTime } : null,
	}) satisfies ExerciseSet;

export const currentWorkoutToCreateWorkoutInput = (
	currentWorkout: InProgressWorkout,
	isCreatingTemplate: boolean,
) => {
	const supersets = currentWorkout.supersets.map((sup) => ({
		color: sup.color,
		exercises: sup.exercises.map((e) =>
			currentWorkout.exercises.findIndex((ex) => ex.identifier === e),
		),
	}));
	const input: CreateOrUpdateUserWorkoutMutationVariables = {
		input: {
			supersets,
			exercises: [],
			name: currentWorkout.name,
			comment: currentWorkout.comment,
			endTime: new Date().toISOString(),
			templateId: currentWorkout.templateId,
			repeatedFrom: currentWorkout.repeatedFrom,
			updateWorkoutId: currentWorkout.updateWorkoutId,
			updateWorkoutTemplateId: currentWorkout.updateWorkoutTemplateId,
			startTime: new Date(currentWorkout.startTime).toISOString(),
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
				const note = isString(set.note) ? set.note : undefined;
				if (Object.keys(set.statistic).length === 0) continue;
				sets.push({
					note,
					lot: set.lot,
					confirmedAt: set.confirmedAt
						? new Date(set.confirmedAt).toISOString()
						: null,
					statistic: set.statistic,
					restTime: set.restTimer?.duration,
				});
			}
		if (sets.length === 0) continue;
		const notes = Array<string>();
		for (const note of exercise.notes) if (note) notes.push(note);
		const toAdd = {
			sets,
			notes,
			exerciseId: exercise.exerciseId,
			assets: {
				images: exercise.images.map((m) => m.key),
				videos: exercise.videos.map((m) => m.key),
			},
		};
		input.input.exercises.push(toAdd);
	}
	return input;
};

export type CurrentWorkoutTimer = {
	endAt: string;
	totalTime: number;
	triggeredBy?: { exerciseIdentifier: string; setIdx: number };
};

const timerAtom = atomWithStorage<CurrentWorkoutTimer | null>(
	"CurrentWorkoutTimer",
	null,
);

export const useTimerAtom = () => useAtom(timerAtom);

const measurementsDrawerOpenAtom = atom(false);

export const useMeasurementsDrawerOpen = () =>
	useAtom(measurementsDrawerOpenAtom);

export const duplicateOldWorkout = async (
	name: string,
	workoutInformation: WorkoutInformation,
	coreDetails: ReturnType<typeof useCoreDetails>,
	params: {
		repeatedFromId?: string;
		templateId?: string;
		updateWorkoutId?: string;
		updateWorkoutTemplateId?: string;
	},
) => {
	const inProgress = getDefaultWorkout();
	inProgress.name = name;
	inProgress.repeatedFrom = params.repeatedFromId;
	inProgress.templateId = params.templateId;
	inProgress.updateWorkoutId = params.updateWorkoutId;
	inProgress.updateWorkoutTemplateId = params.updateWorkoutTemplateId;
	inProgress.comment = workoutInformation.comment || undefined;
	for (const ex of workoutInformation.exercises) {
		const sets = ex.sets.map((v) =>
			convertHistorySetToCurrentSet(
				v,
				params.updateWorkoutId ? v.confirmedAt : undefined,
			),
		);
		const exerciseDetails = await getExerciseDetails(ex.name);
		inProgress.exercises.push({
			identifier: randomUUID(),
			images: [],
			videos: [],
			alreadyDoneSets: sets.map((s) => ({ statistic: s.statistic })),
			exerciseId: ex.name,
			lot: ex.lot,
			notes: ex.notes,
			sets: sets,
			openedDetailsTab: !coreDetails.isPro
				? "images"
				: (exerciseDetails.userDetails.history?.length || 0) > 0
					? "history"
					: "images",
		});
	}
	const supersets = workoutInformation.supersets.map((sup) => ({
		...sup,
		identifier: randomUUID(),
		exercises: sup.exercises.map((e) => inProgress.exercises[e].identifier),
	}));
	inProgress.supersets = supersets;
	return inProgress;
};

export const getRestTimerForSet = async (
	lot: SetLot,
	exerciseId: string,
	userPreferencesRestTimer: SetRestTimersSettings,
) => {
	const exerciseDetails = await getExerciseDetails(exerciseId);
	const mergedSettings = mergeWith(
		{},
		exerciseDetails.userDetails.details?.exerciseExtraInformation?.settings
			.setRestTimers || {},
		userPreferencesRestTimer,
		(objValue?: number, srcValue?: number) => {
			if (isNumber(objValue)) return objValue;
			if (isNumber(srcValue)) return srcValue;
			return undefined;
		},
	);
	const restTime = match(lot)
		.with(SetLot.Normal, () => mergedSettings.normal)
		.with(SetLot.Drop, () => mergedSettings.drop)
		.with(SetLot.WarmUp, () => mergedSettings.warmup)
		.with(SetLot.Failure, () => mergedSettings.failure)
		.exhaustive();
	return restTime;
};

export const addExerciseToWorkout = async (
	navigate: NavigateFunction,
	currentWorkout: InProgressWorkout,
	userPreferencesRestTimer: SetRestTimersSettings,
	setCurrentWorkout: (v: InProgressWorkout) => void,
	selectedExercises: Array<{ name: string; lot: ExerciseLot }>,
) => {
	const draft = createDraft(currentWorkout);
	const idxOfNextExercise = draft.exercises.length;
	for (const [_exerciseIdx, ex] of selectedExercises.entries()) {
		const exerciseDetails = await getExerciseDetails(ex.name);
		const setLot = SetLot.Normal;
		const restTimer = await getRestTimerForSet(
			setLot,
			ex.name,
			userPreferencesRestTimer,
		);
		let sets: ExerciseSet[] = [
			{
				lot: setLot,
				statistic: {},
				confirmedAt: null,
				restTimer: restTimer ? { duration: restTimer } : undefined,
			},
		];
		let alreadyDoneSets: AlreadyDoneExerciseSet[] = [];
		const history = (exerciseDetails.userDetails.history || []).at(0);
		if (history) {
			const workout = await getWorkoutDetails(history.workoutId);
			sets = workout.details.information.exercises[history.idx].sets.map((v) =>
				convertHistorySetToCurrentSet(v),
			);
			alreadyDoneSets = sets.map((s) => ({ statistic: s.statistic }));
		}
		draft.exercises.push({
			identifier: randomUUID(),
			exerciseId: ex.name,
			lot: ex.lot,
			sets,
			alreadyDoneSets,
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
	const currentEntity = Cookies.get(CurrentWorkoutKey);
	if (!currentEntity) return;
	navigate(
		withFragment(
			$path("/fitness/:action", { action: currentEntity }),
			idxOfNextExercise.toString(),
		),
	);
};
