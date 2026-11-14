import type { BetterAuthOptions } from "@better-auth/core";
import { getIP } from "@better-auth/core/utils/ip";

export const authAdvancedOptions = {
	disableCSRFCheck: false,
} satisfies BetterAuthOptions["advanced"];

export const requestClientAddress = (headers: Headers) =>
	getIP(headers, { advanced: authAdvancedOptions });
