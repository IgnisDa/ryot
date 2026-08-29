import { expect, it } from "@effect/vitest";
import {
	automationHistoryRunRecipe,
	automationHistoryRunsRecipe,
} from "@ryot-app/ryotql-recipes/automation-history";
import { backupRunRecipe, backupRunsRecipe } from "@ryot-app/ryotql-recipes/backups";
import {
	activeSignalSchemasRecipe,
	entityDefinitionsRecipe,
	relationshipDefinitionsRecipe,
} from "@ryot-app/ryotql-recipes/definitions";
import {
	godModeUsersRecipe,
	migrationReportRecipe,
	userLifecycleOperationRecipe,
} from "@ryot-app/ryotql-recipes/god-mode";
import { importSourcesRecipe } from "@ryot-app/ryotql-recipes/import-sources";
import { integrationProvidersRecipe } from "@ryot-app/ryotql-recipes/integration-providers";
import { integrationRecipe } from "@ryot-app/ryotql-recipes/integrations";
import { pluginInstallationsRecipe } from "@ryot-app/ryotql-recipes/plugin-installations";
import { userSettingsRecipe } from "@ryot-app/ryotql-recipes/user-settings";

import { validateRyotQLDocument } from "./validator";

const page = { limit: 25 };
const userAccess = { type: "user", audience: "kernel", accessClass: "standard" } as const;
const adminAccess = { type: "admin" } as const;

const recipes = [
	["user settings", userSettingsRecipe().document, userAccess],
	["backup runs", backupRunsRecipe(page).document, userAccess],
	["backup run", backupRunRecipe({ id: "run" }).document, userAccess],
	["plugin installations", pluginInstallationsRecipe(page).document, userAccess],
	["entities", entityDefinitionsRecipe(page).document, userAccess],
	["relationships", relationshipDefinitionsRecipe(page).document, userAccess],
	["active signals", activeSignalSchemasRecipe(page).document, userAccess],
	["import sources", importSourcesRecipe(page).document, userAccess],
	["integration providers", integrationProvidersRecipe(page).document, userAccess],
	["integration detail", integrationRecipe({ id: "integration" }).document, userAccess],
	[
		"automation history",
		automationHistoryRunsRecipe({
			...page,
			stage: "after",
			status: "failed",
			hookSlug: "hook",
			pluginId: "plugin",
			triggerId: "trigger",
			to: "2026-02-01T00:00:00.000Z",
			from: "2026-01-01T00:00:00.000Z",
		}).document,
		userAccess,
	],
	["automation detail", automationHistoryRunRecipe({ id: "run" }).document, userAccess],
	["god mode users", godModeUsersRecipe({ ...page, search: "example" }).document, adminAccess],
	["migration report", migrationReportRecipe(page).document, adminAccess],
	[
		"user lifecycle operation",
		userLifecycleOperationRecipe({ id: "operation" }).document,
		adminAccess,
	],
] as const;

it.each(recipes)("validates %s against the real catalog in its scope", (_name, document, scope) => {
	expect(validateRyotQLDocument(document, scope)).toBeNull();
});
