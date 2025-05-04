import { resolveRequiredString } from "@ryot/ts-utils";

export const resolveAuthenticationName = (name: string) =>
	resolveRequiredString(name, "Signup name");
