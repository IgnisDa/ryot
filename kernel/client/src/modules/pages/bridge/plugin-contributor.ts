import type { PreparedClientPage } from "@ryot-app/contract/modules/pages/schemas";

export const invalidRequest = { outcome: "failure", reason: "invalid-request" } as const;

export const hasPluginContributor = (
	contributors: PreparedClientPage["identity"]["contributors"],
	pluginId: string,
) =>
	contributors.some(
		(contributor) => contributor.kind === "plugin" && contributor.pluginId === pluginId,
	);
