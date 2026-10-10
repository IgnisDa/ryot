import { Result, Schema } from "@ryot-app/plugin-kit/effect";
import {
	and,
	ascending,
	castDate,
	castText,
	column,
	eq,
	inArray,
	join,
	jsonPath,
	literal,
	selectedField,
	selectedInclude,
	selectedRowsSource,
	table,
	titleCase,
	type SelectedIncludes,
	type SelectedSelection,
} from "@ryot-app/plugin-kit/ryotql";
import { LocalAssetLocator, RemoteAssetLocator, S3AssetLocator } from "@ryot-app/plugin-kit/schema";

import { propertyNumber } from "./entity-selections";
import { ExerciseNotesSchema } from "./workout-details-recipes";

type Table = ReturnType<typeof table>;

const selectedPresentationSource = <
	const Selection extends SelectedSelection,
	const Includes extends SelectedIncludes = Record<never, never>,
>(input: {
	readonly table: Table;
	readonly selection: Selection;
	readonly include?: Includes | undefined;
	readonly where: (entityIds: readonly string[]) => ReturnType<typeof and>;
}) => {
	const source = selectedRowsSource(input.table, {
		selection: input.selection,
		...(input.include === undefined ? {} : { include: input.include }),
	});
	return {
		...source,
		query: (entityIds: readonly string[]) =>
			source.query({ limit: 100, where: input.where(entityIds) }),
	};
};

const entityIdsWhere = (entity: Table, slug: string, entityIds: readonly string[]) =>
	and(
		eq(column(entity, "entitySchemaSlug"), literal(slug)),
		inArray(
			column(entity, "id"),
			entityIds.map((entityId) => literal(entityId)),
		),
	);

const AssetLocator = Schema.Union([LocalAssetLocator, RemoteAssetLocator, S3AssetLocator]);
const nullableNumber = Schema.NullOr(Schema.Finite);

export const fitnessPresentationSource = (slug: string) => {
	const entity = table("entity", "entity");
	const property = (key: string) => jsonPath(column(entity, "properties"), key);
	const isExercise = slug === "exercise";
	const recordedAt =
		slug === "workout-template" ? column(entity, "createdAt") : property("recordedAt");
	return selectedPresentationSource({
		table: entity,
		where: (entityIds) => entityIdsWhere(entity, slug, entityIds),
		selection: {
			presentationId: selectedField(column(entity, "id"), Schema.String),
			presentationName: selectedField(column(entity, "name"), Schema.String),
			presentationCallout: selectedField(
				isExercise ? titleCase(property("level")) : literal(null),
				Schema.NullOr(Schema.String),
			),
			presentationSecondary: selectedField(
				isExercise ? literal(null) : castText(property("comment")),
				Schema.NullOr(Schema.String),
			),
			presentationPrimary: selectedField(
				isExercise ? titleCase(property("kind")) : castDate(recordedAt),
				Schema.NullOr(Schema.String),
			),
			presentationImage: selectedField(
				isExercise ? jsonPath(column(entity, "properties"), "images", 0) : literal(null),
				Schema.NullOr(AssetLocator),
			),
		},
	});
};

export type FitnessPresentationSourceData = Result.Result.Success<
	ReturnType<ReturnType<typeof fitnessPresentationSource>["decode"]>
>;

export const workoutPresentationSets = (workout: Table) => {
	const set = table("event", "presentationWorkoutSet");
	const exercise = table("entity", "presentationWorkoutExercise");
	return selectedInclude(set, {
		limit: 100,
		joins: [join("inner", exercise, eq(column(set, "entityId"), column(exercise, "id")))],
		orderBy: [
			ascending(propertyNumber(set, "exerciseOrder")),
			ascending(propertyNumber(set, "setOrder")),
		],
		where: and(
			eq(column(set, "sessionEntityId"), column(workout, "id")),
			eq(column(set, "eventSchemaSlug"), literal("workout-set")),
			eq(column(exercise, "entitySchemaSlug"), literal("exercise")),
		),
		selection: {
			id: selectedField(column(set, "id"), Schema.String),
			reps: selectedField(propertyNumber(set, "reps"), nullableNumber),
			exerciseId: selectedField(column(exercise, "id"), Schema.String),
			weight: selectedField(propertyNumber(set, "weight"), nullableNumber),
			exerciseName: selectedField(column(exercise, "name"), Schema.String),
			setOrder: selectedField(propertyNumber(set, "setOrder"), nullableNumber),
			duration: selectedField(propertyNumber(set, "duration"), nullableNumber),
			distance: selectedField(propertyNumber(set, "distance"), nullableNumber),
			exerciseOrder: selectedField(propertyNumber(set, "exerciseOrder"), nullableNumber),
		},
	});
};

export const workoutPresentationSource = () => {
	const workout = table("entity", "entity");
	const selected = selectedPresentationSource({
		table: workout,
		include: { presentationSets: workoutPresentationSets(workout) },
		where: (entityIds) => entityIdsWhere(workout, "workout", entityIds),
		selection: {
			presentationId: selectedField(column(workout, "id"), Schema.String),
			presentationName: selectedField(column(workout, "name"), Schema.String),
			presentationEndedAt: selectedField(
				castDate(jsonPath(column(workout, "properties"), "endedAt")),
				Schema.NullOr(Schema.String),
			),
			presentationStartedAt: selectedField(
				castDate(jsonPath(column(workout, "properties"), "startedAt")),
				Schema.NullOr(Schema.String),
			),
			presentationExerciseNotes: selectedField(
				jsonPath(column(workout, "properties"), "exerciseNotes"),
				Schema.NullOr(ExerciseNotesSchema),
			),
		},
	});
	type Source = Result.Result.Success<ReturnType<typeof selected.decode>>;
	const map = (source: Source) => {
		const createExercise = (set: Source["presentationSets"]["items"][number]) => ({
			id: set.exerciseId,
			name: set.exerciseName,
			order: set.exerciseOrder,
			sets: new Array<typeof set>(),
			notes:
				source.presentationExerciseNotes?.find(
					({ exerciseOrder }) => exerciseOrder === set.exerciseOrder,
				)?.notes ?? [],
		});
		const exercises = new Map<string, ReturnType<typeof createExercise>>();
		for (const set of source.presentationSets.items) {
			const key = `${set.exerciseOrder}:${set.exerciseId}`;
			const current = exercises.get(key) ?? createExercise(set);
			current.sets.push(set);
			exercises.set(key, current);
		}
		return {
			name: source.presentationName,
			endedAt: source.presentationEndedAt,
			presentationId: source.presentationId,
			startedAt: source.presentationStartedAt,
			exercises: [...exercises.values()].sort(
				(left, right) => (left.order ?? 0) - (right.order ?? 0),
			),
		};
	};
	return {
		...selected,
		map,
		decode: (source: unknown) => Result.map(selected.decode(source), map),
	};
};

export const decodeWorkoutPresentation = (source: unknown) =>
	workoutPresentationSource().decode(source);

export type WorkoutPresentationSourceData = Result.Result.Success<
	ReturnType<ReturnType<typeof workoutPresentationSource>["decode"]>
>;

export type WorkoutPresentationData = Omit<WorkoutPresentationSourceData, "presentationId">;
