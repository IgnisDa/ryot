import { SandboxRunError, unknownToMessage } from "@ryot-app/contract/errors";

export const infrastructureRunError = (error: unknown) =>
	new SandboxRunError({ kind: "infrastructure", message: unknownToMessage(error) });
