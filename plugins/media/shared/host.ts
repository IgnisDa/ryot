import type { SandboxHost } from "@ryot/sandbox-sdk/core";
import { Effect } from "@ryot/sandbox-sdk/effect";

export const getUserAllowNsfw = (host: SandboxHost<readonly ["getUserPreferences"]>) =>
	host.getUserPreferences().pipe(Effect.map((preferences) => preferences.allowNsfw));
