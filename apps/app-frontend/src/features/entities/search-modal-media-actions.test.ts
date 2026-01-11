import { describe, expect, it } from "bun:test";
import { dayjs } from "@ryot/ts-utils";
import { createEventSchemaFixture } from "~/features/test-fixtures";
import {
	createBacklogEventPayload,
	createLogEventPayload,
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
		expect(
			getMediaLifecycleUnavailableMessage(createLifecycleSchemas()),
		).toBeNull();
	});

	it("lists missing lifecycle schemas when any are absent", () => {
		const schemas = createLifecycleSchemas().filter(
			(schema) => schema.slug !== "review",
		);

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
		).toEqual([
			{ entityId: "entity-1", eventSchemaId: "backlog-id", properties: {} },
		]);
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
				completedOn: "",
				logDate: "started",
				entityId: "entity-1",
				eventSchemas: createLifecycleSchemas(),
			}),
		).toEqual([
			{
				entityId: "entity-1",
				eventSchemaId: "progress-id",
				properties: { progressPercent: 1 },
			},
		]);
	});

	it("maps custom timestamps to a complete event with ISO datetimes", () => {
		const payload = createLogEventPayload({
			logDate: "custom",
			entityId: "entity-1",
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
				eventSchemas: createLifecycleSchemas(),
			}),
		).toThrow("Completed on must be a valid date and time");
	});

	it("rejects custom completion when startedOn is after completedOn", () => {
		expect(() =>
			createLogEventPayload({
				logDate: "custom",
				entityId: "entity-1",
				startedOn: "2026-03-28T18:30",
				completedOn: "2026-03-27T18:30",
				eventSchemas: createLifecycleSchemas(),
			}),
		).toThrow("Started on must be before completed on");
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
		expect(
			getMediaDoneActionLabel("log", { logDate: "started", rateStars: 0 }),
		).toBe("Started");
		expect(
			getMediaDoneActionLabel("rate", { logDate: "now", rateStars: 5 }),
		).toBe("Rated 5/5");
	});
});
