import type { SandboxHost } from "@ryot/sandbox-sdk/core";
import { Effect } from "@ryot/sandbox-sdk/effect";

export const getUserIsNsfw = (host: SandboxHost<readonly ["getUserPreferences"]>) =>
	host.getUserPreferences().pipe(Effect.map((preferences) => preferences.isNsfw));
