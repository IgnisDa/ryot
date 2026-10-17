import { DateTime, Effect } from "effect";
import { Playwright, PlaywrightSpawner } from "effect-playwright";

import {
	createAuthenticatedClient,
	createEntity,
	createRelationship,
	pollUntil,
} from "~/fixtures/kernel";
import type { Client } from "~/fixtures/kernel/auth";
import {
	createExerciseEntityFixture,
	createWorkoutTemplateEntityFixture,
	findFitnessEntitySchema,
	findFitnessRelationshipSchema,
	openFitnessPage,
	readWorkoutDetails,
	seedExerciseWorkout,
} from "~/fixtures/plugins/fitness";
import { signInThroughHostedOAuth } from "~/support/browser";
import { expect, it } from "~/support/effect-test";

const waitForReadySets = (client: Client, workoutId: string) =>
	pollUntil(
		`ready workout sets for ${workoutId}`,
		Effect.gen(function* () {
			const workout = yield* readWorkoutDetails(client, workoutId);
			const sets = workout.exercises.items.flatMap((exercise) => exercise.sets.items);
			return sets.length > 0 && sets.every((set) => set.recordStatus === "ready") ? sets : null;
		}),
	);

it.live("guides a new user, then shows the launchpad once a workout exists", () =>
	Effect.gen(function* () {
		const { email, client, password } = yield* createAuthenticatedClient();
		const id = crypto.randomUUID();
		const page = yield* (yield* Playwright.Browser).newPage();
		yield* signInThroughHostedOAuth(page, email, password);
		const frame = yield* openFitnessPage(page, "/p/ryot/fitness");

		yield* frame
			.getByRole("heading", { level: 2, exact: true, name: "Your training starts here" })
			.waitFor();
		yield* frame.getByRole("link", { exact: true, name: "Start your first workout" }).waitFor();
		yield* frame.getByText("0 of 4 done", { exact: true }).waitFor();
		yield* frame.getByRole("link", { exact: true, name: "Upload CSV for Hevy export" }).waitFor();

		const { exerciseId } = yield* createExerciseEntityFixture(client, { name: `Home bench ${id}` });
		const [{ schema: targetSchema }, targetRelationshipSchema] = yield* Effect.all([
			findFitnessEntitySchema(client, "exercise-target"),
			findFitnessRelationshipSchema(client, "exercise-targets"),
		]);
		const target = yield* createEntity(client, {
			name: `Home chest ${id}`,
			entitySchema: targetSchema.reference,
			properties: { kind: "muscle_region" },
		});
		yield* createRelationship(client, {
			targetEntityId: target.id,
			sourceEntityId: exerciseId,
			properties: { role: "primary" },
			relationshipSchema: targetRelationshipSchema.reference,
		});
		const { workoutTemplateId } = yield* createWorkoutTemplateEntityFixture(client, {
			exerciseId,
			name: `Home template ${id}`,
		});
		const startedAt = DateTime.subtract(yield* DateTime.now, { days: 2 });
		const { workoutId } = yield* seedExerciseWorkout(client, {
			exerciseId,
			name: `Home workout ${id}`,
			startedAt: DateTime.formatIso(startedAt),
			endedAt: DateTime.formatIso(DateTime.add(startedAt, { hours: 1 })),
			sets: [{ properties: { reps: 5, weight: 100 }, occurredAt: DateTime.formatIso(startedAt) }],
		});
		yield* waitForReadySets(client, workoutId);
		yield* page.reload;

		yield* frame.getByRole("heading", { level: 1, exact: true, name: "Home" }).waitFor();
		yield* frame
			.getByRole("region", { exact: true, name: "Last workout" })
			.getByText(`Home workout ${id}`, { exact: true })
			.waitFor();
		const start = frame.getByRole("link", { exact: true, name: `Start Home template ${id}` });
		yield* start.waitFor();
		expect(yield* start.getAttribute("href")).toContain(`/templates/${workoutTemplateId}/start`);
		const muscles = frame.getByRole("region", { exact: true, name: "Muscles" });
		yield* muscles.getByText(`Home chest ${id}`, { exact: true }).waitFor();
		yield* muscles.getByText("2d", { exact: true }).waitFor();
		yield* frame
			.getByRole("region", { exact: true, name: "Recent personal bests" })
			.getByText(`Home bench ${id}`, { exact: true })
			.waitFor();
		expect(yield* frame.getByRole("heading", { name: "Your training starts here" }).count).toBe(0);

		yield* frame.getByRole("link", { exact: true, name: "Choose a goal" }).click();
		yield* page.waitForURL((url) => url.pathname === "/settings/plugin-preferences");
	}).pipe(PlaywrightSpawner.withBrowser),
);
