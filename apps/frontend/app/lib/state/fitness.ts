import type { NavigateFunction } from "@remix-run/react";
import {
	type CreateOrUpdateUserWorkoutMutationVariables,
	ExerciseDetailsDocument,
	type ExerciseLot,
	type RestTimersSettings,
	SetLot,
	UserExerciseDetailsDocument,
	UserWorkoutDetailsDocument,
	type UserWorkoutDetailsQuery,
	type UserWorkoutSetRecord,
	UserWorkoutTemplateDetailsDocument,
	type WorkoutInformation,
	type WorkoutSetStatistic,
} from "@ryot/generated/graphql/backend/graphql";
import { isNumber, isString, mergeWith } from "@ryot/ts-utils";
import { queryOptions } from "@tanstack/react-query";
import type { Dayjs } from "dayjs";
import { createDraft, finishDraft } from "immer";
import { atom, useAtom } from "jotai";
import { atomWithReset, atomWithStorage } from "jotai/utils";
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
	restTimer?: {
		duration: number;
		isActive?: boolean;
		hasElapsed?: boolean;
	} | null;
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
	updateWorkoutId?: string;
	updateWorkoutTemplateId?: string;
	repeatedFrom?: string;
	templateId?: string;
	startTime: string;
	endTime?: string;
	name: string;
	comment?: string;
	defaultRestTimer?: number | null;
	exercises: Array<Exercise>;
	videos: Array<string>;
	images: Array<string>;
	highlightedSet?: { exerciseIdx: number; setIdx: number };
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
	const input: CreateOrUpdateUserWorkoutMutationVariables = {
		input: {
			endTime: new Date().toISOString(),
			templateId: currentWorkout.templateId,
			updateWorkoutId: currentWorkout.updateWorkoutId,
			updateWorkoutTemplateId: currentWorkout.updateWorkoutTemplateId,
			startTime: new Date(currentWorkout.startTime).toISOString(),
			name: currentWorkout.name,
			comment: currentWorkout.comment,
			repeatedFrom: currentWorkout.repeatedFrom,
			defaultRestTimer: currentWorkout.defaultRestTimer,
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
			identifier: exercise.identifier,
			exerciseId: exercise.exerciseId,
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

export const duplicateOldWorkout = async (
	workoutInformation: WorkoutInformation,
	name: string,
	coreDetails: ReturnType<typeof useCoreDetails>,
	params: {
		repeatedFromId?: string;
		templateId?: string;
		updateWorkoutId?: string;
		updateWorkoutTemplateId?: string;
		defaultRestTimer?: number | null;
	},
) => {
	const inProgress = getDefaultWorkout();
	inProgress.name = name;
	inProgress.repeatedFrom = params.repeatedFromId;
	inProgress.templateId = params.templateId;
	inProgress.updateWorkoutId = params.updateWorkoutId;
	inProgress.updateWorkoutTemplateId = params.updateWorkoutTemplateId;
	inProgress.comment = workoutInformation.comment || undefined;
	inProgress.defaultRestTimer = params.defaultRestTimer;
	for (const [exerciseIdx, ex] of workoutInformation.exercises.entries()) {
		const sets = ex.sets.map((v) =>
			convertHistorySetToCurrentSet(
				v,
				params.updateWorkoutId ? v.confirmedAt : undefined,
			),
		);
		const exerciseDetails = await getExerciseDetails(ex.name);
		const defaultRestTime = params.defaultRestTimer || ex.restTime;
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
			restTimer: defaultRestTime
				? { duration: defaultRestTime, enabled: true }
				: null,
			sets: sets,
			openedDetailsTab: !coreDetails.isPro
				? "images"
				: (exerciseDetails.userDetails.history?.length || 0) > 0
					? "history"
					: "images",
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

export const getRestTimerForSet = async (
	lot: SetLot,
	exerciseId: string,
	userPreferencesRestTimer: RestTimersSettings,
) => {
	const exerciseDetails = await getExerciseDetails(exerciseId);
	const mergedSettings = mergeWith(
		{},
		exerciseDetails.userDetails.details?.exerciseExtraInformation?.settings
			.restTimers || {},
		userPreferencesRestTimer,
		(objValue?: number, srcValue?: number) => {
			if (isNumber(objValue)) return objValue;
			if (isNumber(srcValue)) return srcValue;
			return undefined;
		},
	);
	const restTime = match(lot)
		.with(SetLot.Normal, () => mergedSettings.normalSet)
		.with(SetLot.Drop, () => mergedSettings.dropSet)
		.with(SetLot.WarmUp, () => mergedSettings.warmupSet)
		.with(SetLot.Failure, () => mergedSettings.failureSet)
		.exhaustive();
	return restTime;
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
		let sets: ExerciseSet[] = [
			{ statistic: {}, lot: SetLot.Normal, confirmedAt: null },
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
			isShowDetailsOpen: true,
			exerciseId: ex.name,
			exerciseDetails: {
				images: exerciseDetails.details.attributes.images,
			},
			lot: ex.lot,
			sets,
			supersetWith: [],
			alreadyDoneSets,
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
	const currentEntity = Cookies.get(CurrentWorkoutKey);
	if (!currentEntity) return;
	navigate(
		withFragment(
			$path("/fitness/:action", { action: currentEntity }),
			idxOfNextExercise.toString(),
		),
	);
};
