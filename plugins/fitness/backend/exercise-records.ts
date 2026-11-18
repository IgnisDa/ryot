import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";
import type { EventId } from "@ryot-app/plugin-kit/schema";

import { type ExerciseKind, exerciseKindSchema } from "../shared/exercise-kinds";
import {
	calculateWorkoutSetStatistics,
	type PersonalBest,
	PersonalBestSchema,
	personalBestTypes,
	recordCandidates,
} from "../shared/workout-records";

export const unorderedLast = 2147483647;

/** A set as the records fold orders it: by occurrence, workout start, workout, then declared order. */
export type RecordSet = {
	readonly id: EventId;
	readonly occurredAt: string;
	readonly reps: null | number;
	readonly weight: null | number;
	readonly duration: null | number;
	readonly distance: null | number;
	readonly startedAt: null | string;
	readonly setOrder: null | number;
	readonly sessionEntityId: string;
	readonly exerciseKind: ExerciseKind;
	readonly exerciseOrder: null | number;
};

const SetPosition = Schema.Tuple([
	Schema.String,
	Schema.NullOr(Schema.String),
	Schema.String,
	Schema.Finite,
	Schema.Finite,
	Schema.String,
]);
type SetPosition = typeof SetPosition.Type;

const PersonalRecord = Schema.Struct({
	value: Schema.Finite,
	type: PersonalBestSchema,
	position: SetPosition,
	kind: exerciseKindSchema,
});
type PersonalRecord = typeof PersonalRecord.Type;

/** Every set that set a personal best, in set order: the running maximum of each kind and record type. */
export const ExerciseRecordsValue = Schema.Struct({ records: Schema.Array(PersonalRecord) });
export type ExerciseRecordsValue = typeof ExerciseRecordsValue.Type;

/** Sets after `from` whose candidate for `type` lies in `(above, atMost]` for one of `bounds`. */
export type LaterSetsRequest = {
	readonly from: string;
	readonly excluded: ReadonlyArray<string>;
	readonly bounds: ReadonlyArray<{
		readonly kind: ExerciseKind;
		readonly type: PersonalBest;
		readonly above: number;
		readonly atMost: number;
	}>;
};

const compareText = (left: string, right: string) => {
	if (left === right) {
		return 0;
	}
	return left < right ? -1 : 1;
};

const positionOf = (set: RecordSet): SetPosition => [
	new Date(Date.parse(set.occurredAt)).toISOString(),
	set.startedAt === null ? null : new Date(Date.parse(set.startedAt)).toISOString(),
	set.sessionEntityId,
	set.exerciseOrder ?? unorderedLast,
	set.setOrder ?? unorderedLast,
	set.id,
];

const comparePositions = (left: SetPosition, right: SetPosition) =>
	Date.parse(left[0]) - Date.parse(right[0]) ||
	(left[1] === null || right[1] === null
		? Number(left[1] === null) - Number(right[1] === null)
		: Date.parse(left[1]) - Date.parse(right[1])) ||
	compareText(left[2], right[2]) ||
	left[3] - right[3] ||
	left[4] - right[4] ||
	compareText(left[5], right[5]);

const candidatesOf = (set: Pick<RecordSet, "distance" | "duration" | "exerciseKind" | "reps" | "weight">) =>
	recordCandidates(set.exerciseKind, {
		reps: set.reps ?? undefined,
		weight: set.weight ?? undefined,
		duration: set.duration ?? undefined,
		distance: set.distance ?? undefined,
	});

const outputOf = (set: RecordSet, personalBests: ReadonlyArray<PersonalBest>) => ({
	eventId: set.id,
	properties: {
		...calculateWorkoutSetStatistics(set.exerciseKind, {
			reps: set.reps ?? undefined,
			weight: set.weight ?? undefined,
			duration: set.duration ?? undefined,
			distance: set.distance ?? undefined,
		}),
		personalBests: [...personalBests],
	},
});

const recordKey = (kind: string, type: string) => `${kind}:${type}`;

/** Awards personal bests over an exercise's whole history. */
export const replayExerciseRecords = (sets: ReadonlyArray<RecordSet>) => {
	const sorted = [...sets]
		.map((set) => ({ set, position: positionOf(set) }))
		.sort((left, right) => comparePositions(left.position, right.position));
	const maxima = new Map<string, number>();
	const records: Array<PersonalRecord> = [];
	const events = sorted.map(({ set, position }) => {
		const candidates = candidatesOf(set);
		const personalBests = personalBestTypes.filter((type) => {
			const candidate = candidates[type];
			const key = recordKey(set.exerciseKind, type);
			if (candidate === undefined || candidate <= (maxima.get(key) ?? 0)) {
				return false;
			}
			maxima.set(key, candidate);
			records.push({ type, position, value: candidate, kind: set.exerciseKind });
			return true;
		});
		return outputOf(set, personalBests);
	});
	return { events, value: { records } satisfies ExerciseRecordsValue };
};

type Walked = { readonly set: RecordSet; readonly position: SetPosition };

/**
 * Updates personal bests after sets were added or retracted. The records before the earliest change stand,
 * so each running maximum resumes from them; a later set's best can only flip when its candidate lies
 * between that maximum and the largest changed candidate, so only those sets are read.
 */
export const updateExerciseRecords = Effect.fn("updateExerciseRecords")(function* <E, R>(input: {
	readonly value: ExerciseRecordsValue;
	readonly added: ReadonlyArray<RecordSet>;
	readonly retracted: ReadonlyArray<Pick<RecordSet, "distance" | "duration" | "exerciseKind" | "id" | "occurredAt" | "reps" | "weight">>;
	readonly later: (request: LaterSetsRequest) => Effect.Effect<ReadonlyArray<RecordSet>, E, R>;
}) {
	const changed = [...input.added, ...input.retracted];
	const first = changed.reduce<null | number>(
		(earliest, { occurredAt }) =>
			earliest === null ? Date.parse(occurredAt) : Math.min(earliest, Date.parse(occurredAt)),
		null,
	);
	if (first === null) {
		return { events: [], value: input.value };
	}
	const changedIds = new Set<string>(changed.map(({ id }) => id));
	const before = (record: PersonalRecord) => Date.parse(record.position[0]) < first;
	const standing = input.value.records.filter((record) => before(record));
	const maximumBefore = new Map<string, number>();
	for (const record of standing) {
		maximumBefore.set(recordKey(record.kind, record.type), record.value);
	}
	const changedMaximum = new Map<string, { kind: ExerciseKind; type: PersonalBest; value: number }>();
	for (const set of changed) {
		for (const [type, value] of Object.entries(candidatesOf(set)) as ReadonlyArray<[PersonalBest, number]>) {
			const key = recordKey(set.exerciseKind, type);
			if (value > (changedMaximum.get(key)?.value ?? 0)) {
				changedMaximum.set(key, { type, value, kind: set.exerciseKind });
			}
		}
	}
	const bounds = [...changedMaximum.entries()].flatMap(([key, { kind, type, value }]) => {
		const above = maximumBefore.get(key) ?? 0;
		return value > above ? [{ kind, type, above, atMost: value }] : [];
	});
	const walkedTypes = new Set(bounds.map(({ kind, type }) => recordKey(kind, type)));
	const inBounds = (set: RecordSet) => {
		const candidates = candidatesOf(set);
		return bounds.some(({ kind, type, above, atMost }) => {
			const candidate = candidates[type];
			return kind === set.exerciseKind && candidate !== undefined && candidate > above && candidate <= atMost;
		});
	};
	const read =
		bounds.length === 0
			? []
			: (yield* input.later({
					bounds,
					excluded: [...changedIds],
					from: new Date(first).toISOString(),
				})).filter((set) => !changedIds.has(set.id) && inBounds(set));
	const walked: ReadonlyArray<Walked> = [...input.added, ...read]
		.map((set) => ({ set, position: positionOf(set) }))
		.sort((left, right) => comparePositions(left.position, right.position));
	const readIds = new Set<string>(read.map(({ id }) => id));
	const carriers = input.value.records.filter(
		(record) =>
			!before(record) &&
			!changedIds.has(record.position[5]) &&
			!(readIds.has(record.position[5]) && walkedTypes.has(recordKey(record.kind, record.type))),
	);
	const awarded = new Map<string, Set<PersonalBest>>();
	const records: Array<PersonalRecord> = [...standing, ...carriers];
	for (const key of walkedTypes) {
		const { kind, type } = bounds.find((bound) => recordKey(bound.kind, bound.type) === key) ?? {};
		if (kind === undefined || type === undefined) {
			continue;
		}
		const steps = [
			...walked
				.filter(({ set }) => set.exerciseKind === kind)
				.map(({ set, position }) => ({ set, position, value: candidatesOf(set)[type] })),
			...carriers
				.filter((record) => record.kind === kind && record.type === type)
				.map((record) => ({ set: null, position: record.position, value: record.value })),
		].sort((left, right) => comparePositions(left.position, right.position));
		let running = maximumBefore.get(key) ?? 0;
		for (const step of steps) {
			if (step.value === undefined) {
				continue;
			}
			if (step.set !== null && step.value > running) {
				const types = awarded.get(step.set.id) ?? new Set();
				types.add(type);
				awarded.set(step.set.id, types);
				records.push({ kind, type, value: step.value, position: step.position });
			}
			running = Math.max(running, step.value);
		}
	}
	const held = new Set(
		input.value.records.map((record) => recordKey(record.position[5], record.type)),
	);
	const events = walked.map(({ set }) =>
		outputOf(
			set,
			personalBestTypes.filter((type) =>
				walkedTypes.has(recordKey(set.exerciseKind, type))
					? awarded.get(set.id)?.has(type) === true
					: !changedIds.has(set.id) && held.has(recordKey(set.id, type)),
			),
		),
	);
	return {
		events,
		value: {
			records: records.sort(
				(left, right) =>
					comparePositions(left.position, right.position) ||
					personalBestTypes.indexOf(left.type) - personalBestTypes.indexOf(right.type),
			),
		} satisfies ExerciseRecordsValue,
	};
});
