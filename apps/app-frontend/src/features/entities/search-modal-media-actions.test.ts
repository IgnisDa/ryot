import { describe, expect, it } from "bun:test";

import { dayjs } from "@ryot/ts-utils";

import { createEventSchemaFixture } from "~/features/test-fixtures";

import {
	createBacklogEventPayload,
	createLogEventPayload,
	createProgressEventPayload,
	createReviewEventPayload,
	getMediaDoneActionLabel,
	getMediaLifecycleUnavailableMessage,
} from "./search-modal-media-actions";

function createLifecycleSchemas() {
	return [
		createEventSchemaFixture({ id: "backlog-id", slug: "backlog" }),
		createEventSchemaFixture({ id: "complete-id", slug: "complete" }),
		createEventSchemaFixture({ id: "progress-id", slug: "progress" }),
		createEventSchemaFixture({ id: "review-id", slug: "review" }),
	];
}

describe("getMediaLifecycleUnavailableMessage", () => {
	it("returns null when all lifecycle schemas exist", () => {
		expect(getMediaLifecycleUnavailableMessage(createLifecycleSchemas())).toBeNull();
	});

	it("lists missing lifecycle schemas when any are absent", () => {
		const schemas = createLifecycleSchemas().filter((schema) => schema.slug !== "review");

		expect(getMediaLifecycleUnavailableMessage(schemas)).toBe(
			"Some actions are unavailable. Please check your event schemas configuration.",
		);
	});
});

describe("createBacklogEventPayload", () => {
	it("creates a backlog event payload", () => {
		expect(
			createBacklogEventPayload({
				entityId: "entity-1",
				eventSchemas: createLifecycleSchemas(),
			}),
		).toEqual([{ entityId: "entity-1", eventSchemaId: "backlog-id", properties: {} }]);
	});
});

describe("createLogEventPayload", () => {
	it("maps just now to a complete event", () => {
		expect(
			createLogEventPayload({
				startedOn: "",
				logDate: "now",
				completedOn: "",
				entityId: "entity-1",
				entitySchemaSlug: "movie",
				eventSchemas: createLifecycleSchemas(),
			}),
		).toEqual([
			{
				entityId: "entity-1",
				eventSchemaId: "complete-id",
				properties: { completionMode: "just_now" },
			},
		]);
	});

	it("maps unknown to a complete event", () => {
		expect(
			createLogEventPayload({
				startedOn: "",
				completedOn: "",
				logDate: "unknown",
				entityId: "entity-1",
				entitySchemaSlug: "movie",
				eventSchemas: createLifecycleSchemas(),
			}),
		).toEqual([
			{
				entityId: "entity-1",
				eventSchemaId: "complete-id",
				properties: { completionMode: "unknown" },
			},
		]);
	});

	it("maps just started to a progress event", () => {
		expect(
			createLogEventPayload({
				startedOn: "",
				showSeason: 1,
				showEpisode: 2,
				completedOn: "",
				logDate: "started",
				entityId: "entity-1",
				entitySchemaSlug: "show",
				eventSchemas: createLifecycleSchemas(),
			}),
		).toEqual([
			{
				entityId: "entity-1",
				eventSchemaId: "progress-id",
				properties: { progressPercent: 1, showSeason: 1, showEpisode: 2 },
			},
		]);
	});

	it("maps episodic just now to a progress event with granular fields", () => {
		expect(
			createLogEventPayload({
				logDate: "now",
				startedOn: "",
				completedOn: "",
				podcastEpisode: 14,
				entityId: "entity-1",
				entitySchemaSlug: "podcast",
				eventSchemas: createLifecycleSchemas(),
			}),
		).toEqual([
			{
				entityId: "entity-1",
				eventSchemaId: "progress-id",
				properties: { progressPercent: 100, podcastEpisode: 14 },
			},
		]);
	});

	it("maps custom timestamps to a complete event with ISO datetimes", () => {
		const payload = createLogEventPayload({
			logDate: "custom",
			entityId: "entity-1",
			entitySchemaSlug: "movie",
			startedOn: "2026-03-27T09:15",
			completedOn: "2026-03-27T18:30",
			eventSchemas: createLifecycleSchemas(),
		});

		expect(payload).toHaveLength(1);
		expect(payload[0]?.eventSchemaId).toBe("complete-id");
		expect(payload[0]?.properties).toEqual({
			completionMode: "custom_timestamps",
			startedOn: dayjs("2026-03-27T09:15").toISOString(),
			completedOn: dayjs("2026-03-27T18:30").toISOString(),
		});
	});

	it("allows custom completion without startedOn", () => {
		expect(
			createLogEventPayload({
				startedOn: "",
				logDate: "custom",
				entityId: "entity-1",
				entitySchemaSlug: "movie",
				completedOn: "2026-03-27T18:30",
				eventSchemas: createLifecycleSchemas(),
			}),
		).toEqual([
			{
				entityId: "entity-1",
				eventSchemaId: "complete-id",
				properties: {
					completionMode: "custom_timestamps",
					completedOn: dayjs("2026-03-27T18:30").toISOString(),
				},
			},
		]);
	});

	it("rejects custom completion without completedOn", () => {
		expect(() =>
			createLogEventPayload({
				startedOn: "",
				completedOn: "",
				logDate: "custom",
				entityId: "entity-1",
				entitySchemaSlug: "movie",
				eventSchemas: createLifecycleSchemas(),
			}),
		).toThrow("Completed on must be a valid date and time");
	});

	it("rejects custom completion when startedOn is after completedOn", () => {
		expect(() =>
			createLogEventPayload({
				logDate: "custom",
				entityId: "entity-1",
				entitySchemaSlug: "movie",
				startedOn: "2026-03-28T18:30",
				completedOn: "2026-03-27T18:30",
				eventSchemas: createLifecycleSchemas(),
			}),
		).toThrow("Started on must be before completed on");
	});

	it("maps episodic custom timestamps to a progress event with granular fields", () => {
		expect(
			createLogEventPayload({
				mangaVolume: 8,
				logDate: "custom",
				mangaChapter: 42.5,
				entityId: "entity-1",
				entitySchemaSlug: "manga",
				startedOn: "2026-03-27T09:15",
				completedOn: "2026-03-27T18:30",
				eventSchemas: createLifecycleSchemas(),
			}),
		).toEqual([
			{
				entityId: "entity-1",
				eventSchemaId: "progress-id",
				properties: {
					mangaVolume: 8,
					mangaChapter: 42.5,
					progressPercent: 100,
				},
			},
		]);
	});
});

describe("createProgressEventPayload", () => {
	it("includes episodic progress fields when provided", () => {
		expect(
			createProgressEventPayload({
				showSeason: 1,
				showEpisode: 3,
				entityId: "entity-1",
				progressPercent: 25,
				eventSchemas: createLifecycleSchemas(),
			}),
		).toEqual([
			{
				entityId: "entity-1",
				eventSchemaId: "progress-id",
				properties: { progressPercent: 25, showSeason: 1, showEpisode: 3 },
			},
		]);
	});
});

describe("createReviewEventPayload", () => {
	it("creates a review event and trims blank review text", () => {
		expect(
			createReviewEventPayload({
				rating: 4,
				review: "  ",
				entityId: "entity-1",
				eventSchemas: createLifecycleSchemas(),
			}),
		).toEqual([
			{
				entityId: "entity-1",
				properties: { rating: 4 },
				eventSchemaId: "review-id",
			},
		]);
	});
});

describe("getMediaDoneActionLabel", () => {
	it("labels action badges for media search results", () => {
		expect(getMediaDoneActionLabel("track")).toBe("Added");
		expect(getMediaDoneActionLabel("log", { logDate: "started", rateStars: 0 })).toBe("Started");
		expect(getMediaDoneActionLabel("rate", { logDate: "now", rateStars: 5 })).toBe("Rated 5/5");
	});

	it("labels collection action as 'In collection'", () => {
		expect(getMediaDoneActionLabel("collection")).toBe("In collection");
	});
});
