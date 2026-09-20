import { Result } from "effect";
import { expect, it } from "vitest";

import { pluginInstallationsRecipe } from "./plugin-installations";
import { requireRowsQuery, rowsResponse } from "./test-utils";

it("keeps quarantined ownership, workspace association, and initialization separate in management", () => {
	const privateInstallation = {
		config: {},
		sortOrder: 0,
		scope: "user",
		icon: "puzzle",
		isHidden: true,
		name: "Shared",
		version: "1.0.0",
		isInitialized: false,
		configuredSecrets: [],
		health: "incompatible",
		packageId: "ryot/media",
		pluginId: "private-owner",
		sourceHash: "private-source",
		activationId: "private-activation",
		activeRevisionId: "private-revision",
		description: "Shared display metadata",
		installationId: "private-installation",
		incompatibilityReason: "package-identity-conflict",
		configSchema: { fields: {}, unknownKeys: "strict" },
		healthReason: "A system package claims this identity",
		homeSavedView: { kind: "plugin", slug: "all-items", pluginId: "private-owner" },
	};
	const systemInstallation = {
		...privateInstallation,
		health: "ready",
		isHidden: false,
		scope: "system",
		healthReason: null,
		homeSavedView: null,
		isInitialized: true,
		pluginId: "system-owner",
		incompatibilityReason: null,
		sourceHash: "system-source",
		activationId: "system-activation",
		activeRevisionId: "system-revision",
		installationId: "system-installation",
	};
	const recipe = pluginInstallationsRecipe({ limit: 4, after: "cursor" });
	const query = requireRowsQuery(recipe.document.queries.installations);
	expect(query.where).toMatchObject({
		predicates: [
			{ left: { field: "status" }, right: { value: "active" } },
			{ type: "isNotNull", expr: { field: "activeRevisionId" } },
		],
	});
	const pageInfo = { limit: 4, hasMore: false, nextCursor: null };
	expect(
		Result.getOrThrow(
			recipe.decode(
				rowsResponse("installations", [privateInstallation, systemInstallation], pageInfo),
			),
		),
	).toEqual({ pageInfo, items: [privateInstallation, systemInstallation] });
});
