import { assert, expect, it } from "vitest";

import { kernelDefinitionSource } from "#modules/definitions/kernel-source";

import { fixtureManifest, fixturePluginIdentity, testPluginPackageId } from "../test-support";
import { validateSystemPluginSet } from "./system-set";

const emptySource = {
	savedViews: [],
	entitySchemas: [],
	signalSchemas: [],
	relationshipSchemas: [],
};
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
				fields: { token: { label: "Token", description: "Token", type: "string" as const } },
			},
		},
	};
};

it("composes independent packages with identical metadata and local declarations", () => {
	const snapshot = validateSystemPluginSet(emptySource, [systemPlugin("a"), systemPlugin("b")]);
	expect(Object.values(snapshot.entitySchemas).map(({ pluginId }) => pluginId)).toEqual(["a", "b"]);
	expect(Object.values(snapshot.relationshipSchemas).map(({ pluginId }) => pluginId)).toEqual([
		"a",
		"b",
	]);
});

it("rejects two active system records claiming the same package identity", () => {
	const first = systemPlugin("a");
	expect(() => validateSystemPluginSet(emptySource, [first, { ...first, id: "b" }])).toThrow(
		/Duplicate package identity/,
	);
});

it("allows same-slug configuration fields in independent packages", () => {
	expect(() =>
		validateSystemPluginSet(emptySource, [withConfig("a"), withConfig("b")]),
	).not.toThrow();
});

it("rejects normalized configuration key collisions inside a package", () => {
	const plugin = systemPlugin("a");
	const field = { label: "Token", description: "Token", type: "string" as const };
	expect(() =>
		validateSystemPluginSet(emptySource, [
			{
				...plugin,
				manifest: {
					...plugin.manifest,
					configSchema: { fields: { api_token: field, "api-token": field } },
				},
			},
		]),
	).toThrow(/Duplicate plugin config environment variable/);
});

it("rejects invalid entity merge identity properties", () => {
	const plugin = systemPlugin("a");
	const entity = plugin.manifest.entitySchemas[0];
	assert(entity);
	expect(() =>
		validateSystemPluginSet(emptySource, [
			{
				...plugin,
				manifest: {
					...plugin.manifest,
					entitySchemas: [{ ...entity, mergeIdentityProperties: ["missing"] }],
				},
			},
		]),
	).toThrow(/merge identity property 'missing' is not defined/);
});

it("keeps same-name kernel and plugin relationship declarations independent", () => {
	const snapshot = validateSystemPluginSet(kernelDefinitionSource(), [systemPlugin("a")]);
	expect(
		Object.values(snapshot.relationshipSchemas).map(({ slug, pluginId }) => ({ slug, pluginId })),
	).toEqual([
		{ pluginId: "a", slug: "fixture-link" },
		{ pluginId: null, slug: "member-of" },
	]);
});
