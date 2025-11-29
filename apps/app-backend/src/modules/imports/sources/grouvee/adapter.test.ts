import { describe, expect, it } from "bun:test";

import { adaptGrouveeCsv } from "./adapter";

const GROUVEE_HEADERS = "id,name,dates,shelves,statuses,review,rating,giantbomb_id";

describe("adaptGrouveeCsv", () => {
	it("maps gameplay history, status reviews, ratings, and custom shelves", () => {
		const csv = [
			GROUVEE_HEADERS,
			'1,Outer Wilds,"[{""date_started"":""2026-01-01"",""date_finished"":""2026-01-03""}]","{""Played"":{},""Backlog Buddies"":{}}","[{""date"":""2026-01-02"",""status"":""Excellent atmosphere""}]",Loved it,4,111',
		].join("\n");

		const result = adaptGrouveeCsv(csv);

		expect(result.failures).toEqual([]);
		expect(result.entityGroups).toEqual([
			{
				itemIndex: 0,
				collectionMemberships: [{ collectionName: "Backlog Buddies" }],
				entityRef: {
					kind: "resolved",
					externalId: "3030-111",
					sourceLabel: "Outer Wilds",
					entitySchemaSlug: "video-game",
					scriptSlug: "video-game.giant-bomb",
				},
				events: [
					{
						eventSchemaSlug: "review",
						occurredAt: "2026-01-02T00:00:00.000Z",
						properties: { text: "Excellent atmosphere" },
					},
					{
						eventSchemaSlug: "review",
						occurredAt: "2026-01-02T00:00:00.000Z",
						properties: { rating: 80, text: "Loved it" },
					},
					{
						eventSchemaSlug: "complete",
						occurredAt: "2026-01-03T00:00:00.000Z",
						properties: {
							completionMode: "custom_timestamps",
							startedOn: "2026-01-01T00:00:00.000Z",
							completedOn: "2026-01-03T00:00:00.000Z",
						},
					},
				],
			},
		]);
	});

	it("maps lifecycle shelves to events and leaves other shelves as collections", () => {
		const csv = [
			GROUVEE_HEADERS,
			'2,Persona 5,[],"{""Playing"":{},""JRPG Club"":{}}",[],,,222',
		].join("\n");

		const result = adaptGrouveeCsv(csv);

		expect(result.failures).toEqual([]);
		expect(result.entityGroups[0]).toMatchObject({
			collectionMemberships: [{ collectionName: "JRPG Club" }],
			events: [{ eventSchemaSlug: "progress", properties: { progressPercent: 1 } }],
		});
	});

	it("does not turn playtime-only history into a complete event", () => {
		const csv = [
			GROUVEE_HEADERS,
			'2,Returnal,"[{""date_started"":""2026-01-01"",""seconds_played"":3600}]","{""Playing"":{}}",[],,,222',
		].join("\n");

		const result = adaptGrouveeCsv(csv);

		expect(result.failures).toEqual([]);
		expect(result.entityGroups[0]?.events).toHaveLength(1);
		expect(result.entityGroups[0]?.events[0]).toMatchObject({
			eventSchemaSlug: "progress",
			properties: { progressPercent: 1 },
		});
	});

	it("records malformed rows without a GiantBomb id", () => {
		const csv = [GROUVEE_HEADERS, "3,Broken Game,[],{},[],,,"].join("\n");

		const result = adaptGrouveeCsv(csv);

		expect(result.entityGroups).toEqual([]);
		expect(result.failures).toEqual([
			{ itemIndex: 0, sourceLabel: "Broken Game", message: "giantbomb_id is empty" },
		]);
	});
});
