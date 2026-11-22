import { describe, expect, it } from "bun:test";

import type { PluginIdentityReference } from "@ryot-app/contract/modules/plugins/references";
import { PluginId } from "@ryot-app/contract/schema/brands";
import {
	fixtureManifest,
	fixturePluginIdentity,
	testPluginPackageId,
} from "@ryot-app/contract/testing";
import { column, document, field, rows, schemaOwnerPredicate, table } from "@ryot-app/ryotql";
import { assert } from "@ryot-app/testing/assert";

import {
	buildValidatedDefinitionSnapshot,
	type DefinitionSetChange,
	type DefinitionSetPlugin,
	validateDefinitionSet,
} from "./definition-set";
import { kernelDefinitionSource } from "./kernel-definitions";
import { mergeManifestDefinitions } from "./source";

const entity = table("entity", "subject");
const unjoined = table("entity", "unjoined");

const plugin = (
	id: string,
	scope: "user" | "system",
	owner: PluginIdentityReference,
	valid: boolean,
): DefinitionSetPlugin => {
	const packageId = testPluginPackageId();
	return {
		id,
		scope,
		manifest: {
			...fixtureManifest(packageId),
			queries: {
				items: {
					title: "Items",
					description: "Owned entities",
					document: document({
						items: rows(entity, {
							limit: 10,
							maxLimit: 10,
							fields: [field("id", column(valid ? entity : unjoined, "id"))],
							where: schemaOwnerPredicate(entity, "entitySchemaPluginId", owner),
						}),
					}),
				},
			},
		},
	};
};

const validate = (plugins: readonly DefinitionSetPlugin[], change?: DefinitionSetChange) =>
	buildValidatedDefinitionSnapshot(
		mergeManifestDefinitions(kernelDefinitionSource(), plugins),
		plugins,
		change,
	);

const userInstall = (pluginId: string): DefinitionSetChange => ({
	scope: "user",
	pluginIds: new Set([pluginId]),
});

describe("definition set changes", () => {
	const self = { kind: "self" } as const;

	it("validates only the documents of the plugins a user install adds", () => {
		const existing = [plugin("system", "system", self, false), plugin("user", "user", self, false)];
		const candidate = plugin("candidate", "user", self, true);
		expect(() => validate([...existing, candidate])).toThrow("unjoined");
		expect(() => validate([...existing, candidate], userInstall("candidate"))).not.toThrow();
		expect(() =>
			validate([...existing, plugin("candidate", "user", self, false)], userInstall("candidate")),
		).toThrow("unjoined");
	});

	it("revalidates existing user documents that reference the added package", () => {
		const candidate = plugin("candidate", "user", self, true);
		const reference = {
			scope: "user",
			kind: "package",
			packageId: candidate.manifest.metadata.packageId,
		} as const;
		expect(() =>
			validate([plugin("user", "user", reference, true), candidate], userInstall("candidate")),
		).not.toThrow();
		expect(() =>
			validate([plugin("user", "user", reference, false), candidate], userInstall("candidate")),
		).toThrow("unjoined");
	});
});

const emptySource = {
	savedViews: [],
	entitySchemas: [],
	signalSchemas: [],
	calendarSources: [],
	relationshipSchemas: [],
};
const systemPlugin = (id: string) => {
	const packageId = testPluginPackageId();
	return {
		...fixturePluginIdentity("fixture", packageId),
		id,
		manifest: fixtureManifest(packageId),
	};
};

const ownedQuery = (pluginId: string) => ({
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

it("composes independent packages with identical metadata and local declarations", () => {
	const snapshot = validateDefinitionSet(emptySource, [systemPlugin("a"), systemPlugin("b")]);
	expect(Object.values(snapshot.entitySchemas).map(({ pluginId }) => pluginId)).toEqual(["a", "b"]);
	expect(Object.values(snapshot.relationshipSchemas).map(({ pluginId }) => pluginId)).toEqual([
		"a",
		"b",
	]);
});

it("rejects invalid entity merge identity properties", () => {
	const owner = systemPlugin("a");
	const entitySchema = owner.manifest.entitySchemas[0];
	assert(entitySchema);
	expect(() =>
		validateDefinitionSet(emptySource, [
			{
				...owner,
				manifest: {
					...owner.manifest,
					entitySchemas: [{ ...entitySchema, mergeIdentityProperties: ["missing"] }],
				},
			},
		]),
	).toThrow(/merge identity property 'missing' is not defined/);
});

it("keeps same-name kernel and plugin relationship declarations independent", () => {
	const snapshot = validateDefinitionSet(kernelDefinitionSource(), [systemPlugin("a")]);
	expect(
		Object.values(snapshot.relationshipSchemas).map(({ slug, pluginId }) => ({ slug, pluginId })),
	).toEqual([
		{ pluginId: "a", slug: "fixture-link" },
		{ pluginId: null, slug: "member-of" },
	]);
});

it("validates declared query owners against the complete ingestion authority", () => {
	const owner = systemPlugin("a");
	expect(() =>
		validateDefinitionSet(emptySource, [
			{ ...owner, manifest: { ...owner.manifest, queries: { items: ownedQuery("missing") } } },
		]),
	).toThrow(/unavailable owner/);
	expect(() =>
		validateDefinitionSet(emptySource, [
			{ ...owner, manifest: { ...owner.manifest, queries: { items: ownedQuery("a") } } },
		]),
	).not.toThrow();
	const privatePlugin = { ...systemPlugin("private"), scope: "user" as const };
	expect(() =>
		validateDefinitionSet(emptySource, [
			privatePlugin,
			{ ...owner, manifest: { ...owner.manifest, queries: { items: ownedQuery("private") } } },
		]),
	).toThrow(/unavailable owner/);
});
