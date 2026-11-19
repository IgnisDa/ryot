import { expect, it } from "bun:test";

import { Result } from "effect";

import { pluginInstallationUserSettingsRecipe } from "./plugin-user-settings";
import { bindRecipe, requireRowsQuery, rowsResponse } from "./test-utils";

const pageInfo = { limit: 1, hasMore: false, nextCursor: null };

it("selects at most one active installation of the named plugin", () => {
	const recipe = bindRecipe(pluginInstallationUserSettingsRecipe, { pluginId: "plugin-a" });
	const query = requireRowsQuery(recipe.document.queries.installation);
	expect(query.where).toMatchObject({
		predicates: [
			{ left: { field: "pluginId" }, right: { value: "plugin-a" } },
			{ left: { field: "status" }, right: { value: "active" } },
		],
	});
	const limit = { type: "integer", description: "Limit" } as const;
	const row = {
		id: "installation-a",
		pluginId: "plugin-a",
		settings: { limit: 3 },
		settingsSchema: {
			unknownKeys: "strict",
			fields: { limit: { ...limit, label: { key: "test.limit" } } },
		},
	};
	expect(
		Result.getOrThrow(recipe.decode(rowsResponse("installation", [row], pageInfo))),
	).toEqual<unknown>({
		id: row.id,
		settings: row.settings,
		settingsSchema: {
			unknownKeys: "strict",
			fields: { limit: { ...limit, label: { key: "test.limit", namespace: "plugin-a" } } },
		},
	});
	expect(
		Result.getOrThrow(
			recipe.decode(
				rowsResponse("installation", [{ ...row, settings: {}, settingsSchema: null }], pageInfo),
			),
		),
	).toEqual({ id: row.id, settings: {}, settingsSchema: null });
	expect(Result.getOrThrow(recipe.decode(rowsResponse("installation", [], pageInfo)))).toBe(
		undefined,
	);
	expect(Result.isFailure(recipe.decode(rowsResponse("installation", [row, row], pageInfo)))).toBe(
		true,
	);
});
