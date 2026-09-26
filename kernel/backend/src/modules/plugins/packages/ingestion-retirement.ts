import type { DbError } from "@ryot-app/contract/errors";
import type { PluginInstallationUnavailableReason } from "@ryot-app/contract/modules/sandbox/boundary-reason";
import { PluginId, UserId, type PluginPackageId } from "@ryot-app/contract/schema/brands";
import { Context, Effect } from "effect";

import type { PluginCatalogInvalidator } from "../catalog/events";
import type { PluginInstallationRepository } from "../installations/repository";

export type PluginIngestionRetirementPolicy =
	| { readonly kind: "removal" }
	| {
			readonly kind: "quarantine";
			readonly reason: PluginInstallationUnavailableReason & {
				readonly code: "package-identity-conflict";
			};
	  };

export class PluginIngestionRetirement extends Context.Service<
	PluginIngestionRetirement,
	{
		retire: (input: {
			userId: UserId;
			pluginInstallationId: string;
			policy: PluginIngestionRetirementPolicy;
		}) => Effect.Effect<void, DbError>;
	}
>()("PluginIngestionRetirement") {}

export const quarantinePackageConflicts = Effect.fn("quarantinePackageConflicts")(function* (
	installations: PluginInstallationRepository["Service"],
	invalidator: PluginCatalogInvalidator["Service"],
	packageId: PluginPackageId,
) {
	const quarantined = yield* installations.quarantinePackageIdentityConflicts(packageId);
	for (const installation of quarantined) {
		yield* invalidator.recordUser(UserId.make(installation.userId));
	}
	return quarantined;
});

export const retireQuarantinedInstallations = (
	retirement: PluginIngestionRetirement["Service"],
	quarantined: ReadonlyArray<{
		readonly id: string;
		readonly userId: string;
		readonly pluginId: string;
	}>,
) =>
	Effect.forEach(
		quarantined,
		(installation) =>
			retirement.retire({
				pluginInstallationId: installation.id,
				userId: UserId.make(installation.userId),
				policy: {
					kind: "quarantine",
					reason: {
						installationId: installation.id,
						code: "package-identity-conflict",
						pluginId: PluginId.make(installation.pluginId),
					},
				},
			}),
		{ discard: true },
	);
