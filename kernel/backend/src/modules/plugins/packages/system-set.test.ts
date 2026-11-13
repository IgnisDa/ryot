import { expect, it } from "bun:test";

import { PluginId } from "@ryot-app/contract/schema/brands";
import {
	fixtureManifest,
	fixturePluginIdentity,
	testPluginPackageId,
} from "@ryot-app/contract/testing";
import { kernelDefinitionSource } from "@ryot-app/definitions/kernel-definitions";
import { column, document, field, rows, schemaOwnerPredicate, table } from "@ryot-app/ryotql";
import { assert } from "@ryot-app/testing/assert";

import { validateSystemPluginSet } from "./system-set";

const emptySource = {
	savedViews: [],
	entitySchemas: [],
	signalSchemas: [],
	calendarSources: [],
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
	const configField = { label: "Token", description: "Token", type: "string" as const };
	expect(() =>
		validateSystemPluginSet(emptySource, [
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

it("validates declared query owners against the complete ingestion authority", () => {
	const plugin = systemPlugin("a");
	const entity = table("entity", "subject");
	const declaration = (pluginId: string) => ({
		title: "Fixture query",
		description: "Owned entities",
		document: document({
			items: rows(entity, {
				limit: 10,
				maxLimit: 10,
				fields: [field("id", column(entity, "id"))],
				where: schemaOwnerPredicate(entity, "entitySchemaPluginId", {
					kind: "local",
					pluginId: PluginId.make(pluginId),
				}),
			}),
		}),
	});
	expect(() =>
		validateSystemPluginSet(emptySource, [
			{ ...plugin, manifest: { ...plugin.manifest, queries: { items: declaration("missing") } } },
		]),
	).toThrow(/unavailable owner/);
	expect(() =>
		validateSystemPluginSet(emptySource, [
			{ ...plugin, manifest: { ...plugin.manifest, queries: { items: declaration("a") } } },
		]),
	).not.toThrow();
	const privatePlugin = { ...systemPlugin("private"), scope: "user" as const };
	expect(() =>
		validateSystemPluginSet(emptySource, [
			privatePlugin,
			{ ...plugin, manifest: { ...plugin.manifest, queries: { items: declaration("private") } } },
		]),
	).toThrow(/unavailable owner/);
});
