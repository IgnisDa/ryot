import { expect, it } from "bun:test";

import { PluginId, PluginPackageId } from "@ryot-app/contract/schema/brands";
import { testFormatters } from "@ryot-app/kernel-messages/testing";

import {
	testMessage,
	testMessageCatalog,
	testTranslate,
} from "#/modules/i18n/provider.test-support";
import type { ImportSourceItem } from "#/modules/imports/service";
import { importSourceEntry, importSourceKey } from "#/modules/imports/source-selection";
import { createIntegrationBody } from "#/modules/integrations/payload";
import {
	findOwnedIntegrationProvider,
	integrationProviderEntry,
} from "#/modules/integrations/provider-selection";
import type { IntegrationProviderItem } from "#/modules/integrations/service";

const source = (pluginId: string, packageId: PluginPackageId): ImportSourceItem => ({
	packageId,
	plan: null,
	slug: "common",
	isStartable: true,
	pluginScope: "user",
	workflowSlug: "import",
	readinessMetadata: null,
	inputSchema: { fields: {} },
	missingPluginConfigKeys: [],
	name: testMessage("Whiskey"),
	requiredPluginConfigKeys: [],
	pluginId: PluginId.make(pluginId),
	installationId: `${pluginId}-installation`,
	description: testMessage("Independent declaration"),
	readiness: { plan: null, ready: true, blockReasons: [] },
	reference: { slug: "common", owner: { kind: "plugin", pluginId: PluginId.make(pluginId) } },
});

const provider = (pluginId: string, packageId: PluginPackageId): IntegrationProviderItem => ({
	packageId,
	plan: null,
	lot: "yank",
	slug: "common",
	hasScript: true,
	isCreatable: true,
	entitlement: null,
	scriptSlug: "sync",
	pluginScope: "user",
	readinessMetadata: null,
	readinessConnections: [],
	name: testMessage("Whiskey"),
	commonSchema: { fields: {} },
	settingsSchema: { fields: {} },
	pluginId: PluginId.make(pluginId),
	installationId: `${pluginId}-installation`,
	description: testMessage("Independent declaration"),
	readiness: { plan: null, ready: true, blockReasons: [] },
	reference: { slug: "common", owner: { kind: "plugin", pluginId: PluginId.make(pluginId) } },
});

const t = testTranslate([testMessageCatalog("Whiskey Tracker")]);
const pluginNames = new Map([["left-owner-installation", testMessage("Whiskey Tracker")]]);

const leftPackage = PluginPackageId.make("home/whiskey");
const rightPackage = PluginPackageId.make("acme/whiskey");

it("keeps same-name importer option values and groups owner-qualified", () => {
	const left = source("left-owner", leftPackage);
	const right = source("right-owner", rightPackage);
	expect(importSourceEntry(left, t, testFormatters, pluginNames).key).toBe(importSourceKey(left));
	expect(importSourceEntry(left, t, testFormatters, pluginNames).key).not.toBe(
		importSourceEntry(right, t, testFormatters, pluginNames).key,
	);
	expect(importSourceEntry(left, t, testFormatters, pluginNames).group.key).not.toBe(
		importSourceEntry(right, t, testFormatters, pluginNames).group.key,
	);
	expect<string>(importSourceEntry(left, t, testFormatters, pluginNames).group.heading).toBe(
		"Whiskey Tracker · Private · home/whiskey",
	);
	expect<string>(importSourceEntry(right, t, testFormatters, pluginNames).group.heading).toBe(
		"Other · Private · acme/whiskey",
	);
});

it("selects and submits the exact integration owner despite equal provider slugs", () => {
	const left = provider("left-owner", leftPackage);
	const right = provider("right-owner", rightPackage);
	expect(integrationProviderEntry(left, t, pluginNames).key).not.toBe(
		integrationProviderEntry(right, t, pluginNames).key,
	);
	expect(
		findOwnedIntegrationProvider([left, right], { provider: "common", pluginId: right.pluginId }),
	).toBe(right);
	expect(createIntegrationBody({ values: {}, provider: right }).provider).toEqual(right.reference);
});
