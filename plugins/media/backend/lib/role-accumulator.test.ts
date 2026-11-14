import { describe, expect, it } from "bun:test";

import { createRoleAccumulator } from "./role-accumulator";

const entity = (
	role: string,
	relationshipProperties: {
		order?: number;
		isGuest?: boolean;
		character?: string;
		creditKinds?: string[];
		departments?: string[];
		isUncredited?: boolean;
	},
) => ({
	name: "Person",
	externalId: "1",
	providerSlug: "person.tmdb",
	relationshipProperties: { roles: [role], ...relationshipProperties },
});

describe("role accumulator", () => {
	it("merges credit metadata, minimum order, and known flags across duplicate contributions", () => {
		const related = createRoleAccumulator();
		related.add(
			entity("Actor", {
				order: 5,
				isGuest: true,
				character: "Hero",
				isUncredited: true,
				creditKinds: ["cast"],
				departments: ["Acting"],
			}),
		);
		related.add(
			entity("Actor", {
				order: 0,
				isGuest: false,
				isUncredited: false,
				character: "Villain",
				creditKinds: ["cast", "crew"],
				departments: ["Acting", "Production"],
			}),
		);
		related.add(entity("Director", {}));

		expect(related.entities).toEqual([
			{
				name: "Person",
				externalId: "1",
				providerSlug: "person.tmdb",
				relationshipProperties: {
					order: 0,
					isGuest: false,
					isUncredited: false,
					character: "Hero / Villain",
					roles: ["Actor", "Director"],
					creditKinds: ["cast", "crew"],
					departments: ["Acting", "Production"],
				},
			},
		]);
	});

	it("does not let unknown flags erase known values", () => {
		const related = createRoleAccumulator([
			entity("Actor", { isGuest: true, isUncredited: false }),
		]);
		related.add(entity("Director", {}));

		expect(related.entities[0]?.relationshipProperties).toEqual({
			isGuest: true,
			isUncredited: false,
			roles: ["Actor", "Director"],
		});
	});
});
