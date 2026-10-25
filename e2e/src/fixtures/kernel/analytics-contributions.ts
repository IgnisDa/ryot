import { CLIENT_API_VERSION } from "@ryot-app/contract/modules/plugins/manifest";
import type { PluginPackageId } from "@ryot-app/contract/schema/brands";
import { randomUuid } from "@ryot-app/testing/random";
import { Effect } from "effect";

import type { Client } from "./auth";
import { compilePluginPackage, type PluginPackageInput } from "./compiled-package";
import { installPrivatePluginPackage, settledPrivateInstallation } from "./private-plugin";
import { encodePluginSourceFiles, testPluginManifest, testPluginPackageId } from "./test-plugin";

const sectionSource = (marker: string, fails: boolean) => `
import type { AnalyticsSectionProps } from "@ryot-app/plugin-client-sdk/plugin";
import { useEffect } from "react";
${fails ? "let mountFailed = false;" : ""}
export default function Section({ owner, selection, timeZone }: AnalyticsSectionProps) {
  useEffect(() => {
    ${fails ? 'if (!mountFailed) { mountFailed = true; throw new Error("Fixture mount failure"); }' : ""}
    document.documentElement.setAttribute(${JSON.stringify(`data-mounted-${marker}`)}, "true");
    return () => document.documentElement.removeAttribute(${JSON.stringify(`data-mounted-${marker}`)});
  }, []);
  ${fails ? 'if (selection.grouping !== "year") throw new Error("Fixture render failure");' : ""}
  return <section aria-label=${JSON.stringify(marker)}>
    <h2>${marker}</h2>
    <output data-testid="analytics-owner">{owner.pluginId}</output>
    <output data-testid="analytics-zone">{timeZone}</output>
    <output data-testid="analytics-selection">{JSON.stringify(selection)}</output>
  </section>;
}
`;

export const analyticsContributionPackage = Effect.fn(function* (
	input: {
		readonly revision?: string;
		readonly packageId?: PluginPackageId;
		readonly dependency?: PluginPackageId;
	} = {},
) {
	const source: PluginPackageInput = {
		files: encodePluginSourceFiles({
			"client/failure.tsx": sectionSource("failure", true),
			"client/activity.tsx": sectionSource(`activity-${input.revision ?? "initial"}`, false),
		}),
		manifest: testPluginManifest({
			pluginSlug: `analytics-${yield* randomUuid}`,
			packageId: input.packageId ?? testPluginPackageId(),
			clientDefinition: {
				homeView: null,
				apiVersion: CLIENT_API_VERSION,
				pluginDependencies:
					input.dependency === undefined
						? {}
						: { required: { scope: "user", packageId: input.dependency } },
				analyticsSections: {
					failure: { icon: "box", sortOrder: 1, exportName: "failure", name: "Fixture failure" },
					activity: { icon: "box", sortOrder: 0, exportName: "activity", name: "Fixture activity" },
				},
				exports: {
					failure: {
						kind: "analytics-section",
						entry: "client/failure.tsx",
						automaticEntityPresentations: false,
					},
					activity: {
						kind: "analytics-section",
						entry: "client/activity.tsx",
						automaticEntityPresentations: false,
					},
				},
			},
		}),
	};
	return source;
});

export const installAnalyticsContribution = Effect.fn(function* (
	client: Client,
	input?: PluginPackageInput,
) {
	const source = input ?? (yield* analyticsContributionPackage());
	const pluginPackage = yield* compilePluginPackage(source);
	const installed = yield* installPrivatePluginPackage({ client, config: {}, pluginPackage });
	const installation = yield* settledPrivateInstallation(client, installed.id);
	return {
		source,
		installation,
		pluginPackage,
		pluginId: installed.pluginId,
		installationId: installed.id,
	};
});
