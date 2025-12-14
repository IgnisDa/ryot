import { describe, expect, it } from "vitest";

import { runBuiltinScript as runScript } from "../triggers/test-utils";
import mediaEntityChangedCode from "./media-entity-changed.sandbox.js" with { type: "text" };
import mediaRelationshipChangedCode from "./media-relationship-changed.sandbox.js" with { type: "text" };
import reviewCreatedCode from "./review-created.sandbox.js" with { type: "text" };
import sendSignalNotificationCode from "./send-signal-notification.sandbox.js" with { type: "text" };
import workoutCreatedCode from "./workout-created.sandbox.js" with { type: "text" };

describe("built-in notification automations", () => {
	it("emits fractional manga content-count changes", () => {
		const calls: unknown[] = [];
		return runScript(
			mediaEntityChangedCode,
			{
				rule: { metadata: { signals: { contentCount: "content-count-signal" } } },
				automation: {
					operation: "update",
					rootPreviouslyPopulated: true,
					scopeEntity: { id: "manga-1", name: "Manga" },
					source: {
						kind: "entity",
						after: { entitySchemaSlug: "manga", properties: { chapters: 101.5 } },
						before: { entitySchemaSlug: "manga", properties: { chapters: 100.5 } },
					},
				},
			},
			{
				emitSignal: (payload) => {
					calls.push(payload);
					return { success: true, data: {} };
				},
			},
		).then(() => {
			expect(calls).toEqual([
				{
					effectKey: "content-count",
					subjectEntityId: "manga-1",
					signalSchemaId: "content-count-signal",
					properties: {
						oldCount: 100.5,
						newCount: 101.5,
						entityName: "Manga",
						contentType: "chapters",
					},
				},
			]);
			return undefined;
		});
	});

	it("emits independent hierarchical media signals while preserving initial and Specials suppression", () => {
		const calls: unknown[] = [];
		const context = {
			rule: {
				metadata: {
					signals: {
						status: "status",
						episodeName: "name",
						contentCount: "count",
						releaseDate: "release",
						episodeImages: "images",
					},
				},
			},
			automation: {
				operation: "update",
				rootPreviouslyPopulated: true,
				owningSeason: { name: "Season 1", number: 1 },
				scopeEntity: { id: "show-1", name: "The Show" },
				source: {
					kind: "entity",
					before: {
						name: "Old title",
						entitySchemaSlug: "show-episode",
						properties: {
							episodeNumber: 2,
							publishDate: "2026-01-01",
							images: [{ url: "a" }, { url: "a" }, { url: "b" }],
						},
					},
					after: {
						name: "New title",
						entitySchemaSlug: "show-episode",
						properties: {
							episodeNumber: 2,
							publishDate: "2026-02-01",
							images: [{ url: "b" }, { url: "a" }],
						},
					},
				},
			},
		};
		const emitSignal = (payload: unknown) => {
			calls.push(payload);
			return { success: true, data: {} };
		};
		return runScript(mediaEntityChangedCode, context, { emitSignal })
			.then(() => {
				expect(calls).toEqual([
					expect.objectContaining({ signalSchemaId: "name", effectKey: "episode-name" }),
					expect.objectContaining({ signalSchemaId: "release", effectKey: "episode-date" }),
				]);
				return runScript(
					mediaEntityChangedCode,
					{
						...context,
						automation: { ...context.automation, rootPreviouslyPopulated: false },
					},
					{ emitSignal },
				);
			})
			.then(() =>
				runScript(
					mediaEntityChangedCode,
					{
						...context,
						automation: { ...context.automation, owningSeason: { name: "Specials", number: 0 } },
					},
					{ emitSignal },
				),
			)
			.then(() => {
				expect(calls).toHaveLength(2);
				return undefined;
			});
	});

	it("emits aggregate relationship signals and only newly added association roles", () => {
		const calls: unknown[] = [];
		const emitSignal = (payload: unknown) => {
			calls.push(payload);
			return { success: true, data: {} };
		};
		return runScript(
			mediaRelationshipChangedCode,
			{
				rule: { metadata: { detector: "episode-discovery", signalSchemaId: "discovery" } },
				automation: {
					operation: "create",
					rootPreviouslyPopulated: true,
					source: { kind: "relationship" },
					scopeEntity: { id: "show", name: "The Show" },
					owningSeason: { name: "Season 2", number: 2 },
					batch: {
						oldCount: 3,
						newCount: 5,
						afterCount: 5,
						beforeCount: 3,
						isLeader: true,
						createdCount: 2,
					},
				},
			},
			{ emitSignal },
		)
			.then(() =>
				runScript(
					mediaRelationshipChangedCode,
					{
						rule: { metadata: { detector: "association", signalSchemaId: "association" } },
						automation: {
							operation: "update",
							rootPreviouslyPopulated: true,
							scopeEntity: { id: "movie", name: "Movie" },
							source: {
								kind: "relationship",
								before: { properties: { roles: ["Actor"] } },
								after: {
									source: { id: "person", name: "Person" },
									target: { id: "movie", name: "Movie" },
									properties: { roles: ["Actor", "Director", "Director"] },
								},
							},
						},
					},
					{ emitSignal },
				),
			)
			.then(() => {
				expect(calls).toEqual([
					expect.objectContaining({
						signalSchemaId: "discovery",
						properties: expect.objectContaining({ discoveredCount: 2, seasonNumber: 2 }),
					}),
					expect.objectContaining({
						signalSchemaId: "association",
						properties: { role: "Director", subjectName: "Person", associatedName: "Movie" },
					}),
				]);
				return undefined;
			});
	});
	it("emits a review signal only for API-created reviews", () => {
		const calls: unknown[] = [];
		const context = {
			rule: { metadata: { signalSchemaId: "review-signal" } },
			automation: {
				origin: { kind: "api" },
				source: {
					kind: "event",
					after: {
						id: "review-1",
						entityId: "entity-1",
						entityName: "The Book",
						entitySchemaSlug: "book",
					},
				},
			},
		};
		return runScript(reviewCreatedCode, context, {
			emitSignal: (payload) => {
				calls.push(payload);
				return { success: true, data: {} };
			},
		})
			.then(() => {
				expect(calls).toEqual([
					{
						signalSchemaId: "review-signal",
						effectKey: "review-created:review-1",
						properties: {
							entityId: "entity-1",
							entityName: "The Book",
							entitySchemaSlug: "book",
							reviewEventId: "review-1",
						},
					},
				]);
				return Promise.all(
					[
						"import",
						"integration",
						"collection",
						"provider_refresh",
						"automation",
						"bootstrap",
					].map((kind) =>
						runScript(
							reviewCreatedCode,
							{ ...context, automation: { ...context.automation, origin: { kind } } },
							{ emitSignal: () => calls.push("unexpected") },
						),
					),
				);
			})
			.then(() => {
				expect(calls).toHaveLength(1);
				return undefined;
			});
	});

	it("emits a workout signal only for API-created workouts", () => {
		const calls: unknown[] = [];
		return runScript(
			workoutCreatedCode,
			{
				rule: { metadata: { signalSchemaId: "workout-signal" } },
				automation: {
					origin: { kind: "api" },
					source: { kind: "entity", after: { id: "workout-1", name: "Push Day" } },
				},
			},
			{
				emitSignal: (payload) => {
					calls.push(payload);
					return { success: true, data: {} };
				},
			},
		).then(() => {
			expect(calls).toEqual([
				{
					signalSchemaId: "workout-signal",
					effectKey: "workout-created:workout-1",
					properties: { workoutId: "workout-1", workoutName: "Push Day" },
				},
			]);
			return Promise.all(
				["import", "integration", "collection", "provider_refresh", "automation", "bootstrap"].map(
					(kind) =>
						runScript(
							workoutCreatedCode,
							{
								rule: { metadata: { signalSchemaId: "workout-signal" } },
								automation: {
									origin: { kind },
									source: { kind: "entity", after: { id: "workout-2", name: "Pull Day" } },
								},
							},
							{ emitSignal: () => calls.push("unexpected") },
						),
				),
			).then(() => {
				expect(calls).toHaveLength(1);
				return undefined;
			});
		});
	});

	it("formats notification messages only from the stored signal snapshot", () => {
		const calls: unknown[] = [];
		return runScript(
			sendSignalNotificationCode,
			{
				automation: {
					source: {
						kind: "signal",
						signal: {
							id: "signal-1",
							schema: { slug: "workout.created" },
							properties: { workoutName: "Push Day" },
						},
					},
				},
			},
			{
				sendNotification: (payload) => {
					calls.push(payload);
					return { success: true, data: { executionId: "delivery-1" } };
				},
			},
		).then(() => {
			expect(calls).toEqual([
				{ message: "Workout created: Push Day", effectKey: "notification:signal-1" },
			]);
			return undefined;
		});
	});

	it("formats integration-disabled messages from the signal snapshot", () => {
		const calls: unknown[] = [];
		return runScript(
			sendSignalNotificationCode,
			{
				automation: {
					source: {
						kind: "signal",
						signal: {
							id: "signal-2",
							properties: { providerName: "komga" },
							schema: { slug: "integration.disabled" },
						},
					},
				},
			},
			{
				sendNotification: (payload) => {
					calls.push(payload);
					return { success: true, data: {} };
				},
			},
		).then(() => {
			expect(calls).toEqual([
				{
					effectKey: "notification:signal-2",
					message: "Integration komga has been disabled due to too many errors",
				},
			]);
			return undefined;
		});
	});
});
