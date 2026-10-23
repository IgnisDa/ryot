import { Effect } from "effect";
import { useRef, useState } from "react";

type HostScreenOutcome = { readonly kind: string };

type HostScreenSession<Request, Outcome extends HostScreenOutcome> = {
	readonly request: Request;
	readonly complete: (outcome: Outcome) => void;
};

export function useHostScreenSession<Request, Outcome extends HostScreenOutcome>(
	cancelled: Outcome,
	options: { readonly onOpen?: (request: Request) => void; readonly onDismiss?: () => void } = {},
) {
	const pending = useRef<((outcome: Outcome) => void) | null>(null);
	const [session, setSession] = useState<HostScreenSession<Request, Outcome> | null>(null);
	const open = (request: Request) =>
		Effect.callback<Outcome>((resume) => {
			if (pending.current !== null) {
				resume(Effect.succeed(cancelled));
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
			const complete = (outcome: Outcome) => {
				if (completed) {
					return;
				}
				completed = true;
				clear();
				if (outcome.kind === cancelled.kind) {
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
