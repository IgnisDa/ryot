import type { WriteAccess } from "@ryot-app/contract/oauth";
import type { Capability } from "@ryot-app/contract/schema/capability";
import type { JsonValue } from "@ryot-app/contract/schema/json";
import type { Message } from "@ryot-app/i18n/message";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
import { Effect } from "effect";

import type { AgentRunSuspended } from "#modules/scripts/agent/service";

import { capabilityDeclarations } from "./declarations";

export type WriteRequest = {
	readonly index: number;
	readonly input: JsonValue;
	readonly capability: Capability;
};
export type WriteGate = {
	readonly authorize: (
		request: WriteRequest,
	) => Effect.Effect<
		{ readonly approved: true } | { readonly reason: Message; readonly approved: false },
		AgentRunSuspended
	>;
	readonly settle: (
		request: WriteRequest,
		outcome:
			| { readonly message: string; readonly state: "failure" }
			| { readonly state: "success"; readonly value: JsonValue },
	) => Effect.Effect<void>;
};

export const changeDeclined = kernelMessage("error.agent-tools.change-declined");
export const confirmationUnavailable = kernelMessage("error.agent-tools.confirmation-unavailable");

const declining = (reason: Message): WriteGate => ({
	settle: () => Effect.void,
	authorize: () => Effect.succeed({ reason, approved: false }),
});

export const credentialWriteGate = (writeAccess: WriteAccess, confirm: null | WriteGate) => {
	if (writeAccess === "unattended") {
		return {
			settle: () => Effect.void,
			authorize: () => Effect.succeed({ approved: true }),
		} satisfies WriteGate;
	}
	if (writeAccess === "none") {
		return declining(kernelMessage("error.agent-tools.read-only-connection"));
	}
	return confirm ?? declining(confirmationUnavailable);
};

export const referencedCapabilities = (code: string, capabilities: readonly Capability[]) =>
	capabilities.filter((capability) =>
		["'", '"', "`"].some((quote) => code.includes(`${quote}${capability.id}${quote}`)),
	);

export const executeSource = (code: string, capabilities: readonly Capability[]) =>
	`const run = async (ryot: Ryot): Promise<unknown> => {${code}
};
interface Ryot {
  call<Id extends keyof Capabilities>(id: Id, input: Capabilities[Id]["input"]): Promise<Capabilities[Id]["output"]>;
}
export const manifest = defineManifest({ kind: "script", name: "Agent execution", slug: "agent.execute" });
export default defineScript({
  manifest,
  input: Schema.Struct({}),
  output: Schema.Unknown,
  run: (_input, host) => {
    function call<Id extends keyof Capabilities>(id: Id, input: Capabilities[Id]["input"]): Promise<Capabilities[Id]["output"]>;
    function call(id: string, input: Json): Promise<unknown> {
      return Effect.runPromise(
        host.invokeCapability({ id, input }).pipe(
          Effect.mapError(
            (error) =>
              new Error(error.data === undefined ? error.message : error.message + ": " + JSON.stringify(error.data)),
          ),
        ),
      );
    }
    return Effect.tryPromise({
      try: async () => (await run({ call })) ?? null,
      catch: (error) => (error instanceof Error ? error.message : String(error)),
    });
  },
});
${capabilityDeclarations(capabilities)}
import { defineManifest, defineScript } from "@ryot-app/plugin-backend-sdk/agent";
import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";
`;
