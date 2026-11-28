import {
	type ChangeSet,
	continuationCursor,
	createEventChange,
	deleteEventChange,
	EntitlementRequiredError,
	entityUpdateTarget,
	type EventChange,
	type EventCreate,
	existingEntity,
	expectedEventFields,
	isEntitled,
	MANAGED_ASSET_VERIFY_SANDBOX_LIMITS,
	type RelationshipUpsert,
	rootEntity,
	type ScriptHost,
	updateEventChange,
	verifyManagedAssets,
} from "@ryot-app/plugin-backend-sdk/core";
import { Effect, Option, Schema } from "@ryot-app/plugin-backend-sdk/effect";
import { reject, StaleBaselineError } from "@ryot-app/plugin-backend-sdk/operation";
import {
	entityEventScopeRevisionRecipe,
	executeRyotqlRecipe,
} from "@ryot-app/plugin-backend-sdk/ryotql";
import type { Recipe } from "@ryot-app/plugin-kit/ryotql";
import { EntityId, EventId, jsonValueEquals } from "@ryot-app/plugin-kit/schema";

import { exerciseKindSchema } from "../../shared/exercise-kinds";
import { userFitnessLibraryRecipe } from "../../shared/library-recipes";
import { type Catalog, catalogMessage } from "../../shared/messages.generated";
import type {
	WorkoutEditorSaveInput,
	WorkoutEditorSaveOutput,
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
import { workoutOccurrencesRecipe } from "../../shared/workout-taxonomy-recipes";

type Data = WorkoutEditorSaveInput["data"];
type InvalidCode = keyof typeof invalidMessages;
type Properties = WorkoutEditorEvent["properties"];
type WorkoutData = Extract<Data, { kind: "workout" }>;
type TemplateData = Extract<Data, { kind: "template" }>;
type SourceSet = WorkoutEditorEvent & { readonly set: WorkoutSetProperties };

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

const invalidMessages = {
	"duplicate-id": "rejection.workout-save.duplicate-id",
	"invalid-time": "rejection.workout-save.invalid-time",
	"invalid-source": "rejection.workout-save.invalid-source",
	"media-forbidden": "rejection.workout-save.media-forbidden",
	"unrelated-event": "rejection.workout-save.unrelated-event",
	"invalid-superset": "rejection.workout-save.invalid-superset",
	"missing-exercise": "rejection.workout-save.missing-exercise",
	"invalid-measurement": "rejection.workout-save.invalid-measurement",
	"missing-measurement": "rejection.workout-save.missing-measurement",
	"invalid-exercise-kind": "rejection.workout-save.invalid-exercise-kind",
} as const satisfies Record<string, keyof Catalog>;

const invalid = (code: InvalidCode) => reject(catalogMessage(invalidMessages[code]));

const proRequired = () => Effect.fail(new EntitlementRequiredError({ entitlement: "pro" }));

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

const eventExpected = (set: WorkoutEditorEvent) => expectedEventFields(set, editableFields);

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

const loadBaseline = Effect.fn("loadBaseline")(function* (data: Data) {
	if (data.target.kind !== "update") {
		return undefined;
	}
	const decoded = decodeWorkoutEditorBaseline(data.target.conflictToken);
	if (decoded._tag === "Failure" || decoded.success.entity.id !== data.target.entityId) {
		return yield* invalid("invalid-source");
	}
	const { entity } = decoded.success;
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
	for (const { items } of chunked(baseline.sets, WORKOUT_EDITOR_PAGE_SIZE)) {
		const identities = yield* executeRyotqlRecipe(
			host.executeRyotql,
			workoutEditorEventIdentitiesRecipe({ reference: { kind: "self" } }),
			{ eventIds: items.map(({ id }) => id) },
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
		workoutEditorEntityRecipe({ reference: { kind: "self" } }),
		{
			entityId: targetEntityId,
			kind: repeatedFromId !== undefined ? "workout" : "workout-template",
		},
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
			workoutEditorExercisesRecipe({ reference: { kind: "self" } }),
			{ exerciseIds: items },
			{ pages: { exercises: { after: undefined } } },
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
			workoutEditorExercisesRecipe({ reference: { kind: "self" } }),
			{ exerciseIds: [source.exerciseId] },
			{ pages: { exercises: { after: undefined } } },
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

export const saveWorkoutEditor = Effect.fn("saveWorkoutEditor")(function* (
	input: WorkoutEditorSaveInput,
	host: ScriptHost,
) {
	const { data, submittedAt } = input;
	const baseline = yield* loadBaseline(data);
	const entitySchemaSlug = data.kind === "workout" ? "workout" : "workout-template";
	if (
		baseline &&
		!(yield* executeRyotqlRecipe(
			host.executeRyotql,
			workoutEditorEntityRecipe({ reference: { kind: "self" } }),
			{ kind: entitySchemaSlug, entityId: baseline.entity.id },
		))
	) {
		return yield* new StaleBaselineError({ conflict: "entity-not-found" });
	}
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
	const proAvailable = isEntitled(yield* host.getEntitlements(), "pro");
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
		yield* verifyManagedAssets(host.verifyManagedAssets, items).pipe(
			Effect.catchTag("ManagedAssetForbiddenError", () => invalid("media-forbidden")),
		);
	}
	const relationships: Array<RelationshipUpsert> = [];
	if (data.kind === "workout" && exerciseIds.length > 0) {
		const library = yield* executeRyotqlRecipe(
			host.executeRyotql,
			userFitnessLibraryRecipe({ kind: "self" }),
			{},
		);
		for (const exerciseId of exerciseIds) {
			relationships.push({
				properties: {},
				propertiesMode: "merge",
				relationshipSchemaSlug: "in-fitness-library",
				source: existingEntity(EntityId.make(exerciseId)),
				target: existingEntity(EntityId.make(library.entityId)),
			});
		}
	}
	if (sourceLink) {
		relationships.push({
			properties: {},
			source: rootEntity,
			propertiesMode: "merge",
			relationshipSchemaSlug: sourceLink.relationshipSchemaSlug,
			target: existingEntity(EntityId.make(sourceLink.targetEntityId)),
		});
	}
	const updates: EventChange[] = [];
	const creates: Array<EventCreate> = [];
	const occurrenceChanges: EventChange[] = [];
	let scopeRevision: number | undefined;
	if (data.kind === "workout") {
		const recorded: Array<
			Recipe.Success<ReturnType<typeof workoutOccurrencesRecipe>>["items"][number]
		> = [];
		if (baseline) {
			scopeRevision = yield* executeRyotqlRecipe(
				host.executeRyotql,
				entityEventScopeRevisionRecipe,
				{ entityId: baseline.entity.id },
			);
			let after: string | undefined;
			do {
				const page = yield* executeRyotqlRecipe(
					host.executeRyotql,
					workoutOccurrencesRecipe({ reference: { kind: "self" } }),
					{ workoutId: baseline.entity.id },
					{ pages: { occurrences: { after: after } } },
				);
				recorded.push(...page.items);
				after = yield* continuationCursor(page.pageInfo, after).pipe(
					Effect.catchTag("PaginationError", () => invalid("invalid-source")),
				);
			} while (after !== undefined);
		}
		const retainedOccurrences = new Set<string>();
		for (const [exerciseOrder, occurrence] of data.occurrences.entries()) {
			if (occurrence.sets.length === 0) {
				continue;
			}
			const previous = recorded.find(
				(item) => item.properties.exerciseOrder === occurrence.sourceExerciseOrder,
			);
			if (occurrence.sourceExerciseOrder !== undefined && !previous) {
				return yield* new StaleBaselineError({ conflict: "event-not-found" });
			}
			if (previous) {
				const originalSets =
					baseline?.sets.filter(
						({ set }) => set.exerciseOrder === occurrence.sourceExerciseOrder,
					) ?? [];
				if (
					originalSets.some(
						(set) =>
							set.entityId !== previous.entityId ||
							set.set.exerciseKind !== previous.properties.exerciseKind,
					)
				) {
					return yield* invalid("invalid-source");
				}
			}
			if (previous && previous.entityId === occurrence.exerciseId) {
				retainedOccurrences.add(previous.id);
				if (previous.properties.exerciseOrder !== exerciseOrder) {
					occurrenceChanges.push(
						updateEventChange(
							previous.id,
							{ properties: { remove: [], set: { exerciseOrder } } },
							expectedEventFields(previous),
						),
					);
				}
			} else {
				const firstSet = occurrence.sets[0];
				if (!firstSet) {
					continue;
				}
				creates.push(
					createEventChange(`occurrence:${occurrence.clientId}`, {
						session: rootEntity,
						occurredAt: data.startedAt,
						eventSchemaSlug: "workout-exercise",
						entity: existingEntity(EntityId.make(occurrence.exerciseId)),
						properties: {
							targets: [],
							exerciseOrder,
							equipment: [],
							exerciseKind: firstSet.exerciseKind,
						},
					}),
				);
			}
		}
		for (const previous of recorded) {
			if (!retainedOccurrences.has(previous.id)) {
				occurrenceChanges.push(deleteEventChange(previous.id, expectedEventFields(previous)));
			}
		}
	}
	const retained = new Set<string>();
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
			if (original === undefined || original.entityId !== occurrence.exerciseId) {
				creates.push(
					createEventChange(`set:${set.clientId}`, {
						session: rootEntity,
						properties: setProperties,
						eventSchemaSlug: "workout-set",
						occurredAt: original?.occurredAt ?? set.occurredAt,
						entity: existingEntity(EntityId.make(occurrence.exerciseId)),
					}),
				);
			} else {
				if (!jsonValueEquals(workoutEditableSetProperties(original.properties), setProperties)) {
					updates.push(
						updateEventChange(
							EventId.make(original.id),
							{
								occurredAt: original.occurredAt,
								properties: {
									set: setProperties,
									remove: editableFields.filter((key) => !Object.hasOwn(setProperties, key)),
								},
							},
							eventExpected(original),
						),
					);
				}
				retained.add(original.id);
			}
		}
	}
	const removed = baseline?.sets.filter(({ id }) => !retained.has(id)) ?? [];
	if (data.kind === "workout" && data.target.kind === "create") {
		creates.push(
			createEventChange("complete", {
				entity: rootEntity,
				occurredAt: submittedAt,
				eventSchemaSlug: "workout-completed",
				properties: { workoutName: data.name },
			}),
		);
	}
	const changes = {
		...(relationships.length > 0 ? { relationships: { upserts: relationships } } : {}),
		entity: {
			properties,
			name: data.name,
			entitySchemaSlug,
			target: baseline === undefined ? { kind: "create" } : entityUpdateTarget(baseline.entity),
		},
		events: {
			...(baseline && scopeRevision !== undefined
				? { baselines: [{ revision: scopeRevision, entityId: baseline.entity.id }] }
				: {}),
			changes: [
				...creates,
				...occurrenceChanges,
				...updates,
				...removed.map((item) => deleteEventChange(EventId.make(item.id), eventExpected(item))),
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
	} satisfies ChangeSet;
	return { changes, output: {} } satisfies {
		readonly changes: ChangeSet;
		readonly output: WorkoutEditorSaveOutput;
	};
});
