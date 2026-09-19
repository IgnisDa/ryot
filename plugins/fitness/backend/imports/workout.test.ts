import { expect, it } from "vitest";

import { toWorkoutWriteItem } from "./workout";

it("links imported exercises to the fitness library without media membership", () => {
	const item = toWorkoutWriteItem({
		itemIndex: 0,
		endedAt: null,
		name: "Morning workout",
		sourceIdentifier: "workout-1",
		sourceLabel: "Morning workout",
		startedAt: "2026-01-01T08:00:00.000Z",
		exercises: [{ sets: [], name: "Bench Press", kind: "reps_and_weight" }],
	});

	expect(item.subjectEntityAlias).toBe("workout");
	expect(item.relationships).toEqual([
		{
			properties: {},
			propertiesMode: "merge",
			sourceAlias: "exercise-0",
			targetAlias: "fitness-library",
			relationshipSchemaSlug: "in-fitness-library",
			operationId: '["workout",0,"exercise-membership",0]',
		},
	]);
	expect(item.entities).toContainEqual({
		scope: "user",
		properties: {},
		existingOnly: true,
		name: "Fitness Library",
		alias: "fitness-library",
		entitySchemaSlug: "fitness-library",
		operationId: '["workout",0,"fitness-library"]',
		match: { properties: {}, name: "Fitness Library" },
	});
	expect(JSON.stringify(item)).not.toContain("in-media-library");
});

it("requests exact catalog resolution while preserving custom fallback data and aliases", () => {
	const item = toWorkoutWriteItem({
		itemIndex: 0,
		endedAt: null,
		name: "Morning workout",
		sourceIdentifier: "workout-1",
		sourceLabel: "Morning workout",
		startedAt: "2026-01-01T08:00:00.000Z",
		exercises: [
			{
				name: "Bench Press",
				kind: "reps_and_weight",
				sets: [{ reps: 5, weight: 100, setLot: "normal", note: "Felt strong" }],
			},
		],
	});

	expect(item.entities[0]).toEqual({
		scope: "user",
		name: "Bench Press",
		alias: "exercise-0",
		entitySchemaSlug: "exercise",
		operationId: '["workout",0,"exercise",0]',
		properties: { images: [], muscles: [], instructions: [], kind: "reps_and_weight" },
		match: {
			name: "Bench Press",
			nameNormalization: "slug",
			properties: { kind: "reps_and_weight" },
		},
		providerResolution: {
			value: "Bench Press",
			identifierType: "name",
			providerSlug: "exercise.free-exercise-db",
		},
	});
	expect(item.events[0]).toMatchObject({
		entityAlias: "exercise-0",
		sessionEntityAlias: "workout",
		properties: { reps: 5, weight: 100, note: "Felt strong" },
	});
});

it("keeps workout operations distinct across batches and retains exercise and set order", () => {
	const workouts = Array.from({ length: 76 }, (_, index) => ({
		endedAt: null,
		itemIndex: index * 3,
		name: `Workout ${index}`,
		startedAt: "2026-01-01T08:00:00.000Z",
		sourceLabel: `Source row ${index * 3 + 1}`,
		sourceIdentifier: `source-workout-${index}`,
		exercises: [
			{
				name: "Bench Press",
				kind: "reps_and_weight" as const,
				sets: [
					{ reps: 5, weight: 100, setLot: "normal" as const },
					{ reps: 3, weight: 110, setLot: "normal" as const },
				],
			},
			{
				name: "Run",
				kind: "distance_and_duration" as const,
				sets: [{ distance: 5000, duration: 1200, setLot: "normal" as const }],
			},
		],
	}));
	const items = workouts.map(toWorkoutWriteItem);
	const operationIds = items.flatMap((item) =>
		[...item.entities, ...item.events, ...item.relationships].map((intent) => intent.operationId),
	);
	expect(new Set(operationIds).size).toBe(operationIds.length);
	for (const size of [25, 50]) {
		const repartitioned = [];
		for (let start = 0; start < workouts.length; start += size) {
			repartitioned.push(...workouts.slice(start, start + size).map(toWorkoutWriteItem));
		}
		expect(repartitioned).toEqual(items);
	}
	expect(items[50]).toMatchObject({
		itemIndex: 150,
		recordId: '["workout",150]',
		sourceLabel: "Source row 151",
		sourceIdentifier: "source-workout-50",
		events: [
			{ properties: { reps: 5, setOrder: 0, weight: 100, exerciseOrder: 0 } },
			{ properties: { reps: 3, setOrder: 1, weight: 110, exerciseOrder: 0 } },
			{ properties: { setOrder: 0, distance: 5000, duration: 1200, exerciseOrder: 1 } },
		],
	});
	expect(
		items
			.flatMap((item) => item.entities.filter((entity) => entity.outcome))
			.map((entity) => entity.outcome),
	).toEqual(Array.from({ length: 76 }, () => ({ unit: "workouts", recordKind: "workouts" })));
});
