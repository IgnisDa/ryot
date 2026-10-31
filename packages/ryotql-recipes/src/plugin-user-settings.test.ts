import { Result } from "effect";
import { expect, it } from "vitest";

import { pluginInstallationUserSettingsRecipe } from "./plugin-user-settings";
import { requireRowsQuery, rowsResponse } from "./test-utils";

const pageInfo = { limit: 1, hasMore: false, nextCursor: null };

it("selects at most one active installation of the named plugin", () => {
	const recipe = pluginInstallationUserSettingsRecipe({ pluginId: "plugin-a" });
	const query = requireRowsQuery(recipe.document.queries.installation);
	expect(query.where).toMatchObject({
		predicates: [
			{ left: { field: "pluginId" }, right: { value: "plugin-a" } },
			{ left: { field: "status" }, right: { value: "active" } },
		],
	});
	const row = {
		id: "installation-a",
		settings: { limit: 3 },
		settingsSchema: {
			unknownKeys: "strict",
			fields: { limit: { label: "Limit", type: "integer", description: "Limit" } },
		},
	};
	expect(Result.getOrThrow(recipe.decode(rowsResponse("installation", [row], pageInfo)))).toEqual(
		row,
	);
	expect(
		Result.getOrThrow(
			recipe.decode(
				rowsResponse("installation", [{ ...row, settings: {}, settingsSchema: null }], pageInfo),
			),
		),
	).toEqual({ ...row, settings: {}, settingsSchema: null });
	expect(Result.getOrThrow(recipe.decode(rowsResponse("installation", [], pageInfo)))).toBe(
		undefined,
	);
	expect(Result.isFailure(recipe.decode(rowsResponse("installation", [row, row], pageInfo)))).toBe(
		true,
	);
});
