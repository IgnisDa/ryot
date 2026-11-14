import { expect, it } from "bun:test";

import { UTC } from "@ryot-app/contract/schema/time-zone";
import { Result } from "@ryot-app/plugin-client-sdk/effect";

import { preferenceSettings } from "../tests/client/draft-fixtures";
import { fitnessEntityCardPresentation, prepareFitnessPresentations } from "./entity-presentation";
import { prepareWorkoutPresentations } from "./workout-presentation";

const reference = (entityId: string, entitySchemaSlug: string) => ({
	entityId,
	name: entityId,
	entitySchemaSlug,
	ownerPluginId: "fitness",
	populationStatus: { state: "succeeded", availability: "complete" } as const,
	translationStatus: { state: "succeeded", availability: "complete" } as const,
});
const metric = {
	presentationImage: null,
	presentationId: "metric",
	presentationCallout: null,
	presentationPrimary: "kg",
	presentationName: "Weight",
	presentationSecondary: null,
};

it("renders public measurement cards without requiring private readings", () => {
	const references = [reference("metric", "measurement-metric")];
	const sources = new Map([["metric", metric]]);
	const data = Result.getOrThrow(fitnessEntityCardPresentation.prepare({ sources, references }));
	expect(data["metric"]).toMatchObject({ primary: "kg", name: "Weight" });
	expect(Result.isFailure(prepareFitnessPresentations({ sources, references }))).toBe(true);
	const owner = Result.getOrThrow(
		prepareFitnessPresentations({
			references,
			sources: new Map([
				[
					"metric",
					{
						...metric,
						presentationLatestValue: 73.6,
						presentationLatestAt: "2026-10-08T12:00:00.000Z",
					},
				],
			]),
		}),
	);
	expect(owner["metric"]?.primary).toBe("73.6 kg · 8 Oct");
});

it("prepares workouts using captured context, sets and comparison data", () => {
	const included = { items: [], pageInfo: { limit: 100, hasMore: false } };
	const sources = new Map([
		[
			"workout",
			{
				setCount: 0,
				volume: 480,
				sets: included,
				muscleCount: 0,
				name: "Push day",
				exerciseCount: 0,
				personalBests: 0,
				muscles: included,
				template: included,
				entityId: "workout",
				processing: "ready",
				activeDuration: 3600,
				repeatedFromId: null,
				comparisons: included,
				previousTemplateWorkoutId: null,
				endedAt: "2026-09-07T09:00:00.000Z",
				startedAt: "2026-09-07T08:00:00.000Z",
			},
		],
	]);
	const references = [reference("workout", "workout")];
	expect(Result.isFailure(prepareWorkoutPresentations({ sources, references }))).toBe(true);
	const result = Result.getOrThrow(
		prepareWorkoutPresentations({
			sources,
			references,
			context: {
				timeZone: UTC,
				now: Date.parse("2026-09-07T10:00:00Z"),
				settings: { ...preferenceSettings, unitSystem: "imperial" },
			},
		}),
	);
	expect(result["workout"]).toMatchObject({ name: "Push day", volume: "1,058 lb × reps" });
});
