import type {
	PluginBridgePickEntityScreen,
	PickEntityOutcome,
} from "@ryot-app/plugin-client-contract";
import { Effect } from "effect";
import { useRef, useState } from "react";

type EntityPickerSession = {
	readonly complete: (outcome: PickEntityOutcome) => void;
	readonly request: PluginBridgePickEntityScreen;
};

export function useEntityPickerSession(
	options: {
		readonly onOpen?: (request: PluginBridgePickEntityScreen) => void;
		readonly onDismiss?: () => void;
	} = {},
) {
	const pending = useRef<EntityPickerSession["complete"] | null>(null);
	const [session, setSession] = useState<EntityPickerSession | null>(null);
	const open = (request: PluginBridgePickEntityScreen) =>
		Effect.callback<PickEntityOutcome>((resume) => {
			if (pending.current !== null) {
				resume(Effect.succeed<PickEntityOutcome>({ kind: "cancelled" }));
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
			const complete = (outcome: PickEntityOutcome) => {
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
