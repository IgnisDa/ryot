import { PluginId, PluginPackageId } from "@ryot-app/contract/schema/brands";
import { expect, it } from "vitest";

import type { ImportSourceItem } from "#/modules/imports/service";
import { importSourceEntry, importSourceKey } from "#/modules/imports/source-selection";
import { createIntegrationBody } from "#/modules/integrations/payload";
import {
	integrationProviderEntry,
	findOwnedIntegrationProvider,
} from "#/modules/integrations/provider-selection";
import type { IntegrationProviderItem } from "#/modules/integrations/service";

const source = (pluginId: string, packageId: PluginPackageId): ImportSourceItem => ({
	packageId,
	plan: null,
	slug: "common",
	name: "Whiskey",
	isStartable: true,
	pluginScope: "user",
	pluginSlug: "whiskey",
	workflowSlug: "import",
	readinessMetadata: null,
	inputSchema: { fields: {} },
	missingPluginConfigKeys: [],
	requiredPluginConfigKeys: [],
	pluginId: PluginId.make(pluginId),
	description: "Independent declaration",
	installationId: `${pluginId}-installation`,
	readiness: { plan: null, ready: true, blockReasons: [] },
	reference: { slug: "common", owner: { kind: "plugin", pluginId: PluginId.make(pluginId) } },
});

const provider = (pluginId: string, packageId: PluginPackageId): IntegrationProviderItem => ({
	packageId,
	plan: null,
	lot: "yank",
	slug: "common",
	name: "Whiskey",
	isCreatable: true,
	scriptSlug: "sync",
	pluginScope: "user",
	pluginSlug: "whiskey",
	requiresProKey: false,
	readinessMetadata: null,
	readinessConnections: [],
	commonSchema: { fields: {} },
	supportsOwnershipSync: false,
	settingsSchema: { fields: {} },
	pluginId: PluginId.make(pluginId),
	description: "Independent declaration",
	installationId: `${pluginId}-installation`,
	readiness: { plan: null, ready: true, blockReasons: [] },
	reference: { slug: "common", owner: { kind: "plugin", pluginId: PluginId.make(pluginId) } },
});

const leftPackage = PluginPackageId.make("570e77e1-e450-40ea-b1cb-6e2ae3223bb3");
const rightPackage = PluginPackageId.make("ff9c9ec6-5774-42ef-881b-dc6a84ad3ba6");

it("keeps same-name importer option values and groups owner-qualified", () => {
	const left = source("left-owner", leftPackage);
	const right = source("right-owner", rightPackage);
	expect(importSourceEntry(left).slug).toBe(importSourceKey(left));
	expect(importSourceEntry(left).slug).not.toBe(importSourceEntry(right).slug);
	expect(importSourceEntry(left).group.key).not.toBe(importSourceEntry(right).group.key);
	expect(importSourceEntry(left).group.heading).toContain("Private · 570e77e1");
});

it("selects and submits the exact integration owner despite equal provider slugs", () => {
	const left = provider("left-owner", leftPackage);
	const right = provider("right-owner", rightPackage);
	expect(integrationProviderEntry(left).slug).not.toBe(integrationProviderEntry(right).slug);
	expect(
		findOwnedIntegrationProvider([left, right], { provider: "common", pluginId: right.pluginId }),
	).toBe(right);
	expect(createIntegrationBody({ values: {}, provider: right }).provider).toEqual(right.reference);
});
