import { describe, expect, it } from "bun:test";

import type { PluginIdentityReference } from "@ryot-app/contract/modules/plugins/references";
import { fixtureManifest, testPluginPackageId } from "@ryot-app/contract/testing";
import { column, document, field, rows, schemaOwnerPredicate, table } from "@ryot-app/ryotql";

import {
	buildValidatedDefinitionSnapshot,
	type DefinitionSetChange,
	type DefinitionSetPlugin,
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
