import { expect, it } from "bun:test";

import {
	fixtureManifest,
	fixturePluginIdentity,
	testPluginPackageId,
} from "@ryot-app/contract/testing";

import { validateSystemPluginDeployment } from "./system-set";

const systemPlugin = (id: string) => {
	const packageId = testPluginPackageId();
	const manifest = fixtureManifest(packageId);
	return { ...fixturePluginIdentity("fixture", packageId), id, manifest };
};

const withConfig = (id: string) => {
	const plugin = systemPlugin(id);
	return {
		...plugin,
		manifest: {
			...plugin.manifest,
			configSchema: {
				fields: {
					token: { description: "Token", type: "string" as const, label: { key: "test.token" } },
				},
			},
		},
	};
};

it("rejects two active system records claiming the same package identity", () => {
	const first = systemPlugin("a");
	expect(() => validateSystemPluginDeployment([first, { ...first, id: "b" }])).toThrow(
		/Duplicate package identity/,
	);
});

it("allows same-slug configuration fields in independent packages", () => {
	expect(() => validateSystemPluginDeployment([withConfig("a"), withConfig("b")])).not.toThrow();
});

it("rejects normalized configuration key collisions inside a package", () => {
	const plugin = systemPlugin("a");
	const configField = {
		description: "Token",
		type: "string" as const,
		label: { key: "test.token" },
	};
	expect(() =>
		validateSystemPluginDeployment([
			{
				...plugin,
				manifest: {
					...plugin.manifest,
					configSchema: { fields: { api_token: configField, "api-token": configField } },
				},
			},
		]),
	).toThrow(/Duplicate plugin config environment variable/);
});
