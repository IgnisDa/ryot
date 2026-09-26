import { expect, it } from "vitest";

import { toWorkoutWriteItem } from "./workout";

it("does not emit media membership for fitness imports", () => {
	const item = toWorkoutWriteItem({
		itemIndex: 0,
		endedAt: null,
		exercises: [],
		name: "Morning workout",
		sourceIdentifier: "workout-1",
		sourceLabel: "Morning workout",
		startedAt: "2026-01-01T08:00:00.000Z",
	});

	expect(item.subjectEntityAlias).toBe("workout");
	expect(item.relationships).toEqual([]);
	expect(JSON.stringify(item)).not.toContain("in-media-library");
	expect(JSON.stringify(item)).not.toContain("in-fitness-library");
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
