import {
	MANAGED_ASSET_VERIFY_SANDBOX_LIMITS,
	type ScriptHost,
	type UpdateEventItem,
	type UserCommandInput,
	userCommandInputSchema,
} from "@ryot-app/plugin-backend-sdk/core";
import { Effect, Option, Schema } from "@ryot-app/plugin-backend-sdk/effect";
import {
	executeRyotqlRecipe,
	type RyotqlRecipeDecodeError,
} from "@ryot-app/plugin-backend-sdk/ryotql";
import type { SandboxHostError } from "@ryot-app/plugin-backend-sdk/wire";
import { EntityId } from "@ryot-app/plugin-kit/schema";

import { exerciseKindSchema } from "../../shared/exercise-kinds";
import { jsonValueEquals } from "../../shared/json-value-equals";
import { userFitnessLibraryRecipe } from "../../shared/library-recipes";
import {
	type WorkoutEditorSaveInput,
	type WorkoutEditorSaveOutput,
	WorkoutEditorSaveOutputSchema,
} from "../../shared/workout-editor-operations";
import {
	applyWorkoutTimes,
	type TemplateOccurrenceProperties,
	TemplatePropertiesSchema,
	type TemplateSetProperties,
	WorkoutPropertiesSchema,
	type WorkoutSetProperties,
	WorkoutSetPropertiesSchema,
} from "../../shared/workout-editor-properties";
import {
	decodeWorkoutEditorBaseline,
	WORKOUT_EDITOR_PAGE_SIZE,
	workoutEditableSetProperties,
	type WorkoutEditorBaseline,
	workoutEditorEntityRecipe,
	type WorkoutEditorEvent,
	workoutEditorEventIdentitiesRecipe,
	type WorkoutEditorExercise,
	workoutEditorExercisesRecipe,
} from "../../shared/workout-editor-recipes";
import {
	buildWorkoutSetEventProperties,
	hasTemplateSetContent,
	requiredWorkoutMeasurementsByKind,
	selectWorkoutSetMeasurements,
	type WorkoutSetAssetLocator,
	workoutSetEditableFields,
} from "../../shared/workout-set";

type Data = WorkoutEditorSaveInput["data"];
type Properties = WorkoutEditorEvent["properties"];
type WorkoutData = Extract<Data, { kind: "workout" }>;
type TemplateData = Extract<Data, { kind: "template" }>;
type SourceSet = WorkoutEditorEvent & { readonly set: WorkoutSetProperties };
type InvalidCode = Extract<WorkoutEditorSaveOutput, { kind: "invalid" }>["code"];

type SavedSet = Extract<WorkoutEditorSaveOutput, { kind: "saved" }>["sets"][number];
type Baseline = {
	readonly startedAt: string | undefined;
	readonly sets: ReadonlyArray<SourceSet>;
	readonly endedAt: null | string | undefined;
	readonly entity: WorkoutEditorBaseline["entity"];
	readonly media: ReadonlyArray<WorkoutSetAssetLocator>;
	readonly images: ReadonlyArray<WorkoutSetAssetLocator>;
	readonly videos: ReadonlyArray<WorkoutSetAssetLocator>;
	readonly exercises: ReadonlyArray<TemplateOccurrenceProperties>;
};

class WorkoutSaveHalt extends Schema.TaggedError<
	WorkoutSaveHalt,
	{ readonly brand: unique symbol }
>()("WorkoutSaveHalt", { output: WorkoutEditorSaveOutputSchema }) {}

class WorkoutCommandInputError extends Schema.TaggedError<
	WorkoutCommandInputError,
	{ readonly brand: unique symbol }
>()("WorkoutCommandInputError", { message: Schema.String }) {}

const halt = (output: WorkoutEditorSaveOutput) => Effect.fail(new WorkoutSaveHalt({ output }));
const invalid = (code: InvalidCode) => halt({ code, kind: "invalid" });
const conflict = () => halt({ kind: "conflict" });
const proRequired = () => halt({ kind: "pro-required" });

const chunked = <Item>(items: ReadonlyArray<Item>, size: number) =>
	Array.from({ length: Math.ceil(items.length / size) }, (_, index) => ({
		offset: index * size,
		items: items.slice(index * size, (index + 1) * size),
	}));

const editableFields: ReadonlyArray<string> = workoutSetEditableFields;

const exerciseKindOf = (exercise: undefined | Pick<WorkoutEditorExercise, "properties">) => {
	const decoded = Schema.decodeUnknownOption(Schema.Struct({ kind: exerciseKindSchema }))(
		exercise?.properties,
	);
	return Option.isSome(decoded) ? decoded.value.kind : undefined;
};

const supersetsFor = (data: Data) =>
	data.supersets.map(({ color, occurrenceIds }) => ({
		color,
		exercises: occurrenceIds.map((id) =>
			data.occurrences.findIndex(({ clientId }) => clientId === id),
		),
	}));

const workoutProperties = (data: WorkoutData, baseline: Baseline | undefined): Properties => {
	const properties = { ...baseline?.entity.properties };
	delete properties["comment"];
	delete properties["caloriesBurnt"];
	Object.assign(properties, {
		images: data.images,
		videos: data.videos,
		supersets: supersetsFor(data),
		exerciseNotes: data.occurrences.map(({ notes }, exerciseOrder) => ({ notes, exerciseOrder })),
		exerciseMedia: data.occurrences.flatMap((occurrence, exerciseOrder) =>
			occurrence.images.length === 0 && occurrence.videos.length === 0
				? []
				: [{ exerciseOrder, images: occurrence.images, videos: occurrence.videos }],
		),
	});
	if (data.comment !== undefined) {
		properties["comment"] = data.comment;
	}
	if (data.caloriesBurnt !== undefined) {
		properties["caloriesBurnt"] = data.caloriesBurnt;
	}
	return applyWorkoutTimes(properties, data);
};

const templateSetProperties = (
	set: TemplateData["occurrences"][number]["sets"][number],
	setOrder: number,
): TemplateSetProperties => ({
	...set.measurements,
	setOrder,
	setLot: set.setLot,
	...(set.note === undefined ? {} : { note: set.note }),
	...(set.rpe === undefined ? {} : { rpe: set.rpe }),
	...(set.restTime === undefined ? {} : { restTime: set.restTime }),
});

const templateProperties = (data: TemplateData, baseline: Baseline | undefined): Properties => {
	const properties = { ...baseline?.entity.properties };
	delete properties["comment"];
	const exercises: ReadonlyArray<TemplateOccurrenceProperties> = data.occurrences.map(
		(occurrence, exerciseOrder) => ({
			exerciseOrder,
			notes: occurrence.notes,
			images: occurrence.images,
			videos: occurrence.videos,
			exerciseId: occurrence.exerciseId,
			sets: occurrence.sets
				.filter((set) =>
					hasTemplateSetContent({
						note: set.note,
						hasRpe: set.rpe !== undefined,
						hasRest: set.restTime !== undefined,
						hasMeasurement: Object.keys(set.measurements).length > 0,
					}),
				)
				.map(templateSetProperties),
		}),
	);
	Object.assign(properties, {
		exercises,
		images: data.images,
		videos: data.videos,
		supersets: supersetsFor(data),
	});
	if (data.comment !== undefined) {
		properties["comment"] = data.comment;
	}
	return properties;
};

const eventExpected = (set: WorkoutEditorEvent) => ({
	entityId: set.entityId,
	kind: "fields" as const,
	occurredAt: set.occurredAt,
	sessionEntityId: set.sessionEntityId,
	properties: workoutEditableSetProperties(set.properties),
	absentProperties: editableFields.filter((key) => !Object.hasOwn(set.properties, key)),
});

const introducesMedia = (
	next: ReadonlyArray<WorkoutSetAssetLocator>,
	before: ReadonlyArray<WorkoutSetAssetLocator>,
) => next.some((item) => !before.some((old) => jsonValueEquals(item, old)));

const mediaOf = (properties: {
	readonly images?: null | undefined | ReadonlyArray<WorkoutSetAssetLocator>;
	readonly videos?: null | undefined | ReadonlyArray<WorkoutSetAssetLocator>;
}) => [...(properties.images ?? []), ...(properties.videos ?? [])];

const decodeBaselineProperties = (
	kind: Data["kind"],
	entity: WorkoutEditorBaseline["entity"],
):
	| undefined
	| Pick<Baseline, "media" | "images" | "videos" | "endedAt" | "exercises" | "startedAt"> => {
	if (kind === "workout") {
		const decoded = Schema.decodeUnknownOption(WorkoutPropertiesSchema)(entity.properties);
		if (Option.isNone(decoded)) {
			return undefined;
		}
		const { value } = decoded;
		return {
			exercises: [],
			endedAt: value.endedAt,
			startedAt: value.startedAt,
			images: value.images ?? [],
			videos: value.videos ?? [],
			media: [...mediaOf(value), ...(value.exerciseMedia ?? []).flatMap((item) => mediaOf(item))],
		};
	}
	const decoded = Schema.decodeUnknownOption(TemplatePropertiesSchema)(entity.properties);
	if (Option.isNone(decoded)) {
		return undefined;
	}
	const { value } = decoded;
	return {
		endedAt: undefined,
		startedAt: undefined,
		exercises: value.exercises,
		images: value.images ?? [],
		videos: value.videos ?? [],
		media: [...mediaOf(value), ...value.exercises.flatMap((item) => mediaOf(item))],
	};
};

const loadBaseline = Effect.fn("loadBaseline")(function* (data: Data, host: ScriptHost) {
	if (data.target.kind !== "update") {
		return undefined;
	}
	const decoded = decodeWorkoutEditorBaseline(data.target.conflictToken);
	if (decoded._tag === "Failure" || decoded.success.entity.id !== data.target.entityId) {
		return yield* invalid("invalid-source");
	}
	const { entity } = decoded.success;
	const current = yield* executeRyotqlRecipe(
		host.executeRyotql,
		workoutEditorEntityRecipe({
			reference: { kind: "self" },
			entityId: data.target.entityId,
			kind: data.kind === "workout" ? "workout" : "workout-template",
		}),
	);
	if (!current) {
		return yield* conflict();
	}
	const properties = decodeBaselineProperties(data.kind, entity);
	const sets = decoded.success.sets.map((event) => ({
		event,
		set: Schema.decodeUnknownOption(WorkoutSetPropertiesSchema)(event.properties),
	}));
	if (properties === undefined || sets.some(({ set }) => Option.isNone(set))) {
		return yield* invalid("invalid-source");
	}
	return {
		...properties,
		entity,
		sets: sets.flatMap(({ set, event }) =>
			Option.isSome(set) ? [{ ...event, set: set.value }] : [],
		),
	} satisfies Baseline;
});

const validateGraph = (data: Data, baseline: Baseline | undefined): undefined | InvalidCode => {
	if (
		baseline &&
		(new Set(baseline.sets.map(({ id }) => id)).size !== baseline.sets.length ||
			baseline.sets.some(({ sessionEntityId }) => sessionEntityId !== baseline.entity.id))
	) {
		return "invalid-source";
	}
	const ids = new Set<string>();
	const events = new Set<string>();
	const origins = new Set<number>();
	for (const occurrence of data.occurrences) {
		if (ids.has(occurrence.clientId)) {
			return "duplicate-id";
		}
		ids.add(occurrence.clientId);
		if (occurrence.sourceExerciseOrder !== undefined) {
			if (!baseline || origins.has(occurrence.sourceExerciseOrder)) {
				return "invalid-source";
			}
			origins.add(occurrence.sourceExerciseOrder);
		}
		for (const set of occurrence.sets) {
			if (ids.has(set.clientId)) {
				return "duplicate-id";
			}
			ids.add(set.clientId);
		}
		for (const set of occurrence.sets) {
			if (!("eventId" in set) || set.eventId === undefined) {
				continue;
			}
			const original = baseline?.sets.find(({ id }) => id === set.eventId);
			if (
				!original ||
				events.has(set.eventId) ||
				original.sessionEntityId !== baseline?.entity.id ||
				occurrence.sourceExerciseOrder !== original.set.exerciseOrder
			) {
				return "unrelated-event";
			}
			events.add(set.eventId);
			if (
				set.occurredAt !== original.occurredAt ||
				!jsonValueEquals(set.confirmedAt, original.set.confirmedAt ?? undefined) ||
				!jsonValueEquals(set.restTimerStartedAt, original.set.restTimerStartedAt ?? undefined)
			) {
				return "invalid-time";
			}
		}
	}
	const grouped = new Set<string>();
	for (const group of data.supersets) {
		if (group.occurrenceIds.length < 2) {
			return "invalid-superset";
		}
		for (const id of group.occurrenceIds) {
			if (!data.occurrences.some(({ clientId }) => clientId === id) || grouped.has(id)) {
				return "invalid-superset";
			}
			grouped.add(id);
		}
	}
	if (data.kind === "workout") {
		if (
			baseline &&
			(data.startedAt !== baseline.startedAt ||
				!jsonValueEquals(data.endedAt, baseline.endedAt ?? undefined))
		) {
			return "invalid-time";
		}
		if (
			!baseline &&
			data.endedAt !== undefined &&
			Date.parse(data.endedAt) < Date.parse(data.startedAt)
		) {
			return "invalid-time";
		}
	}
	return undefined;
};

const verifyBaselineEvents = Effect.fn("verifyBaselineEvents")(function* (
	data: WorkoutData,
	baseline: Baseline,
	host: ScriptHost,
) {
	const retainedIds = new Set(
		data.occurrences.flatMap(({ sets }) =>
			sets.flatMap((set) => (set.eventId === undefined ? [] : [set.eventId])),
		),
	);
	for (const { items } of chunked(baseline.sets, WORKOUT_EDITOR_PAGE_SIZE)) {
		const identities = yield* executeRyotqlRecipe(
			host.executeRyotql,
			workoutEditorEventIdentitiesRecipe({
				reference: { kind: "self" },
				eventIds: items.map(({ id }) => id),
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
				return yield* invalid("unrelated-event");
			}
		}
		if (
			items.some(({ id }) => retainedIds.has(id) && !identities.some((event) => event.id === id))
		) {
			return yield* conflict();
		}
	}
	return undefined;
});

const resolveSourceLink = Effect.fn("resolveSourceLink")(function* (
	data: WorkoutData,
	host: ScriptHost,
) {
	if (data.target.kind !== "create") {
		return undefined;
	}
	const { templateId, repeatedFromId } = data.target;
	const targetEntityId = repeatedFromId ?? templateId;
	if (targetEntityId === undefined) {
		return undefined;
	}
	const source = yield* executeRyotqlRecipe(
		host.executeRyotql,
		workoutEditorEntityRecipe({
			entityId: targetEntityId,
			reference: { kind: "self" },
			kind: repeatedFromId !== undefined ? "workout" : "workout-template",
		}),
	);
	if (!source) {
		return yield* invalid("invalid-source");
	}
	return {
		targetEntityId,
		relationshipSchemaSlug:
			repeatedFromId !== undefined ? "workout-repeated-from" : "workout-to-workout-template",
	};
});

const loadExercises = Effect.fn("loadExercises")(function* (
	exerciseIds: ReadonlyArray<string>,
	host: ScriptHost,
) {
	const exercises: WorkoutEditorExercise[] = [];
	for (const { items } of chunked(exerciseIds, WORKOUT_EDITOR_PAGE_SIZE)) {
		const page = yield* executeRyotqlRecipe(
			host.executeRyotql,
			workoutEditorExercisesRecipe({ exerciseIds: items, reference: { kind: "self" } }),
		);
		exercises.push(...page.items);
	}
	if (exercises.length !== exerciseIds.length) {
		return yield* invalid("missing-exercise");
	}
	return exercises;
});

const checkReplacement = Effect.fn("checkReplacement")(function* (
	occurrence: { readonly exerciseId: string; readonly sourceExerciseOrder?: number | undefined },
	source: {
		readonly template?: boolean;
		readonly kindMismatchedSets?: boolean;
		readonly exerciseId: string | undefined;
	},
	currentKind: ReturnType<typeof exerciseKindOf>,
	proAvailable: boolean,
	host: ScriptHost,
) {
	if (occurrence.sourceExerciseOrder !== undefined && source.exerciseId === undefined) {
		return yield* invalid("invalid-source");
	}
	if (source.exerciseId === undefined || source.exerciseId === occurrence.exerciseId) {
		return undefined;
	}
	if (!proAvailable) {
		return yield* proRequired();
	}
	if (source.kindMismatchedSets) {
		return yield* invalid("invalid-exercise-kind");
	}
	if (source.template) {
		const sourceExercise = yield* executeRyotqlRecipe(
			host.executeRyotql,
			workoutEditorExercisesRecipe({
				reference: { kind: "self" },
				exerciseIds: [source.exerciseId],
			}),
		);
		if (currentKind === undefined || exerciseKindOf(sourceExercise.items[0]) !== currentKind) {
			return yield* invalid("invalid-exercise-kind");
		}
	}
	return undefined;
});

const validateWorkoutOccurrences = Effect.fn("validateWorkoutOccurrences")(function* (
	data: WorkoutData,
	baseline: Baseline | undefined,
	exercises: ReadonlyArray<WorkoutEditorExercise>,
	proAvailable: boolean,
	host: ScriptHost,
) {
	for (const occurrence of data.occurrences) {
		const currentKind = exerciseKindOf(exercises.find(({ id }) => id === occurrence.exerciseId));
		const sourceSets =
			baseline?.sets.filter(({ set }) => set.exerciseOrder === occurrence.sourceExerciseOrder) ??
			[];
		yield* checkReplacement(
			occurrence,
			{
				exerciseId: sourceSets[0]?.entityId,
				kindMismatchedSets: sourceSets.some(({ set }) => set.exerciseKind !== currentKind),
			},
			currentKind,
			proAvailable,
			host,
		);
		for (const set of occurrence.sets) {
			const original = baseline?.sets.find(({ id }) => id === set.eventId);
			if (!proAvailable && set.note?.trim() && set.note !== original?.set.note) {
				return yield* proRequired();
			}
			const kind = original?.set.exerciseKind ?? sourceSets[0]?.set.exerciseKind ?? currentKind;
			if (
				kind !== set.exerciseKind ||
				!jsonValueEquals(
					selectWorkoutSetMeasurements(set.exerciseKind, set.measurements),
					set.measurements,
				)
			) {
				return yield* invalid("invalid-exercise-kind");
			}
			if (!original) {
				if (data.target.kind === "create" && set.confirmedAt === undefined) {
					return yield* invalid("unconfirmed-set");
				}
				const required = requiredWorkoutMeasurementsByKind[set.exerciseKind];
				if (required.some((key) => !Object.hasOwn(set.measurements, key))) {
					return yield* invalid("missing-measurement");
				}
			}
		}
	}
	return undefined;
});

const validateTemplateOccurrences = Effect.fn("validateTemplateOccurrences")(function* (
	data: TemplateData,
	baseline: Baseline | undefined,
	exercises: ReadonlyArray<WorkoutEditorExercise>,
	proAvailable: boolean,
	host: ScriptHost,
) {
	for (const occurrence of data.occurrences) {
		const currentKind = exerciseKindOf(exercises.find(({ id }) => id === occurrence.exerciseId));
		yield* checkReplacement(
			occurrence,
			{
				template: true,
				exerciseId: baseline?.exercises.find(
					({ exerciseOrder }) => exerciseOrder === occurrence.sourceExerciseOrder,
				)?.exerciseId,
			},
			currentKind,
			proAvailable,
			host,
		);
		if (currentKind === undefined) {
			return yield* invalid("invalid-exercise-kind");
		}
		for (const set of occurrence.sets) {
			if (
				!jsonValueEquals(
					selectWorkoutSetMeasurements(currentKind, set.measurements),
					set.measurements,
				)
			) {
				return yield* invalid("invalid-measurement");
			}
		}
	}
	return undefined;
});

const persistWorkoutEditor = Effect.fn("persistWorkoutEditor")(function* (
	input: WorkoutEditorSaveInput,
	host: ScriptHost,
) {
	const { data, submittedAt, submissionId } = input;
	const baseline = yield* loadBaseline(data, host);
	const graphIssue = validateGraph(data, baseline);
	if (graphIssue !== undefined) {
		return yield* invalid(graphIssue);
	}
	if (baseline && data.kind === "workout") {
		yield* verifyBaselineEvents(data, baseline, host);
	}
	const sourceLink = data.kind === "workout" ? yield* resolveSourceLink(data, host) : undefined;
	const exerciseIds = [...new Set(data.occurrences.map(({ exerciseId }) => exerciseId))];
	const exercises = yield* loadExercises(exerciseIds, host);
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
			!jsonValueEquals(properties, baseline.entity.properties))
	) {
		return yield* proRequired();
	}
	if (
		!proAvailable &&
		(introducesMedia(data.images, baseline?.images ?? []) ||
			introducesMedia(data.videos, baseline?.videos ?? []))
	) {
		return yield* proRequired();
	}
	if (data.kind === "workout") {
		yield* validateWorkoutOccurrences(data, baseline, exercises, proAvailable, host);
	} else {
		yield* validateTemplateOccurrences(data, baseline, exercises, proAvailable, host);
	}
	const existingMedia = baseline?.media ?? [];
	const managed = [
		...data.images,
		...data.videos,
		...data.occurrences.flatMap((occurrence) => [...occurrence.images, ...occurrence.videos]),
	]
		.filter((locator) => locator.type !== "remote")
		.filter((locator) => !existingMedia.some((old) => jsonValueEquals(old, locator)));
	for (const { items } of chunked(managed, MANAGED_ASSET_VERIFY_SANDBOX_LIMITS.locators)) {
		yield* host.verifyManagedAssets(items);
	}
	const options = (step: string) => ({ submittedAt, idempotencyKey: `${submissionId}:${step}` });
	const relationships: Array<UserCommandInput["relationships"][number]> = [];
	if (data.kind === "workout" && exerciseIds.length > 0) {
		const library = yield* executeRyotqlRecipe(
			host.executeRyotql,
			userFitnessLibraryRecipe({ kind: "self" }),
		);
		for (const exerciseId of exerciseIds) {
			relationships.push({
				properties: {},
				propertiesMode: "merge",
				relationshipSchemaSlug: "in-fitness-library",
				source: { kind: "existing", entityId: EntityId.make(exerciseId) },
				target: { kind: "existing", entityId: EntityId.make(library.entityId) },
			});
		}
	}
	if (sourceLink) {
		relationships.push({
			properties: {},
			propertiesMode: "merge",
			source: { kind: "root" },
			relationshipSchemaSlug: sourceLink.relationshipSchemaSlug,
			target: { kind: "existing", entityId: EntityId.make(sourceLink.targetEntityId) },
		});
	}
	const updates: UpdateEventItem[] = [];
	const creates: Array<UserCommandInput["events"]["creates"][number]> = [];
	const savedSets: SavedSet[] = [];
	for (const [exerciseOrder, occurrence] of (data.kind === "workout"
		? data.occurrences
		: []
	).entries()) {
		for (const [setOrder, set] of occurrence.sets.entries()) {
			const setProperties = buildWorkoutSetEventProperties({
				...set.measurements,
				...set,
				setOrder,
				exerciseOrder,
			});
			const original = baseline?.sets.find(({ id }) => id === set.eventId);
			if (original === undefined) {
				creates.push({
					properties: setProperties,
					session: { kind: "root" },
					occurredAt: set.occurredAt,
					eventSchemaSlug: "workout-set",
					itemIdentity: `set:${set.clientId}`,
					entity: { kind: "existing", entityId: EntityId.make(occurrence.exerciseId) },
				});
			} else {
				if (
					original.entityId !== occurrence.exerciseId ||
					!jsonValueEquals(workoutEditableSetProperties(original.properties), setProperties)
				) {
					updates.push({
						eventId: original.id,
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
				}
				savedSets.push({ eventId: original.id, clientId: set.clientId });
			}
		}
	}
	const retained = new Set(savedSets.map(({ eventId }) => eventId));
	const removed = baseline?.sets.filter(({ id }) => !retained.has(id)) ?? [];
	if (data.kind === "workout" && data.target.kind === "create") {
		creates.push({
			occurredAt: submittedAt,
			itemIdentity: "complete",
			entity: { kind: "root" },
			eventSchemaSlug: "workout-completed",
			properties: { workoutName: data.name },
		});
	}
	const command = yield* Schema.decodeUnknownEffect(userCommandInputSchema)({
		relationships,
		entity: {
			properties,
			name: data.name,
			entitySchemaSlug: data.kind === "workout" ? "workout" : "workout-template",
			target:
				baseline === undefined
					? { kind: "create" }
					: {
							kind: "update",
							entityId: baseline.entity.id,
							expected: {
								name: baseline.entity.name,
								updatedAt: baseline.entity.updatedAt,
								properties: baseline.entity.properties,
							},
						},
		},
		events: {
			creates,
			changes: [
				...updates.map((item) => ({
					item,
					kind: "update",
					itemIdentity: `update:${item.eventId}`,
				})),
				...removed.map((item) => ({
					kind: "delete",
					eventId: item.id,
					expected: eventExpected(item),
					itemIdentity: `delete:${item.id}`,
				})),
			],
			...(baseline && data.kind === "workout"
				? {
						expected: {
							eventSchemaSlug: "workout-set",
							eventIds: baseline.sets.map((set) => set.id),
						},
					}
				: {}),
		},
	}).pipe(Effect.mapError((error) => new WorkoutCommandInputError({ message: String(error) })));
	const committed = yield* host.commitUserChanges(command, options("save")).pipe(
		Effect.catch((error) =>
			Effect.gen(function* () {
				const stale = Schema.decodeUnknownOption(
					Schema.Struct({
						code: Schema.Literals([
							"event-stale",
							"entity-stale",
							"concurrent-relationship-change",
							"mutation-conflict",
						]),
					}),
				)(error.data);
				if (Option.isSome(stale)) {
					return yield* conflict();
				}
				return yield* Effect.fail(error);
			}),
		),
	);
	for (const result of committed.events) {
		if (result.itemIdentity.startsWith("set:")) {
			savedSets.push({ eventId: result.eventId, clientId: result.itemIdentity.slice(4) });
		}
	}
	return {
		kind: "saved",
		sets: savedSets,
		entityId: committed.entityId,
	} satisfies WorkoutEditorSaveOutput;
});

export type WorkoutEditorSaveError =
	SandboxHostError | RyotqlRecipeDecodeError | WorkoutCommandInputError;

export const saveWorkoutEditor = (
	input: WorkoutEditorSaveInput,
	host: ScriptHost,
): Effect.Effect<WorkoutEditorSaveOutput, WorkoutEditorSaveError> =>
	persistWorkoutEditor(input, host).pipe(
		Effect.catchTag("WorkoutSaveHalt", ({ output }) => Effect.succeed(output)),
	);
