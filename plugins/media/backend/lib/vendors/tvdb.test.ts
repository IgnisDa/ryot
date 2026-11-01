import { describe, expect, it } from "vitest";

import { collectPeople } from "./tvdb";

describe("TVDB people credits", () => {
	it("keeps every person, classifies only known people types, and preserves explicit sort", () => {
		const characters = Array.from({ length: 23 }, (_, index) =>
			index === 22
				? {
						order: 2,
						peopleId: 23,
						personName: "Last person",
						name: "Character (UNcredited)",
						peopleType: "Unknown credit kind",
					}
				: {
						peopleId: index + 1,
						peopleType: "Actor",
						name: `Role ${index + 1}`,
						personName: `Person ${index + 1}`,
						...(index === 0 ? { sort: 0 } : {}),
					},
		);

		const people = collectPeople(characters);
		expect(people).toHaveLength(23);
		expect(people[0]?.relationshipProperties).toEqual({
			order: 0,
			roles: ["Actor"],
			character: "Role 1",
			isUncredited: false,
			creditKinds: ["cast"],
		});
		expect(people[22]?.relationshipProperties).toEqual({
			order: 2,
			isUncredited: true,
			roles: ["Unknown credit kind"],
			character: "Character (UNcredited)",
		});
	});

	it("merges duplicate cast and crew classifications and retains departments and guest metadata", () => {
		expect(
			collectPeople([
				{
					sort: 4,
					peopleId: 1,
					isGuest: true,
					peopleType: "Actor",
					personName: "Person",
					department: "Acting",
					name: "Hero (Uncredited)",
				},
				{
					order: 1,
					peopleId: 1,
					name: "Hero",
					isGuest: false,
					personName: "Person",
					peopleType: "Director",
					department: "Directing",
				},
			]),
		).toEqual([
			{
				name: "Person",
				externalId: "1",
				providerSlug: "person.tvdb",
				relationshipProperties: {
					order: 1,
					isGuest: false,
					isUncredited: true,
					roles: ["Actor", "Director"],
					creditKinds: ["cast", "crew"],
					departments: ["Acting", "Directing"],
					character: "Hero (Uncredited) / Hero",
				},
			},
		]);
	});

	it("derives guest status from guest-star roles and limits uncredited-name fallback to non-crew credits", () => {
		const people = collectPeople([
			{ peopleId: 1, personName: "Guest", peopleType: " Guest Star " },
			{ peopleId: 2, isGuest: false, peopleType: "guest star", personName: "Explicit non-guest" },
			{ peopleId: 3, name: "Hero", personName: "Actor", peopleType: "Actor" },
			{
				peopleId: 4,
				personName: "Director",
				peopleType: "Director",
				name: "Director (Uncredited)",
			},
		]);

		expect(people.map(({ relationshipProperties }) => relationshipProperties)).toEqual([
			{ isGuest: true, creditKinds: ["cast"], roles: ["Guest Star"] },
			{ isGuest: false, roles: ["guest star"], creditKinds: ["cast"] },
			{ roles: ["Actor"], character: "Hero", isUncredited: false, creditKinds: ["cast"] },
			{ roles: ["Director"], creditKinds: ["crew"], character: "Director (Uncredited)" },
		]);
	});
});
