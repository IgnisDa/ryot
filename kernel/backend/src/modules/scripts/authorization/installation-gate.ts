import type { ScriptInstallationInitialization } from "@ryot-app/sandbox/protocol/principal";

import type * as schema from "#lib/infrastructure/db/schema/tables/combined";

type InstallationExecutionState = {
	readonly [
		K in "id" | "health" | "isHidden" | "isInitialized" | "uninstalledAt" | "incompatibilityReason"
	]: (typeof schema.pluginInstallation.$inferSelect)[K] | null;
};

export const installationExecutionGate = (input: {
	readonly exactPin: boolean;
	readonly bootstrapScript: boolean;
	readonly activationId: string | null;
	readonly installation: InstallationExecutionState;
	readonly initialization: ScriptInstallationInitialization | undefined;
}) => {
	const { installation, initialization } = input;
	const initializer =
		initialization !== undefined &&
		input.bootstrapScript &&
		initialization.installationId === installation.id &&
		initialization.activationId === input.activationId &&
		installation.health === "installing" &&
		!installation.isInitialized;
	return (
		(initialization === undefined || initializer) &&
		!(installation.isHidden && !initializer) &&
		!installation.uninstalledAt &&
		installation.incompatibilityReason === null &&
		(installation.health === "ready" ||
			installation.health === "installing" ||
			(input.exactPin && installation.health === "needs-configuration"))
	);
};
