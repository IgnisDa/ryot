import { expect, it } from "vitest";

import { installationExecutionGate } from "./installation-execution-gate";

type Installation = Parameters<typeof installationExecutionGate>[0]["installation"];

const installation: Installation = {
	isHidden: false,
	health: "ready",
	uninstalledAt: null,
	isInitialized: true,
	id: "installation-1",
	incompatibilityReason: null,
};

const gate = (state: Partial<Installation>, exactPin: boolean) =>
	installationExecutionGate({
		exactPin,
		activationId: null,
		bootstrapScript: false,
		initialization: undefined,
		installation: { ...installation, ...state },
	});

it("lets retained exact pins run while hidden but not after uninstall", () => {
	expect(gate({ isHidden: true }, true)).toBe(true);
	expect(gate({ isHidden: true }, false)).toBe(false);
	expect(gate({ uninstalledAt: new Date(0) }, true)).toBe(false);
});
