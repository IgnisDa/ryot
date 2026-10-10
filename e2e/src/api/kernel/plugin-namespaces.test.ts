import { writePluginArchive } from "@ryot-app/plugin-archive";
import { importSourcesRecipe } from "@ryot-app/ryotql-recipes/import-sources";
import { integrationProvidersRecipe } from "@ryot-app/ryotql-recipes/integration-providers";
import { Effect, Schema } from "effect";
import { unzipSync, zipSync } from "fflate";

import {
	createAuthenticatedClient,
	collectRyotQLRecipeItems,
	executeRyotQLRecipe,
	executeRyotQLError,
	installNamespacePackage,
	installPrivatePluginPackage,
	invokeNamespaceOperation,
	listNamespaceInstallations,
	namespaceBottlesRecipe,
	namespaceInstallation,
	namespacePairRecipe,
	pluginNamespacePackages,
	testPluginPackageId,
	updateNamespacePackage,
	uploadTemporaryArchive,
} from "~/fixtures/kernel";
import { compilePluginPackage } from "~/fixtures/kernel/compiled-package";
import { assertTaggedError } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

describe("plugin namespaces", () => {
	it.live(
		"reports missing, wrong-scope and unbound owners without substituting another package",
		() =>
			Effect.gen(function* () {
				const { client } = yield* createAuthenticatedClient();
				const { a } = pluginNamespacePackages();
				yield* installNamespacePackage(client, a);
				const cases = [
					[{ kind: "self" }, "self-unbound"],
					[
						{ kind: "package", scope: "system", packageId: a.manifest.metadata.packageId },
						"wrong-scope",
					],
					[{ scope: "user", kind: "package", packageId: testPluginPackageId() }, "missing"],
				] as const;
				for (const [reference, issue] of cases) {
					const failure = yield* executeRyotQLError(
						client,
						namespaceBottlesRecipe({ reference }).document,
					);
					assertTaggedError(failure, "RyotQLBadRequest");
					expect(failure.reason).toEqual({ issue, reference, code: "unresolved-query-owner" });
				}
			}),
	);
	it.live(
		"rejects missing, malformed, nil, and noncanonical package UUIDs before persistence",
		() =>
			Effect.gen(function* () {
				const { client } = yield* createAuthenticatedClient();
				const { a } = pluginNamespacePackages();
				const compiled = yield* compilePluginPackage(a);
				for (const packageId of [
					undefined,
					"invalid",
					"00000000-0000-0000-0000-000000000000",
					"550E8400-E29B-41D4-A716-446655440000",
				]) {
					const entries = unzipSync(writePluginArchive(compiled));
					const metadata: {
						-readonly [
							Key in keyof typeof compiled.manifest.metadata
						]?: (typeof compiled.manifest.metadata)[Key];
					} = { ...compiled.manifest.metadata };
					delete metadata.packageId;
					const invalid = {
						...compiled.manifest,
						metadata: { ...metadata, ...(packageId === undefined ? {} : { packageId }) },
					};
					entries["manifest.json"] = new TextEncoder().encode(
						yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))(invalid),
					);
					const uploadToken = yield* uploadTemporaryArchive(client, zipSync(entries), {
						fileName: "invalid-identity.zip",
					});
					const failure = yield* Effect.flip(
						client.call((contract) =>
							contract.plugins.install({ payload: { config: {}, uploadToken } }),
						),
					);
					assertTaggedError(failure, "PluginRequestError");
					expect(failure.reason).toEqual({
						issue: "manifest-invalid",
						code: "package-archive-invalid",
					});
				}
				expect(
					(yield* listNamespaceInstallations(client)).filter(({ scope }) => scope === "user"),
				).toEqual([]);
			}),
	);
	for (const reverse of [false, true]) {
		it.live(
			`keeps both Whiskey owners independent in ${reverse ? "B/A" : "A/B"} install order`,
			() =>
				Effect.gen(function* () {
					const { client } = yield* createAuthenticatedClient();
					const packages = pluginNamespacePackages();
					const first = yield* installNamespacePackage(client, reverse ? packages.b : packages.a);
					const second = yield* installNamespacePackage(client, reverse ? packages.a : packages.b);
					const a = reverse ? second : first;
					const b = reverse ? first : second;
					expect(a.pluginId).not.toBe(b.pluginId);
					expect(a.id).not.toBe(b.id);
					for (const installed of [a, b]) {
						expect(installed.installation).toMatchObject({ health: "ready", name: "Whiskey" });
					}
					expect(
						(yield* invokeNamespaceOperation(client, a.installation.packageId)).result,
					).toEqual({ label: "A1" });
					expect(
						(yield* invokeNamespaceOperation(client, b.installation.packageId)).result,
					).toEqual({ label: "B1" });
					const aRows = yield* executeRyotQLRecipe(
						client,
						namespaceBottlesRecipe({
							joinDefinitions: true,
							reference: { kind: "local", pluginId: a.pluginId },
						}),
					);
					const bRows = yield* executeRyotQLRecipe(
						client,
						namespaceBottlesRecipe({
							joinDefinitions: true,
							reference: {
								scope: "user",
								kind: "package",
								packageId: packages.b.manifest.metadata.packageId,
							},
						}),
					);
					expect(aRows).toEqual([
						expect.objectContaining({
							owner: a.pluginId,
							name: "A1 bottle",
							properties: { strength: "forty", opaque: packages.externalId },
						}),
					]);
					expect(bRows).toEqual([
						expect.objectContaining({
							owner: b.pluginId,
							name: "B1 bottle",
							properties: { strength: 40, opaque: packages.externalId },
						}),
					]);
					const broad = yield* executeRyotQLRecipe(client, namespaceBottlesRecipe({}));
					expect(broad.map(({ id }) => id)).toEqual(
						expect.arrayContaining([...aRows, ...bRows].map(({ id }) => id)),
					);
					expect(
						yield* executeRyotQLRecipe(
							client,
							namespacePairRecipe({
								a: { kind: "local", pluginId: a.pluginId },
								b: { kind: "local", pluginId: b.pluginId },
							}),
						),
					).toEqual([{ aName: "A1 bottle", bName: "B1 bottle" }]);
					const imports = (yield* collectRyotQLRecipeItems(client, (after) =>
						importSourcesRecipe({ after, limit: 100 }),
					)).filter(
						(entry) =>
							entry.slug === "import" &&
							(entry.pluginId === a.pluginId || entry.pluginId === b.pluginId),
					);
					const integrations = (yield* collectRyotQLRecipeItems(client, (after) =>
						integrationProvidersRecipe({ after, limit: 100 }),
					)).filter(
						(entry) =>
							entry.slug === "import" &&
							(entry.pluginId === a.pluginId || entry.pluginId === b.pluginId),
					);
					for (const entries of [imports, integrations]) {
						expect(entries).toHaveLength(2);
						expect(entries.map(({ reference }) => reference)).toEqual(
							expect.arrayContaining([
								{ slug: "import", owner: { kind: "plugin", pluginId: a.pluginId } },
								{ slug: "import", owner: { kind: "plugin", pluginId: b.pluginId } },
							]),
						);
					}
				}),
		);
	}

	it.live("rejects duplicate and concurrent package installs without a second owner", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { a } = pluginNamespacePackages();
			const results = yield* Effect.all(
				[
					Effect.result(installPrivatePluginPackage({ client, config: {}, pluginPackage: a })),
					Effect.result(installPrivatePluginPackage({ client, config: {}, pluginPackage: a })),
				],
				{ concurrency: "unbounded" },
			);
			expect(results.filter((result) => result._tag === "Success")).toHaveLength(1);
			const duplicate = yield* Effect.flip(
				installPrivatePluginPackage({ client, config: {}, pluginPackage: a }),
			);
			assertTaggedError(duplicate, "PluginConflictError");
			expect(duplicate.reason.code).toBe("already-installed");
			const installations = yield* listNamespaceInstallations(client);
			expect(
				installations.filter(({ packageId }) => packageId === a.manifest.metadata.packageId),
			).toHaveLength(1);
		}),
	);

	it.live("renames metadata without rekeying and rejects an identity-changing update", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const packages = pluginNamespacePackages();
			const a = yield* installNamespacePackage(client, packages.a);
			const renamed = {
				...packages.a2,
				manifest: {
					...packages.a2.manifest,
					metadata: { ...packages.a2.manifest.metadata, name: "Renamed Whiskey" },
				},
			};
			const updated = yield* updateNamespacePackage(client, a, renamed);
			expect(updated).toMatchObject({ id: a.id, pluginId: a.pluginId });
			const installation = yield* namespaceInstallation(client, a.pluginId);
			expect(installation.contentHash).not.toBe(a.installation.contentHash);
			expect(installation.version).toBe(a.installation.version);
			expect((yield* invokeNamespaceOperation(client, a.installation.packageId)).result).toEqual({
				label: "A2",
			});
			const wrongId = {
				...renamed,
				manifest: {
					...renamed.manifest,
					metadata: { ...renamed.manifest.metadata, packageId: testPluginPackageId() },
				},
			};
			const error = yield* Effect.flip(
				updateNamespacePackage(client, { ...a, installation }, wrongId),
			);
			assertTaggedError(error, "PluginRequestError");
			expect(error.reason).toMatchObject({
				code: "package-id-mismatch",
				packageId: wrongId.manifest.metadata.packageId,
				expectedPackageId: packages.a.manifest.metadata.packageId,
			});
			expect((yield* namespaceInstallation(client, a.pluginId)).contentHash).toBe(
				installation.contentHash,
			);
		}),
	);
});
