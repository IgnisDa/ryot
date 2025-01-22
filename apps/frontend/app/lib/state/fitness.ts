import type { NavigateFunction } from "@remix-run/react";
import {
	type CreateOrUpdateUserWorkoutMutationVariables,
	ExerciseDetailsDocument,
	type ExerciseLot,
	SetLot,
	type SetRestTimersSettings,
	UserExerciseDetailsDocument,
	type UserFitnessPreferences,
	UserWorkoutDetailsDocument,
	type UserWorkoutDetailsQuery,
	type UserWorkoutSetRecord,
	UserWorkoutTemplateDetailsDocument,
	type WorkoutDuration,
	type WorkoutInformation,
	type WorkoutSetStatistic,
	type WorkoutSupersetsInformation,
} from "@ryot/generated/graphql/backend/graphql";
import { isNumber, isString, mergeWith } from "@ryot/ts-utils";
import { queryOptions } from "@tanstack/react-query";
import { createDraft, finishDraft } from "immer";
import { atom, useAtom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import { $path } from "remix-routes";
import { match } from "ts-pattern";
import { withFragment } from "ufo";
import { v4 as randomUUID } from "uuid";
import {
	CURRENT_WORKOUT_KEY,
	type FitnessAction,
	clientGqlService,
	dayjsLib,
	getTimeOfDay,
	queryClient,
	queryFactory,
} from "~/lib/generals";
import type { useCoreDetails } from "../hooks";

export type ExerciseSet = {
	lot: SetLot;
	rpe?: number | null;
	restTimerStartedAt?: string;
	statistic: WorkoutSetStatistic;
	note?: boolean | string | null;
	displayRestTimeTrigger?: boolean;
	confirmedAt: string | boolean | null;
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
	isShowDetailsOpen: boolean;
	scrollMarginRemoved?: true;
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
	images: Array<Media>;
	videos: Array<string>;
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

type CurrentWorkout = InProgressWorkout | null;

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

export const getDefaultWorkout = (
	fitnessEntity: FitnessAction,
): InProgressWorkout => {
	const date = dayjsLib().add(3, "second");
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
	};
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
	set: Pick<TSet, "statistic" | "lot" | "note" | "restTime" | "rpe">,
	confirmedAt?: string | null,
) =>
	({
		lot: set.lot,
		rpe: set.rpe,
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
			durations: currentWorkout.durations,
			templateId: currentWorkout.templateId,
			repeatedFrom: currentWorkout.repeatedFrom,
			updateWorkoutId: currentWorkout.updateWorkoutId,
			caloriesBurnt: currentWorkout.caloriesBurnt?.toString(),
			updateWorkoutTemplateId: currentWorkout.updateWorkoutTemplateId,
			startTime: new Date(currentWorkout.startTime).toISOString(),
			assets: {
				videos: [...currentWorkout.videos],
				images: currentWorkout.images.map((m) => m.key),
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
	willEndAt: string;
	totalTime: number;
	wasPausedAt?: string;
	triggeredBy?: { exerciseIdentifier: string; setIdx: number };
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
	workoutInformation: WorkoutInformation,
	coreDetails: ReturnType<typeof useCoreDetails>,
	userFitnessPreferences: UserFitnessPreferences,
	params: {
		templateId?: string;
		repeatedFromId?: string;
		updateWorkoutId?: string;
		updateWorkoutTemplateId?: string;
	},
) => {
	const inProgress = getDefaultWorkout(fitnessEntity);
	inProgress.name = name;
	inProgress.repeatedFrom = params.repeatedFromId;
	inProgress.templateId = params.templateId;
	inProgress.updateWorkoutId = params.updateWorkoutId;
	inProgress.updateWorkoutTemplateId = params.updateWorkoutTemplateId;
	inProgress.comment = workoutInformation.comment || undefined;
	for (const [exerciseIdx, ex] of workoutInformation.exercises.entries()) {
		const sets = ex.sets.map((v) =>
			convertHistorySetToCurrentSet(
				v,
				params.updateWorkoutId ? v.confirmedAt : undefined,
			),
		);
		const exerciseDetails = await getExerciseDetails(ex.id);
		inProgress.exercises.push({
			identifier: randomUUID(),
			isShowDetailsOpen: userFitnessPreferences.logging.showDetailsWhileEditing
				? exerciseIdx === 0
				: false,
			images: [],
			videos: [],
			alreadyDoneSets: sets.map((s) => ({ statistic: s.statistic })),
			exerciseId: ex.id,
			lot: ex.lot,
			notes: ex.notes,
			sets: sets,
			openedDetailsTab: !coreDetails.isServerKeyValidated
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
	userFitnessPreferences: UserFitnessPreferences,
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
			userFitnessPreferences.exercises.setRestTimers,
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
			isShowDetailsOpen: userFitnessPreferences.logging.showDetailsWhileEditing,
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
	navigate(
		withFragment(
			$path("/fitness/:action", {
				action: currentWorkout.currentAction,
			}),
			idxOfNextExercise.toString(),
		),
	);
};
