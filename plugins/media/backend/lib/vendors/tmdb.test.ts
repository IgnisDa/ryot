import { describe, expect, it } from "vitest";

import { collectPeople } from "./tmdb";

describe("TMDB cast credits", () => {
	it("keeps distinct characters when cast and crew credits share a person", () => {
		expect(
			collectPeople(
				[
					{ id: 1, name: "Actor", character: " Hero " },
					{ id: 1, name: "Actor", character: "Villain" },
					{ id: 1, name: "Actor", character: "Hero" },
				],
				[{ id: 1, name: "Actor", job: "Director" }],
				[{ id: 1, name: "Actor" }],
			),
		).toEqual([
			{
				name: "Actor",
				externalId: "1",
				providerSlug: "person.tmdb",
				relationshipProperties: {
					character: "Hero / Villain",
					roles: ["Creator", "Acting", "Director"],
				},
			},
		]);
	});

	it("leaves unknown character names absent and does not read crew characters", () => {
		expect(
			collectPeople(
				[
					{ id: 1, name: "Actor", character: " " },
					{ id: 2, name: "Other Actor" },
				],
				[{ id: 3, job: "Director", name: "Director", character: "Not a cast credit" }],
			),
		).toEqual([
			{
				name: "Actor",
				externalId: "1",
				providerSlug: "person.tmdb",
				relationshipProperties: { roles: ["Acting"] },
			},
			{
				externalId: "2",
				name: "Other Actor",
				providerSlug: "person.tmdb",
				relationshipProperties: { roles: ["Acting"] },
			},
			{
				externalId: "3",
				name: "Director",
				providerSlug: "person.tmdb",
				relationshipProperties: { roles: ["Director"] },
			},
		]);
	});
});
