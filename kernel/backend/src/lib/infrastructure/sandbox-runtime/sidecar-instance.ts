import type { SandboxTrust } from "./execution-principal";

export const sandboxInstanceKey = (
	trust: typeof SandboxTrust.Type,
	tier: string,
	owner?: string,
) => (owner === undefined ? `${trust}/${tier}` : `${trust}/${tier}/${owner}`);

export const residentInstance = (trust: typeof SandboxTrust.Type) => `${trust}/core`;

export const isResidentInstance = (instance: string) =>
	instance === residentInstance("system") || instance === residentInstance("user");
