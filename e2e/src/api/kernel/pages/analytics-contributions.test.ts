import type { ClientCompositionDocument } from "@ryot-app/contract/modules/pages/schemas";
import { writePluginArchive } from "@ryot-app/plugin-archive";
import { Effect, Schema } from "effect";
import { unzipSync, zipSync } from "fflate";

import {
	analyticsContributionPackage,
	installAnalyticsContribution,
} from "~/fixtures/kernel/analytics-contributions";
import { createAuthenticatedClient } from "~/fixtures/kernel/auth";
import { checkClientPageFreshness, prepareClientPage } from "~/fixtures/kernel/pages";
import { updatePluginState } from "~/fixtures/kernel/plugins";
import {
	settledPrivateInstallation,
	uninstallPrivatePlugin,
	updatePrivatePlugin,
} from "~/fixtures/kernel/private-plugin";
import { uploadTemporaryArchive } from "~/fixtures/kernel/temporary-archive";
import { assertTaggedError, requirePresent } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";
import { webRequest } from "~/support/web-request";

const analyticsSections = ({ descriptor }: ClientCompositionDocument) => {
	if (descriptor.application !== "page") {
		throw new Error("Analytics document is not a page composition");
	}
	return descriptor.analyticsSections;
};

describe("generic Analytics contributions", () => {
	it.live(
		"binds identical private declarations to exact local owners and warms capability-protected artifacts",
		() =>
			Effect.gen(function* () {
				const first = yield* createAuthenticatedClient();
				const second = yield* createAuthenticatedClient();
				const source = yield* analyticsContributionPackage();
				const a = yield* installAnalyticsContribution(first.client, source);
				const b = yield* installAnalyticsContribution(second.client, source);
				expect(a.pluginId).not.toBe(b.pluginId);
				for (const [client, own, other] of [
					[first.client, a, b],
					[second.client, b, a],
				] as const) {
					const page = yield* prepareClientPage(client, { kind: "kernel", slug: "analytics" });
					const document = yield* client.call((contract) =>
						contract.pages.document({ payload: { identity: page.identity } }),
					);
					const sections = analyticsSections(document).filter(
						(section) => section.ownerPluginId === own.pluginId,
					);
					expect(sections.map(({ slug }) => slug)).toEqual(["activity", "failure"]);
					expect(
						analyticsSections(document).some((section) => section.ownerPluginId === other.pluginId),
					).toBe(false);
					const section = requirePresent(sections[0], "Missing owned analytics section");
					const module = requirePresent(section.module, "Missing owned section module");
					const url = requirePresent(
						document.importMap.imports[module.specifier],
						"Missing private module URL",
					);
					expect(document.modulepreloads).toContain(url);
					expect(url).not.toContain("/public/");
					expect((yield* webRequest(new URL(url, client.target.apiUrl))).status).toBe(200);
					for (const stylesheet of section.stylesheets) {
						expect(document.stylesheets).toContain(stylesheet);
						expect(stylesheet).not.toContain("/public/");
						expect((yield* webRequest(new URL(stylesheet, client.target.apiUrl))).status).toBe(200);
					}
					for (const privateUrl of [url, ...section.stylesheets]) {
						const publicUrl = new URL(privateUrl, client.target.apiUrl);
						publicUrl.pathname = publicUrl.pathname.replace(
							/^(\/api\/page-bundles\/[^/]+\/)[^/]+\//,
							"$1public/",
						);
						expect((yield* webRequest(publicUrl)).status).toBe(404);
					}
				}
			}),
	);

	it.live(
		"stales the catalog on hide, restore, and revision changes without changing local ownership",
		() =>
			Effect.gen(function* () {
				const { client } = yield* createAuthenticatedClient();
				const installed = yield* installAnalyticsContribution(client);
				const page = yield* prepareClientPage(client, { kind: "kernel", slug: "analytics" });
				expect((yield* checkClientPageFreshness(client, page.identity)).current).toBe(true);
				yield* updatePluginState(client, installed.installationId, { isHidden: true });
				expect((yield* checkClientPageFreshness(client, page.identity)).current).toBe(false);
				const hidden = yield* prepareClientPage(client, { kind: "kernel", slug: "analytics" });
				const hiddenDocument = yield* client.call((contract) =>
					contract.pages.document({ payload: { identity: hidden.identity } }),
				);
				expect(
					analyticsSections(hiddenDocument).some(
						(section) => section.ownerPluginId === installed.pluginId,
					),
				).toBe(false);
				yield* updatePluginState(client, installed.installationId, { isHidden: false });
				expect((yield* checkClientPageFreshness(client, hidden.identity)).current).toBe(false);
				const restored = yield* prepareClientPage(client, { kind: "kernel", slug: "analytics" });
				yield* updatePrivatePlugin({
					client,
					installationId: installed.installationId,
					expectedContentHash: installed.installation.contentHash,
					payload: yield* analyticsContributionPackage({
						revision: "updated",
						packageId: installed.source.manifest.metadata.packageId,
					}),
				});
				yield* settledPrivateInstallation(client, installed.installationId);
				expect((yield* checkClientPageFreshness(client, restored.identity)).current).toBe(false);
				const updated = yield* prepareClientPage(client, { kind: "kernel", slug: "analytics" });
				const document = yield* client.call((contract) =>
					contract.pages.document({ payload: { identity: updated.identity } }),
				);
				expect(
					analyticsSections(document).filter(
						(section) => section.ownerPluginId === installed.pluginId,
					),
				).toHaveLength(2);
			}),
	);

	it.live("rejects registrations with missing or wrong-kind exports before persistence", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const installed = yield* installAnalyticsContribution(client);
			const compiled = installed.pluginPackage;
			const definition = requirePresent(compiled.manifest.client, "Missing client definition");
			const registration = requirePresent(
				definition.analyticsSections?.activity,
				"Missing activity registration",
			);
			const declaration = requirePresent(definition.exports?.activity, "Missing activity export");
			for (const invalid of [
				{
					...definition,
					analyticsSections: {
						...definition.analyticsSections,
						activity: { ...registration, exportName: "foreign" },
					},
				},
				{
					...definition,
					exports: { ...definition.exports, activity: { ...declaration, kind: "component" } },
				},
			]) {
				const entries = unzipSync(writePluginArchive(compiled));
				entries["manifest.json"] = new TextEncoder().encode(
					yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))({
						...compiled.manifest,
						client: invalid,
					}),
				);
				const uploadToken = yield* uploadTemporaryArchive(client, zipSync(entries), {
					fileName: "invalid-analytics.zip",
				});
				const failure = yield* client
					.call((contract) => contract.plugins.install({ payload: { config: {}, uploadToken } }))
					.pipe(Effect.flip);
				assertTaggedError(failure, "PluginRequestError");
				expect(failure.reason).toEqual({
					issue: "manifest-invalid",
					code: "package-archive-invalid",
				});
			}
			const page = yield* prepareClientPage(client, { kind: "kernel", slug: "analytics" });
			expect(page.identity.kind).toBe("kernel-saved-view");
		}),
	);

	it.live(
		"keeps a healthy contributor available when another has an unresolved private dependency",
		() =>
			Effect.gen(function* () {
				const { client } = yield* createAuthenticatedClient();
				const healthy = yield* installAnalyticsContribution(client);
				const dependency = yield* installAnalyticsContribution(client);
				const unavailable = yield* installAnalyticsContribution(
					client,
					yield* analyticsContributionPackage({
						dependency: dependency.source.manifest.metadata.packageId,
					}),
				);
				expect(unavailable.installation.health).toBe("ready");
				yield* uninstallPrivatePlugin(
					client,
					dependency.installationId,
					dependency.installation.activationId,
				);
				const page = yield* prepareClientPage(client, { kind: "kernel", slug: "analytics" });
				const document = yield* client.call((contract) =>
					contract.pages.document({ payload: { identity: page.identity } }),
				);
				const ready = analyticsSections(document).filter(
					(section) => section.ownerPluginId === healthy.pluginId,
				);
				expect(ready).toHaveLength(2);
				expect(ready.every((section) => section.module !== null)).toBe(true);
				const failed = analyticsSections(document).filter(
					(section) => section.ownerPluginId === unavailable.pluginId,
				);
				expect(failed).toHaveLength(2);
				expect(failed.every((section) => section.module === null)).toBe(true);
				yield* installAnalyticsContribution(client, dependency.source);
				expect((yield* checkClientPageFreshness(client, page.identity)).current).toBe(false);
				const recovered = yield* prepareClientPage(client, { kind: "kernel", slug: "analytics" });
				const recoveredDocument = yield* client.call((contract) =>
					contract.pages.document({ payload: { identity: recovered.identity } }),
				);
				const recoveredSections = analyticsSections(recoveredDocument).filter(
					(section) => section.ownerPluginId === unavailable.pluginId,
				);
				expect(recoveredSections).toHaveLength(2);
				expect(recoveredSections.every((section) => section.module !== null)).toBe(true);
			}),
	);
});
