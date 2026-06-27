import type { SandboxHost } from "@ryot/sandbox-sdk";

export const getUserIsNsfw = (host: SandboxHost<readonly ["getUserPreferences"]>) =>
	host.getUserPreferences().then((preferences) => preferences.success && preferences.data.isNsfw);
