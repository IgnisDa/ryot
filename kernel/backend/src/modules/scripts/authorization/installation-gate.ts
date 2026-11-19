import type * as schema from "#schema/tables/combined";

import type { ScriptInstallationInitialization } from "./principal";

type InstallationExecutionState = {
	readonly [
		K in "id" | "health" | "isHidden" | "isInitialized" | "uninstalledAt" | "incompatibilityReason"
	]: null | (typeof schema.pluginInstallation.$inferSelect)[K];
};

export const installationExecutionGate = (input: {
	readonly exactPin: boolean;
	readonly bootstrapScript: boolean;
	readonly activationId: null | string;
	readonly installation: InstallationExecutionState;
	readonly initialization: undefined | ScriptInstallationInitialization;
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
