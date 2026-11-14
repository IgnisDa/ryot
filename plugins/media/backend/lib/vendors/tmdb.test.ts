import { describe, expect, it } from "bun:test";

import { collectPeople } from "./tmdb";

describe("TMDB credits", () => {
	it("retains every cast member and uses explicit billing order", () => {
		const cast = Array.from({ length: 18 }, (_, index) => ({
			id: index + 1,
			known_for_department: "Acting",
			order: index === 17 ? 0 : index + 1,
			name: index === 17 ? "Nicole Kidman" : `Actor ${index + 1}`,
			character: index === 17 ? "Character 18 (UNcredited)" : `Character ${index + 1}`,
		}));

		const people = collectPeople(cast, []);
		expect(people).toHaveLength(18);
		expect(people.at(-1)).toEqual({
			externalId: "18",
			name: "Nicole Kidman",
			providerSlug: "person.tmdb",
			relationshipProperties: {
				order: 0,
				isGuest: false,
				roles: ["Acting"],
				isUncredited: true,
				creditKinds: ["cast"],
				departments: ["Acting"],
				character: "Character 18 (UNcredited)",
			},
		});
	});

	it("retains crew entries with missing jobs as Crew and keeps every nonempty job", () => {
		expect(
			collectPeople(
				[],
				[
					{ id: 1, name: "Executive", department: "Production", job: "Executive Producer" },
					{ id: 2, name: "Grip", job: "Key Grip", department: "Crew" },
					{ id: 3, name: "No Job", department: "Camera" },
				],
			),
		).toEqual([
			{
				externalId: "1",
				name: "Executive",
				providerSlug: "person.tmdb",
				relationshipProperties: {
					creditKinds: ["crew"],
					departments: ["Production"],
					roles: ["Executive Producer"],
				},
			},
			{
				name: "Grip",
				externalId: "2",
				providerSlug: "person.tmdb",
				relationshipProperties: {
					roles: ["Key Grip"],
					creditKinds: ["crew"],
					departments: ["Crew"],
				},
			},
			{
				name: "No Job",
				externalId: "3",
				providerSlug: "person.tmdb",
				relationshipProperties: { roles: ["Crew"], creditKinds: ["crew"], departments: ["Camera"] },
			},
		]);
	});

	it("classifies cast as Acting instead of using a person's career department", () => {
		expect(
			collectPeople(
				[
					{
						id: 1,
						order: 0,
						character: "Hero",
						name: "Director Actor",
						known_for_department: "Directing",
					},
				],
				[{ id: 1, job: "Director", name: "Director Actor", department: "Directing" }],
			),
		).toEqual([
			{
				externalId: "1",
				name: "Director Actor",
				providerSlug: "person.tmdb",
				relationshipProperties: {
					order: 0,
					isGuest: false,
					character: "Hero",
					isUncredited: false,
					roles: ["Acting", "Director"],
					creditKinds: ["cast", "crew"],
					departments: ["Acting", "Directing"],
				},
			},
		]);
	});

	it("merges duplicate cast, crew, and creator metadata without losing characters", () => {
		expect(
			collectPeople(
				[
					{
						id: 1,
						order: 8,
						name: "Actor",
						known_for_department: "Acting",
						character: "Hero (Uncredited)",
					},
					{ id: 1, order: 0, name: "Actor", character: "Villain", known_for_department: "Acting" },
				],
				[{ id: 1, name: "Actor", department: "Production", job: "Executive Producer" }],
				[{ id: 1, name: "Actor" }],
			),
		).toEqual([
			{
				name: "Actor",
				externalId: "1",
				providerSlug: "person.tmdb",
				relationshipProperties: {
					order: 0,
					isGuest: false,
					isUncredited: false,
					creditKinds: ["crew", "cast"],
					departments: ["Acting", "Production"],
					character: "Hero (Uncredited) / Villain",
					roles: ["Creator", "Acting", "Executive Producer"],
				},
			},
		]);
	});

	it("retains multiple aggregate roles and jobs without inferring guest status from a small count", () => {
		const people = collectPeople(
			[
				{
					id: 1,
					order: 4,
					name: "Older Credit",
					total_episode_count: 12,
					known_for_department: "Acting",
					roles: [
						{ episode_count: 10, character: "Older Role" },
						{ episode_count: 2, character: "Guest Role" },
					],
				},
				{
					id: 2,
					order: 5,
					name: "Guest",
					total_episode_count: 2,
					known_for_department: "Acting",
					roles: [{ episode_count: 2, character: "Guest Star" }],
				},
				{
					id: 3,
					name: "Regular",
					total_episode_count: 1,
					known_for_department: "Acting",
					roles: [{ character: "Regular" }],
				},
			],
			[
				{
					id: 4,
					name: "Crew",
					department: "Production",
					jobs: [
						{ episode_count: 1, job: "Executive Producer" },
						{ job: "Producer", episode_count: 3 },
					],
				},
			],
			[],
			{
				currentRegularCast: new Set(["3"]),
				guestStarAppearances: new Map([
					["1", 2],
					["2", 2],
					["3", 1],
				]),
			},
		);

		expect(people).toEqual([
			{
				externalId: "1",
				name: "Older Credit",
				providerSlug: "person.tmdb",
				relationshipProperties: {
					order: 4,
					roles: ["Acting"],
					isUncredited: false,
					creditKinds: ["cast"],
					departments: ["Acting"],
					character: "Older Role / Guest Role",
				},
			},
			{
				name: "Guest",
				externalId: "2",
				providerSlug: "person.tmdb",
				relationshipProperties: {
					order: 5,
					isGuest: true,
					roles: ["Acting"],
					isUncredited: false,
					creditKinds: ["cast"],
					character: "Guest Star",
					departments: ["Acting"],
				},
			},
			{
				name: "Regular",
				externalId: "3",
				providerSlug: "person.tmdb",
				relationshipProperties: {
					order: 2,
					isGuest: false,
					roles: ["Acting"],
					isUncredited: false,
					character: "Regular",
					creditKinds: ["cast"],
					departments: ["Acting"],
				},
			},
			{
				name: "Crew",
				externalId: "4",
				providerSlug: "person.tmdb",
				relationshipProperties: {
					creditKinds: ["crew"],
					departments: ["Production"],
					roles: ["Executive Producer", "Producer"],
				},
			},
		]);
	});
});
