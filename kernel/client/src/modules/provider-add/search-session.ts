import type {
	PluginBridgeProviderSearchScreen,
	ProviderSearchScreenOutcome,
} from "@ryot-app/plugin-client-contract";
import { Effect } from "effect";
import { useRef, useState } from "react";

type ProviderSearchSession = {
	readonly complete: (outcome: ProviderSearchScreenOutcome) => void;
	readonly request: PluginBridgeProviderSearchScreen;
};

export function useProviderSearchSession(
	options: {
		readonly onOpen?: (request: PluginBridgeProviderSearchScreen) => void;
		readonly onDismiss?: () => void;
	} = {},
) {
	const pending = useRef<ProviderSearchSession["complete"] | null>(null);
	const [session, setSession] = useState<ProviderSearchSession | null>(null);
	const open = (request: PluginBridgeProviderSearchScreen) =>
		Effect.callback<ProviderSearchScreenOutcome>((resume) => {
			if (pending.current !== null) {
				resume(Effect.succeed<ProviderSearchScreenOutcome>({ kind: "cancelled" }));
				return Effect.void;
			}
			let completed = false;
			const clear = () => {
				if (pending.current !== complete) {
					return;
				}
				pending.current = null;
				setSession((current) => (current?.complete === complete ? null : current));
			};
			const complete = (outcome: ProviderSearchScreenOutcome) => {
				if (completed) {
					return;
				}
				completed = true;
				clear();
				if (outcome.kind === "cancelled") {
					options.onDismiss?.();
				}
				resume(Effect.succeed(outcome));
			};
			pending.current = complete;
			setSession({ request, complete });
			options.onOpen?.(request);
			return Effect.sync(() => {
				if (!completed && pending.current === complete) {
					completed = true;
					clear();
					options.onDismiss?.();
				}
			});
		});
	return { open, session };
}
