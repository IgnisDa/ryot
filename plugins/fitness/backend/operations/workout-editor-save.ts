import type {
	CreateEventItem,
	ScriptHost,
	UpdateEventItem,
} from "@ryot-app/plugin-backend-sdk/core";
import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";
import {
	executeRyotqlRecipe,
	type RyotqlRecipeDecodeError,
} from "@ryot-app/plugin-backend-sdk/ryotql";
import type { JsonValue, SandboxHostError } from "@ryot-app/plugin-backend-sdk/wire";
import { EntityId, EventId } from "@ryot-app/plugin-kit/schema";

import { exerciseKindSchema } from "../../shared/exercise-kinds";
import { userFitnessLibraryRecipe } from "../../shared/library-recipes";
import type {
	WorkoutEditorSaveInput,
	WorkoutEditorSaveOutput,
} from "../../shared/workout-editor-operations";
import {
	decodeWorkoutEditorBaseline,
	workoutEditableSetProperties,
	workoutEditorEntityRecipe,
	workoutEditorEventIdentitiesRecipe,
	workoutEditorExercisesRecipe,
	workoutEditorSetsRecipe,
	type WorkoutEditorBaseline,
	type WorkoutEditorEvent,
} from "../../shared/workout-editor-recipes";
import {
	buildWorkoutSetEventProperties,
	requiredWorkoutMeasurementsByKind,
	selectWorkoutSetMeasurements,
	WorkoutEditorMediaSchema,
} from "../../shared/workout-set";

type Data = WorkoutEditorSaveInput["data"];
type Properties = WorkoutEditorEvent["properties"];
const editableFields = [
	"confirmedAt",
	"distance",
	"duration",
	"exerciseKind",
	"exerciseOrder",
	"images",
	"note",
	"reps",
	"restTime",
	"restTimerStartedAt",
	"rpe",
	"setLot",
	"setOrder",
	"videos",
	"weight",
];
const invalid = (
	code: Extract<WorkoutEditorSaveOutput, { kind: "invalid" }>["code"],
): WorkoutEditorSaveOutput => ({ code, kind: "invalid" });
const same = (left: unknown, right: unknown): boolean => {
	if (left === right) {
		return true;
	}
	if (left === null || right === null || typeof left !== "object" || typeof right !== "object") {
		return false;
	}
	if (Array.isArray(left)) {
		return (
			Array.isArray(right) &&
			left.length === right.length &&
			left.every((value, index) => same(value, right[index]))
		);
	}
	if (Array.isArray(right)) {
		return false;
	}
	const a = Object.entries(left).sort(([x], [y]) => x.localeCompare(y));
	const b = Object.entries(right).sort(([x], [y]) => x.localeCompare(y));
	return (
		a.length === b.length &&
		a.every(([key, value], index) => key === b[index]?.[0] && same(value, b[index][1]))
	);
};

const loadEditorSets = Effect.fn("loadEditorSets")(function* (host: ScriptHost, workoutId: string) {
	const sets: WorkoutEditorEvent[] = [];
	const cursors = new Set<string>();
	let after: string | undefined;
	let hasMore = true;
	while (hasMore) {
		const page = yield* executeRyotqlRecipe(
			host.executeRyotql,
			workoutEditorSetsRecipe({ after, workoutId, reference: { kind: "self" } }),
		);
		sets.push(...page.items);
		hasMore = page.pageInfo.hasMore;
		if (hasMore) {
			const cursor = page.pageInfo.nextCursor;
			if (cursor === null || cursors.has(cursor)) {
				return yield* Effect.fail({ message: "Workout set pagination did not advance" });
			}
			cursors.add(cursor);
			after = cursor;
		}
	}
	return sets;
});

const meaningful = (
	set: Extract<Data, { kind: "template" }>["occurrences"][number]["sets"][number],
) =>
	Object.keys(set.measurements).length > 0 ||
	!!set.note?.trim() ||
	set.rpe !== undefined ||
	set.restTime !== undefined;

const supersetsFor = (data: Data) =>
	data.supersets.map(({ color, occurrenceIds }) => ({
		color,
		exercises: occurrenceIds.map((id) =>
			data.occurrences.findIndex(({ clientId }) => clientId === id),
		),
	}));

const workoutProperties = (
	data: Extract<Data, { kind: "workout" }>,
	baseline: WorkoutEditorBaseline | undefined,
): Properties => {
	const properties = { ...baseline?.entity.properties };
	for (const key of ["endedAt", "comment", "caloriesBurnt"]) {
		delete properties[key];
	}
	Object.assign(properties, {
		images: data.images,
		videos: data.videos,
		startedAt: data.startedAt,
		supersets: supersetsFor(data),
		exerciseNotes: data.occurrences.map(({ notes }, exerciseOrder) => ({ notes, exerciseOrder })),
	});
	if (data.comment !== undefined) {
		properties["comment"] = data.comment;
	}
	if (data.endedAt !== undefined) {
		properties["endedAt"] = data.endedAt;
	}
	if (data.caloriesBurnt !== undefined) {
		properties["caloriesBurnt"] = data.caloriesBurnt;
	}
	if (data.activeDuration.kind === "clear") {
		delete properties["activeDuration"];
	}
	if (data.activeDuration.kind === "set") {
		properties["activeDuration"] = data.activeDuration.seconds;
	}
	return properties;
};

const templateProperties = (
	data: Extract<Data, { kind: "template" }>,
	baseline: WorkoutEditorBaseline | undefined,
): Properties => {
	const properties = { ...baseline?.entity.properties };
	delete properties["comment"];
	Object.assign(properties, {
		images: data.images,
		videos: data.videos,
		supersets: supersetsFor(data),
		exercises: data.occurrences.map((occurrence, exerciseOrder) => ({
			exerciseOrder,
			notes: occurrence.notes,
			images: occurrence.images,
			videos: occurrence.videos,
			exerciseId: occurrence.exerciseId,
			sets: occurrence.sets
				.filter(meaningful)
				.map((set, setOrder) =>
					Object.assign(
						{},
						set.measurements,
						{ setOrder, setLot: set.setLot },
						set.note === undefined ? {} : { note: set.note },
						set.rpe === undefined ? {} : { rpe: set.rpe },
						set.restTime === undefined ? {} : { restTime: set.restTime },
					),
				),
		})),
	});
	if (data.comment !== undefined) {
		properties["comment"] = data.comment;
	}
	return properties;
};

const TemplateSourceOccurrenceSchema = Schema.Struct({
	exerciseOrder: Schema.Int,
	exerciseId: Schema.String,
});

const eventExpected = (set: WorkoutEditorEvent) => ({
	entityId: set.entityId,
	kind: "fields" as const,
	occurredAt: set.occurredAt,
	sessionEntityId: set.sessionEntityId,
	properties: workoutEditableSetProperties(set.properties),
	absentProperties: editableFields.filter((key) => !Object.hasOwn(set.properties, key)),
});

const protectedChange = (next: JsonValue | undefined, before: JsonValue | undefined) =>
	!same(next ?? [], before ?? []) &&
	Array.isArray(next) &&
	next.some((item) => !Array.isArray(before) || !before.some((old) => same(item, old)));

const mediaFrom = (properties: Properties): typeof WorkoutEditorMediaSchema.Type => {
	const decoded = Schema.decodeResult(WorkoutEditorMediaSchema)([
		...(Array.isArray(properties["images"]) ? properties["images"] : []),
		...(Array.isArray(properties["videos"]) ? properties["videos"] : []),
	]);
	const exercises = properties["exercises"];
	const nested = Array.isArray(exercises)
		? exercises.flatMap((item) =>
				item !== null && typeof item === "object" && !Array.isArray(item) ? mediaFrom(item) : [],
			)
		: [];
	return [...(decoded._tag === "Success" ? decoded.success : []), ...nested];
};

const validateGraph = (
	data: Data,
	baseline: WorkoutEditorBaseline | undefined,
): WorkoutEditorSaveOutput | undefined => {
	if (
		baseline &&
		(new Set(baseline.sets.map(({ id }) => id)).size !== baseline.sets.length ||
			baseline.sets.some(({ sessionEntityId }) => sessionEntityId !== baseline.entity.id))
	) {
		return invalid("invalid-source");
	}
	const ids = new Set<string>();
	const events = new Set<string>();
	const origins = new Set<number>();
	for (const occurrence of data.occurrences) {
		if (ids.has(occurrence.clientId)) {
			return invalid("duplicate-id");
		}
		ids.add(occurrence.clientId);
		if (occurrence.sourceExerciseOrder !== undefined) {
			if (!baseline || origins.has(occurrence.sourceExerciseOrder)) {
				return invalid("invalid-source");
			}
			origins.add(occurrence.sourceExerciseOrder);
		}
		for (const set of occurrence.sets) {
			if (ids.has(set.clientId)) {
				return invalid("duplicate-id");
			}
			ids.add(set.clientId);
		}
		if (data.kind === "workout") {
			for (const set of data.occurrences.find((item) => item.clientId === occurrence.clientId)
				?.sets ?? []) {
				if (set.eventId !== undefined) {
					const original = baseline?.sets.find(({ id }) => id === set.eventId);
					if (
						!original ||
						events.has(set.eventId) ||
						original.sessionEntityId !== baseline?.entity.id ||
						occurrence.sourceExerciseOrder !== original.properties["exerciseOrder"]
					) {
						return invalid("unrelated-event");
					}
					events.add(set.eventId);
					if (
						set.occurredAt !== original.occurredAt ||
						!same(set.confirmedAt, original.properties["confirmedAt"] ?? undefined) ||
						!same(set.restTimerStartedAt, original.properties["restTimerStartedAt"] ?? undefined)
					) {
						return invalid("invalid-time");
					}
				}
			}
		}
	}
	const grouped = new Set<string>();
	for (const group of data.supersets) {
		if (group.occurrenceIds.length < 2) {
			return invalid("invalid-superset");
		}
		for (const id of group.occurrenceIds) {
			if (!data.occurrences.some(({ clientId }) => clientId === id) || grouped.has(id)) {
				return invalid("invalid-superset");
			}
			grouped.add(id);
		}
	}
	if (data.kind === "workout") {
		if (
			baseline &&
			(data.startedAt !== baseline.entity.properties["startedAt"] ||
				!same(data.endedAt, baseline.entity.properties["endedAt"] ?? undefined))
		) {
			return invalid("invalid-time");
		}
		if (
			!baseline &&
			data.endedAt !== undefined &&
			Date.parse(data.endedAt) < Date.parse(data.startedAt)
		) {
			return invalid("invalid-time");
		}
	}
	return undefined;
};

export const saveWorkoutEditor = Effect.fn("saveWorkoutEditor")(function* (
	input: WorkoutEditorSaveInput,
	host: ScriptHost,
): Effect.fn.Return<WorkoutEditorSaveOutput, SandboxHostError | RyotqlRecipeDecodeError> {
	const { data, submittedAt, submissionId } = input;
	let baseline: WorkoutEditorBaseline | undefined;
	if (data.target.kind === "update") {
		const decoded = decodeWorkoutEditorBaseline(data.target.conflictToken);
		if (decoded._tag === "Failure" || decoded.success.entity.id !== data.target.entityId) {
			return invalid("invalid-source");
		}
		baseline = decoded.success;
		const current = yield* executeRyotqlRecipe(
			host.executeRyotql,
			workoutEditorEntityRecipe({
				reference: { kind: "self" },
				entityId: data.target.entityId,
				kind: data.kind === "workout" ? "workout" : "workout-template",
			}),
		);
		if (!current) {
			return { kind: "conflict" };
		}
	}
	const graphIssue = validateGraph(data, baseline);
	if (graphIssue) {
		return graphIssue;
	}
	if (baseline && data.kind === "workout") {
		for (let offset = 0; offset < baseline.sets.length; offset += 100) {
			const identities = yield* executeRyotqlRecipe(
				host.executeRyotql,
				workoutEditorEventIdentitiesRecipe({
					reference: { kind: "self" },
					eventIds: baseline.sets.slice(offset, offset + 100).map(({ id }) => id),
				}),
			);
			for (const event of identities) {
				const originalExercise = baseline.sets.find(({ id }) => id === event.id)?.entityId;
				const replacement = data.occurrences.find(({ sets }) =>
					sets.some(({ eventId }) => eventId === event.id),
				)?.exerciseId;
				if (
					event.slug !== "workout-set" ||
					event.sessionEntityId !== baseline.entity.id ||
					(event.entityId !== originalExercise && event.entityId !== replacement)
				) {
					return invalid("unrelated-event");
				}
			}
			const retainedIds = new Set(
				data.occurrences.flatMap(({ sets }) =>
					sets.flatMap((set) => (set.eventId === undefined ? [] : [set.eventId])),
				),
			);
			if (
				baseline.sets
					.slice(offset, offset + 100)
					.some(({ id }) => retainedIds.has(id) && !identities.some((event) => event.id === id))
			) {
				return { kind: "conflict" };
			}
		}
	}
	let sourceLink: { targetEntityId: string; relationshipSchemaSlug: string } | undefined;
	if (
		data.kind === "workout" &&
		data.target.kind === "create" &&
		(data.target.repeatedFromId !== undefined || data.target.templateId !== undefined)
	) {
		const targetEntityId = data.target.repeatedFromId ?? data.target.templateId;
		if (targetEntityId === undefined) {
			return invalid("invalid-source");
		}
		const source = yield* executeRyotqlRecipe(
			host.executeRyotql,
			workoutEditorEntityRecipe({
				entityId: targetEntityId,
				reference: { kind: "self" },
				kind: data.target.repeatedFromId !== undefined ? "workout" : "workout-template",
			}),
		);
		if (!source) {
			return invalid("invalid-source");
		}
		sourceLink = {
			targetEntityId,
			relationshipSchemaSlug:
				data.target.repeatedFromId !== undefined
					? "workout-repeated-from"
					: "workout-to-workout-template",
		};
	}
	const exerciseIds = [...new Set(data.occurrences.map(({ exerciseId }) => exerciseId))];
	const exercises = [];
	for (let offset = 0; offset < exerciseIds.length; offset += 100) {
		const page = yield* executeRyotqlRecipe(
			host.executeRyotql,
			workoutEditorExercisesRecipe({
				reference: { kind: "self" },
				exerciseIds: exerciseIds.slice(offset, offset + 100),
			}),
		);
		exercises.push(...page.items);
	}
	if (exercises.length !== exerciseIds.length) {
		return invalid("missing-exercise");
	}
	const proAvailable = yield* host.getProAvailability();
	const properties =
		data.kind === "workout"
			? workoutProperties(data, baseline)
			: templateProperties(data, baseline);
	if (
		!proAvailable &&
		data.kind === "template" &&
		(!baseline ||
			data.name !== baseline.entity.name ||
			!same(properties, baseline.entity.properties))
	) {
		return { kind: "pro-required" };
	}
	if (
		!proAvailable &&
		(protectedChange(data.images, baseline?.entity.properties["images"]) ||
			protectedChange(data.videos, baseline?.entity.properties["videos"]))
	) {
		return { kind: "pro-required" };
	}
	const sourceOccurrences =
		data.kind === "template" && baseline !== undefined
			? Schema.decodeUnknownResult(Schema.Array(TemplateSourceOccurrenceSchema))(
					baseline.entity.properties["exercises"],
				)
			: undefined;
	if (sourceOccurrences?._tag === "Failure") {
		return invalid("invalid-source");
	}
	for (const occurrence of data.occurrences) {
		const exercise = exercises.find(({ id }) => id === occurrence.exerciseId);
		const currentKind = Schema.decodeUnknownResult(exerciseKindSchema)(
			exercise?.properties["kind"],
		);
		const sourceSets =
			baseline?.sets.filter(
				(set) => set.properties["exerciseOrder"] === occurrence.sourceExerciseOrder,
			) ?? [];
		const sourceExerciseId =
			data.kind === "workout"
				? sourceSets[0]?.entityId
				: sourceOccurrences?.success.find(
						({ exerciseOrder }) => exerciseOrder === occurrence.sourceExerciseOrder,
					)?.exerciseId;
		if (occurrence.sourceExerciseOrder !== undefined && sourceExerciseId === undefined) {
			return invalid("invalid-source");
		}
		if (sourceExerciseId !== undefined && sourceExerciseId !== occurrence.exerciseId) {
			if (!proAvailable) {
				return { kind: "pro-required" };
			}
			if (
				data.kind === "workout" &&
				sourceSets.some(
					(set) =>
						set.properties["exerciseKind"] !==
						(currentKind._tag === "Success" ? currentKind.success : undefined),
				)
			) {
				return invalid("invalid-exercise-kind");
			}
			if (data.kind === "template") {
				const source = yield* executeRyotqlRecipe(
					host.executeRyotql,
					workoutEditorExercisesRecipe({
						reference: { kind: "self" },
						exerciseIds: [sourceExerciseId],
					}),
				);
				if (
					currentKind._tag === "Failure" ||
					source.items[0]?.properties["kind"] !== currentKind.success
				) {
					return invalid("invalid-exercise-kind");
				}
			}
		}
		if (data.kind === "workout") {
			const workoutOccurrence = data.occurrences.find(
				({ clientId }) => clientId === occurrence.clientId,
			);
			for (const set of workoutOccurrence?.sets ?? []) {
				const original = baseline?.sets.find(({ id }) => id === set.eventId);
				if (!proAvailable && set.note?.trim() && set.note !== original?.properties["note"]) {
					return { kind: "pro-required" };
				}
				const kind =
					original?.properties["exerciseKind"] ??
					sourceSets[0]?.properties["exerciseKind"] ??
					(currentKind._tag === "Success" ? currentKind.success : undefined);
				if (
					kind !== set.exerciseKind ||
					!same(selectWorkoutSetMeasurements(set.exerciseKind, set.measurements), set.measurements)
				) {
					return invalid("invalid-exercise-kind");
				}
				if (!original) {
					if (data.target.kind === "create" && set.confirmedAt === undefined) {
						return invalid("unconfirmed-set");
					}
					const required = requiredWorkoutMeasurementsByKind[set.exerciseKind];
					if (required.some((key) => !Object.hasOwn(set.measurements, key))) {
						return invalid("missing-measurement");
					}
				}
			}
		} else {
			if (currentKind._tag === "Failure") {
				return invalid("invalid-exercise-kind");
			}
			for (const set of data.occurrences.find(({ clientId }) => clientId === occurrence.clientId)
				?.sets ?? []) {
				if (
					!same(
						selectWorkoutSetMeasurements(currentKind.success, set.measurements),
						set.measurements,
					)
				) {
					return invalid("invalid-measurement");
				}
			}
		}
	}
	const media = [
		...data.images,
		...data.videos,
		...(data.kind === "template"
			? data.occurrences.flatMap((occurrence) => [...occurrence.images, ...occurrence.videos])
			: data.occurrences.flatMap(({ sets }) =>
					sets.flatMap((set) => [...set.images, ...set.videos]),
				)),
	];
	const existingMedia = [
		...mediaFrom(baseline?.entity.properties ?? {}),
		...(baseline?.sets.flatMap(({ properties: values }) => mediaFrom(values)) ?? []),
	];
	const managed = media
		.filter((locator) => locator.type !== "remote")
		.filter((locator) => !existingMedia.some((old) => same(old, locator)));
	for (let offset = 0; offset < managed.length; offset += 100) {
		yield* host.verifyManagedAssets(managed.slice(offset, offset + 100));
	}
	const options = (step: string) => ({ submittedAt, idempotencyKey: `${submissionId}:${step}` });
	const entity =
		baseline === undefined
			? yield* host.createUserEntity(
					{
						properties,
						name: data.name,
						entitySchemaSlug: data.kind === "workout" ? "workout" : "workout-template",
					},
					options("entity"),
				)
			: yield* host.updateUserEntity(
					{
						properties,
						name: data.name,
						entityId: baseline.entity.id,
						expected: {
							name: baseline.entity.name,
							updatedAt: baseline.entity.updatedAt,
							properties: baseline.entity.properties,
						},
					},
					options("entity"),
				);
	const entityId = EntityId.make(entity.entityId);
	if (data.kind === "template") {
		return { sets: [], entityId, kind: "saved" };
	}
	if (exerciseIds.length > 0) {
		const library = yield* executeRyotqlRecipe(
			host.executeRyotql,
			userFitnessLibraryRecipe({ kind: "self" }),
		);
		for (let offset = 0; offset < exerciseIds.length; offset += 100) {
			yield* host.changeUserRelationships(
				[
					{
						deletes: [],
						creates: exerciseIds
							.slice(offset, offset + 100)
							.map((exerciseId) => ({
								properties: {},
								propertiesMode: "merge",
								sourceEntityId: exerciseId,
								targetEntityId: library.entityId,
								relationshipSchemaSlug: "in-fitness-library",
							})),
					},
				],
				options(`membership-${offset}`),
			);
		}
	}
	if (sourceLink) {
		yield* host.changeUserRelationships(
			[
				{
					deletes: [],
					creates: [
						{ ...sourceLink, properties: {}, propertiesMode: "merge", sourceEntityId: entityId },
					],
				},
			],
			options("source"),
		);
	}
	const updates: UpdateEventItem[] = [];
	const creates: CreateEventItem[] = [];
	const newClientIds: string[] = [];
	const savedSets: Extract<WorkoutEditorSaveOutput, { kind: "saved" }>["sets"][number][] = [];
	for (const [exerciseOrder, occurrence] of data.occurrences.entries()) {
		for (const [setOrder, set] of occurrence.sets.entries()) {
			const setProperties = buildWorkoutSetEventProperties({
				...set.measurements,
				...set,
				setOrder,
				exerciseOrder,
			});
			if (set.eventId === undefined) {
				creates.push({
					properties: setProperties,
					sessionEntityId: entityId,
					occurredAt: set.occurredAt,
					eventSchemaSlug: "workout-set",
					entityId: occurrence.exerciseId,
				});
				newClientIds.push(set.clientId);
			} else {
				const original = baseline?.sets.find(({ id }) => id === set.eventId);
				if (!original) {
					return invalid("unrelated-event");
				}
				updates.push({
					eventId: set.eventId,
					expected: eventExpected(original),
					patch: {
						entityId: occurrence.exerciseId,
						occurredAt: original.occurredAt,
						properties: {
							set: setProperties,
							remove: editableFields.filter((key) => !Object.hasOwn(setProperties, key)),
						},
					},
				});
				savedSets.push({ eventId: set.eventId, clientId: set.clientId });
			}
		}
	}
	for (let offset = 0; offset < updates.length; offset += 100) {
		yield* host.updateEvents(updates.slice(offset, offset + 100), options(`updates-${offset}`));
	}
	if (creates.length > 0) {
		const created = yield* host.createEvents(creates, options("sets")).pipe(
			Effect.catch((error) => {
				const partial = Schema.decodeUnknownResult(
					Schema.Struct({
						count: Schema.Int,
						partial: Schema.Literal(true),
						outcomes: Schema.Array(
							Schema.Union([
								Schema.Struct({
									eventId: EventId,
									index: Schema.Int,
									status: Schema.Literal("written"),
								}),
								Schema.Struct({
									index: Schema.Int,
									reason: Schema.String,
									status: Schema.Literal("skipped_by_policy"),
								}),
							]),
						),
					}),
				)(error.data);
				return partial._tag === "Success" ? Effect.succeed(partial.success) : Effect.fail(error);
			}),
		);
		for (const outcome of created.outcomes) {
			if (outcome.status === "written") {
				const clientId = newClientIds[outcome.index];
				if (clientId !== undefined) {
					savedSets.push({ clientId, eventId: outcome.eventId });
				}
			}
		}
		if (created.count !== creates.length) {
			return {
				entityId,
				kind: "incomplete",
				committedSetIds: savedSets.map(({ clientId }) => clientId),
			};
		}
	}
	const retained = new Set(savedSets.map(({ eventId }) => eventId));
	const removed = baseline?.sets.filter(({ id }) => !retained.has(id)) ?? [];
	for (let offset = 0; offset < removed.length; offset += 100) {
		const batch = removed.slice(offset, offset + 100);
		yield* host.deleteEvents(
			batch.map(({ id }) => id),
			{
				...options(`deletes-${offset}`),
				expected: Object.fromEntries(batch.map((set) => [set.id, eventExpected(set)])),
			},
		);
	}
	const currentSets = yield* loadEditorSets(host, entityId);
	if (currentSets.length !== savedSets.length || currentSets.some(({ id }) => !retained.has(id))) {
		return { kind: "conflict" };
	}
	if (data.target.kind === "create") {
		const finalized = yield* host.createEvents(
			[
				{
					entityId,
					occurredAt: submittedAt,
					eventSchemaSlug: "workout-completed",
					properties: { workoutName: data.name },
				},
			],
			options("complete"),
		);
		if (finalized.count !== 1) {
			return {
				entityId,
				kind: "incomplete",
				committedSetIds: savedSets.map(({ clientId }) => clientId),
			};
		}
	}
	return { entityId, kind: "saved", sets: savedSets };
});
