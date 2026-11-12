import { expect, test } from "bun:test";

import { backupRunRecipe, backupRunsRecipe } from "@ryot-app/ryotql-recipes/backups";
import {
	activeSignalSchemasRecipe,
	entityDefinitionsRecipe,
	relationshipDefinitionsRecipe,
} from "@ryot-app/ryotql-recipes/definitions";
import { importSourcesRecipe } from "@ryot-app/ryotql-recipes/import-sources";
import {
	instanceAdminUsersRecipe,
	migrationReportRecipe,
	userLifecycleOperationRecipe,
} from "@ryot-app/ryotql-recipes/instance-admin";
import { integrationProvidersRecipe } from "@ryot-app/ryotql-recipes/integration-providers";
import { integrationRecipe } from "@ryot-app/ryotql-recipes/integrations";
import { oauthConnectionStatusRecipe } from "@ryot-app/ryotql-recipes/oauth-connections";
import { pluginInstallationsRecipe } from "@ryot-app/ryotql-recipes/plugin-installations";
import { storedValidationBranches } from "@ryot-app/ryotql-recipes/stored-validation";
import { twoFactorStatusRecipe, userSettingsRecipe } from "@ryot-app/ryotql-recipes/user-settings";
import { Result } from "effect";

const userAccess = { type: "user", audience: "kernel", accessClass: "standard" } as const;
const adminAccess = { type: "admin" } as const;

const recipes = [
	["user settings", userSettingsRecipe.document, userAccess],
	["two-factor status", twoFactorStatusRecipe.document, userAccess],
	["OAuth connection status", oauthConnectionStatusRecipe.document, userAccess],
	["backup runs", backupRunsRecipe.document, userAccess],
	["backup run", backupRunRecipe.document, userAccess],
	["plugin installations", pluginInstallationsRecipe.document, userAccess],
	["entities", entityDefinitionsRecipe.document, userAccess],
	["relationships", relationshipDefinitionsRecipe.document, userAccess],
	["active signals", activeSignalSchemasRecipe.document, userAccess],
	["import sources", importSourcesRecipe.document, userAccess],
	["integration providers", integrationProvidersRecipe.document, userAccess],
	["integration detail", integrationRecipe.document, userAccess],
	["instance admin users", instanceAdminUsersRecipe.document, adminAccess],
	["migration report", migrationReportRecipe.document, adminAccess],
	["user lifecycle operation", userLifecycleOperationRecipe.document, adminAccess],
] as const;

test.each(recipes)(
	"validates %s against the real catalog in its scope",
	(_name, document, scope) => {
		expect(Result.isSuccess(storedValidationBranches(document, [], scope))).toBe(true);
	},
);
