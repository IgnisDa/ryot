import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import {
	countActorSignals,
	createAuthenticatedClient,
	createBuiltinMediaLifecycleFixture,
	createEntity,
	createNotificationChannel,
	findBuiltinSchemaBySlug,
	querySignalBySlug,
	queryRecipientUserIds,
	querySubscriptionRuns,
	runHevyImportFixture,
	startFakeAppriseServer,
} from "../fixtures";
import { pollUntil } from "../fixtures/polling";
import { requireString } from "../test-support/assertions";
import type { FakeHttpServer } from "../test-support/fake-http-server";

let fakeApprise: FakeHttpServer;

beforeAll(async () => {
	fakeApprise = await startFakeAppriseServer();
});

afterAll(() => {
	fakeApprise.stop();
});

const waitForActorSignal = (slug: string, actorUserId: string) =>
	pollUntil(`${slug} signal for actor ${actorUserId}`, async () => {
		const signal = await querySignalBySlug({ slug, actorUserId });
		return signal ?? null;
	});

const waitForAppriseDelivery = (path: string) =>
	pollUntil(`apprise delivery to ${path}`, () => {
		const match = fakeApprise.requests.find((request) => request.path === path);
		return Promise.resolve(match ?? null);
	});

describe("actor-audience automation signals", () => {
	it("emits review.created author-only and delivers to the author's channel", async () => {
		const author = await createAuthenticatedClient();
		const other = await createAuthenticatedClient();

		const authorKey = `review-author-${crypto.randomUUID()}`;
		const otherKey = `review-other-${crypto.randomUUID()}`;
		await createNotificationChannel(author.client, {
			kind: "apprise",
			specifics: { baseUrl: fakeApprise.url, key: authorKey, kind: "apprise" },
		});
		await createNotificationChannel(other.client, {
			kind: "apprise",
			specifics: { baseUrl: fakeApprise.url, key: otherKey, kind: "apprise" },
		});

		const { entityId, reviewEventSchemaId } = await createBuiltinMediaLifecycleFixture(
			author.client,
		);

		const created = await author.client.run((c) =>
			c.events.create({
				payload: [
					{
						entityId,
						eventSchemaId: reviewEventSchemaId,
						properties: { rating: 5, text: "Great" },
					},
				],
			}),
		);
		expect(created.count).toBe(1);

		const signal = await waitForActorSignal("review.created", author.userId);
		expect(signal.actorUserId).toBe(author.userId);
		expect(signal.subjectEntityId).toBeNull();
		expect(signal.properties.entityId).toBe(entityId);
		expect(typeof signal.properties.reviewEventId).toBe("string");
		expect(typeof signal.properties.entitySchemaSlug).toBe("string");
		const entityName = requireString(
			signal.properties.entityName,
			"Expected review signal entityName",
		);

		expect(await countActorSignals({ slug: "review.created", actorUserId: author.userId })).toBe(1);
		expect(await queryRecipientUserIds(signal.id)).toEqual([author.userId]);

		const delivered = await waitForAppriseDelivery(`/notify/${authorKey}`);
		expect(delivered.body).toEqual({ title: "Ryot", body: `Review created for ${entityName}` });

		const succeededRuns = await pollUntil("review.created signal run", async () => {
			const runs = await querySubscriptionRuns({ signalId: signal.id, status: "succeeded" });
			return runs.length > 0 ? runs : null;
		});
		expect(succeededRuns).toHaveLength(1);
		expect(succeededRuns[0]?.operation).toBe("signal");
		expect(succeededRuns[0]?.executionUserId).toBe(author.userId);

		expect(await countActorSignals({ slug: "review.created", actorUserId: other.userId })).toBe(0);
		expect(
			fakeApprise.requests.filter((request) => request.path === `/notify/${otherKey}`),
		).toEqual([]);
	});

	it("emits workout.created author-only with the workout name in the body", async () => {
		const author = await createAuthenticatedClient();

		const authorKey = `workout-author-${crypto.randomUUID()}`;
		await createNotificationChannel(author.client, {
			kind: "apprise",
			specifics: { baseUrl: fakeApprise.url, key: authorKey, kind: "apprise" },
		});

		const { schema } = await findBuiltinSchemaBySlug(author.client, "workout");
		const workout = await createEntity(author.client, {
			entitySchemaId: schema.id,
			name: `Workout ${crypto.randomUUID()}`,
			properties: { endedAt: "2026-04-27T11:00:00Z", startedAt: "2026-04-27T10:00:00Z" },
		});

		const signal = await waitForActorSignal("workout.created", author.userId);
		expect(signal.actorUserId).toBe(author.userId);
		expect(signal.properties).toEqual({ workoutId: workout.id, workoutName: workout.name });
		expect(await countActorSignals({ slug: "workout.created", actorUserId: author.userId })).toBe(
			1,
		);
		expect(await queryRecipientUserIds(signal.id)).toEqual([author.userId]);

		const delivered = await waitForAppriseDelivery(`/notify/${authorKey}`);
		expect(delivered.body).toEqual({
			title: "Ryot",
			body: `Workout created: ${workout.name}`,
		});

		const succeededRuns = await pollUntil("workout.created signal run", async () => {
			const runs = await querySubscriptionRuns({ signalId: signal.id, status: "succeeded" });
			return runs.length > 0 ? runs : null;
		});
		expect(succeededRuns).toHaveLength(1);
		expect(succeededRuns[0]?.operation).toBe("signal");
		expect(succeededRuns[0]?.executionUserId).toBe(author.userId);
	});

	it("does not emit workout.created for entities created through the import pipeline", async () => {
		const importer = await createAuthenticatedClient();

		const { completedRun } = await runHevyImportFixture(importer.client, importer.cookies);
		expect(completedRun.status).toBe("completed");

		const { schema } = await findBuiltinSchemaBySlug(importer.client, "workout");
		await createEntity(importer.client, {
			entitySchemaId: schema.id,
			name: `Workout ${crypto.randomUUID()}`,
			properties: { endedAt: "2026-04-27T11:00:00Z", startedAt: "2026-04-27T10:00:00Z" },
		});
		await waitForActorSignal("workout.created", importer.userId);

		expect(await countActorSignals({ slug: "workout.created", actorUserId: importer.userId })).toBe(
			1,
		);
	});

	it("gives a freshly bootstrapped user zero actor signals and runs", async () => {
		const fresh = await createAuthenticatedClient();

		expect(await countActorSignals({ slug: "review.created", actorUserId: fresh.userId })).toBe(0);
		expect(await countActorSignals({ slug: "workout.created", actorUserId: fresh.userId })).toBe(0);
		expect(await querySubscriptionRuns({ executionUserId: fresh.userId })).toEqual([]);
	});
});
