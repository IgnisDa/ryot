import {
	type CreateOrUpdateUserWorkoutMutationVariables,
	ExerciseDetailsDocument,
	type ExerciseDetailsQuery,
	type ExerciseLot,
	SetLot,
	type SetRestTimersSettings,
	UserExerciseDetailsDocument,
	type UserFitnessPreferences,
	type UserUnitSystem,
	UserWorkoutDetailsDocument,
	type UserWorkoutDetailsQuery,
	type UserWorkoutSetRecord,
	UserWorkoutTemplateDetailsDocument,
	type WorkoutInformation,
	type WorkoutSetStatistic,
	type WorkoutSupersetsInformation,
} from "@ryot/generated/graphql/backend/graphql";
import { isNumber, isString, mergeWith, sum } from "@ryot/ts-utils";
import { queryOptions } from "@tanstack/react-query";
import { createDraft, finishDraft } from "immer";
import { atom, useAtom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import type { NavigateFunction } from "react-router";
import { $path } from "safe-routes";
import { match } from "ts-pattern";
import { v4 as randomUUID } from "uuid";
import { CURRENT_WORKOUT_KEY } from "~/lib/shared/constants";
import { dayjsLib, getTimeOfDay } from "~/lib/shared/date-utils";
import {
	clientGqlService,
	queryClient,
	queryFactory,
} from "~/lib/shared/react-query";
import { FitnessAction } from "~/lib/types";

export type WorkoutDuration = {
	from: string;
	to?: string;
};

export type ExerciseSet = {
	lot: SetLot;
	identifier: string;
	rpe?: number | null;
	restTimerStartedAt?: string;
	durationTimerTriggered?: true;
	statistic: WorkoutSetStatistic;
	note?: boolean | string | null;
	displayRestTimeTrigger?: boolean;
	confirmedAt: string | boolean | null;
	restTimer?: { duration: number; hasElapsed?: boolean } | null;
};

type S3Key = string;

export type Exercise = {
	lot: ExerciseLot;
	identifier: string;
	exerciseId: string;
	notes: Array<string>;
	videos: Array<S3Key>;
	images: Array<S3Key>;
	isCollapsed?: boolean;
	sets: Array<ExerciseSet>;
	scrollMarginRemoved?: true;
	unitSystem: UserUnitSystem;
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
	images: Array<S3Key>;
	videos: Array<S3Key>;
	repeatedFrom?: string;
	supersets: Superset[];
	caloriesBurnt?: number;
	updateWorkoutId?: string;
	exercises: Array<Exercise>;
	currentAction: FitnessAction;
	replacingExerciseIdx?: number;
	updateWorkoutTemplateId?: string;
	durations: Array<WorkoutDuration>;
	timerDrawerLot: "timer" | "stopwatch";
};

export type CurrentWorkout = InProgressWorkout | null;

const currentWorkoutAtom = atomWithStorage<CurrentWorkout>(
	CURRENT_WORKOUT_KEY,
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

export const getDefaultWorkout = (fitnessEntity: FitnessAction) => {
	const date = dayjsLib().add(1, "second");
	return {
		images: [],
		videos: [],
		supersets: [],
		exercises: [],
		timerDrawerLot: "timer",
		startTime: date.toISOString(),
		currentAction: fitnessEntity,
		durations: [{ from: date.toISOString() }],
		name: `${getTimeOfDay(date.hour())} Workout`,
	} as InProgressWorkout;
};

export const getExerciseDetailsQuery = (exerciseId: string) =>
	queryOptions({
		queryKey: queryFactory.fitness.exerciseDetails(exerciseId).queryKey,
		queryFn: () =>
			clientGqlService
				.request(ExerciseDetailsDocument, { exerciseId })
				.then((data) => data.exerciseDetails),
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
				.then((data) => data.userWorkoutDetails.response),
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
				.then((data) => data.userWorkoutTemplateDetails.response),
	});

export type TWorkoutDetails =
	UserWorkoutDetailsQuery["userWorkoutDetails"]["response"];
type TSet =
	TWorkoutDetails["details"]["information"]["exercises"][number]["sets"][number];

export const convertHistorySetToCurrentSet = (
	set: Pick<TSet, "statistic" | "lot" | "note" | "restTime" | "rpe">,
	confirmedAt?: string | null,
) =>
	({
		lot: set.lot,
		rpe: set.rpe,
		note: set.note,
		identifier: randomUUID(),
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
	const totalDuration = sum(
		currentWorkout.durations.map(
			(d) => dayjsLib(d.to || currentWorkout.endTime).diff(d.from) / 1000,
		),
	);
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
			caloriesBurnt: currentWorkout.caloriesBurnt?.toString(),
			startTime: new Date(currentWorkout.startTime).toISOString(),
			updateWorkoutTemplateId: currentWorkout.updateWorkoutTemplateId,
			duration:
				currentWorkout.currentAction === FitnessAction.UpdateWorkout
					? null
					: Math.trunc(totalDuration),
			assets: {
				remoteImages: [],
				remoteVideos: [],
				s3Videos: currentWorkout.videos,
				s3Images: currentWorkout.images,
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
					rpe: set.rpe,
					lot: set.lot,
					statistic: set.statistic,
					restTime: set.restTimer?.duration,
					restTimerStartedAt: set.restTimerStartedAt,
					confirmedAt:
						set.confirmedAt && isString(set.confirmedAt)
							? new Date(set.confirmedAt).toISOString()
							: null,
				});
			}
		if (!isCreatingTemplate && sets.length === 0) continue;
		const notes = Array<string>();
		for (const note of exercise.notes) if (note) notes.push(note);
		input.input.exercises.push({
			sets,
			notes,
			unitSystem: exercise.unitSystem,
			exerciseId: exercise.exerciseId,
			assets: {
				remoteImages: [],
				remoteVideos: [],
				s3Images: exercise.images,
				s3Videos: exercise.videos,
			},
		});
	}
	return input;
};

export type SetIdentifier = {
	setIdentifier: string;
	exerciseIdentifier: string;
};

export type CurrentWorkoutTimer = {
	willEndAt: string;
	totalTime: number;
	wasPausedAt?: string;
	triggeredBy?: SetIdentifier;
	confirmSetOnFinish?: SetIdentifier;
};

const currentWorkoutTimerAtom = atomWithStorage<CurrentWorkoutTimer | null>(
	"CurrentWorkoutTimer",
	null,
);

export const useCurrentWorkoutTimerAtom = () =>
	useAtom(currentWorkoutTimerAtom);

export type CurrentWorkoutStopwatch = Array<WorkoutDuration> | null;

const currentWorkoutStopwatchAtom = atomWithStorage<CurrentWorkoutStopwatch>(
	"CurrentWorkoutStopwatch",
	null,
);

export const useCurrentWorkoutStopwatchAtom = () =>
	useAtom(currentWorkoutStopwatchAtom);

const measurementsDrawerOpenAtom = atom(false);

export const useMeasurementsDrawerOpen = () =>
	useAtom(measurementsDrawerOpenAtom);

export const mergingExerciseAtom = atom<string | null>(null);

export const useMergingExercise = () => useAtom(mergingExerciseAtom);

export const duplicateOldWorkout = async (
	name: string,
	fitnessEntity: FitnessAction,
	caloriesBurnt: number | undefined,
	workoutInformation: WorkoutInformation,
	params: {
		templateId?: string;
		repeatedFromId?: string;
		updateWorkoutId?: string;
		updateWorkoutTemplateId?: string;
	},
) => {
	const inProgress = getDefaultWorkout(fitnessEntity);
	inProgress.name = name;
	inProgress.caloriesBurnt = caloriesBurnt;
	inProgress.templateId = params.templateId;
	inProgress.repeatedFrom = params.repeatedFromId;
	inProgress.updateWorkoutId = params.updateWorkoutId;
	inProgress.comment = workoutInformation.comment || undefined;
	inProgress.updateWorkoutTemplateId = params.updateWorkoutTemplateId;
	for (const [_exerciseIdx, ex] of workoutInformation.exercises.entries()) {
		const sets = ex.sets.map((v) =>
			convertHistorySetToCurrentSet(
				v,
				params.updateWorkoutId ? v.confirmedAt : undefined,
			),
		);
		inProgress.exercises.push({
			images: [],
			videos: [],
			sets: sets,
			lot: ex.lot,
			notes: ex.notes,
			exerciseId: ex.id,
			identifier: randomUUID(),
			unitSystem: ex.unitSystem,
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

export const addExerciseToCurrentWorkout = async (
	navigate: NavigateFunction,
	currentWorkout: InProgressWorkout,
	userFitnessPreferences: UserFitnessPreferences,
	setCurrentWorkout: (v: InProgressWorkout) => void,
	selectedExercises: Array<{ id: string; lot: ExerciseLot }>,
) => {
	const draft = createDraft(currentWorkout);
	for (const [_exerciseIdx, ex] of selectedExercises.entries()) {
		const setLot = SetLot.Normal;
		const restTimer = await getRestTimerForSet(
			setLot,
			ex.id,
			userFitnessPreferences.exercises.setRestTimers,
		);
		let sets: ExerciseSet[] = [
			{
				lot: setLot,
				statistic: {},
				confirmedAt: null,
				identifier: randomUUID(),
				restTimer: restTimer ? { duration: restTimer } : undefined,
			},
		];
		const exerciseDetails = await getExerciseDetails(ex.id);
		const history = (exerciseDetails.userDetails.history || []).at(0);
		if (history) {
			const workout = await getWorkoutDetails(history.workoutId);
			sets = workout.details.information.exercises[history.idx].sets.map((v) =>
				convertHistorySetToCurrentSet(v),
			);
		}
		draft.exercises.push({
			sets,
			notes: [],
			images: [],
			videos: [],
			lot: ex.lot,
			exerciseId: ex.id,
			identifier: randomUUID(),
			unitSystem: userFitnessPreferences.exercises.unitSystem,
		});
	}
	const finishedDraft = finishDraft(draft);
	setCurrentWorkout(finishedDraft);
	navigate($path("/fitness/:action", { action: currentWorkout.currentAction }));
};

export const getExerciseImages = (
	exercise?: ExerciseDetailsQuery["exerciseDetails"],
) => {
	return [
		...(exercise?.assets.s3Images || []),
		...(exercise?.assets.remoteImages || []),
	];
};
