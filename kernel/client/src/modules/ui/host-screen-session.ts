import { Effect } from "effect";
import { useRef, useState } from "react";

type HostScreenOutcome = { readonly kind: string };

type HostScreenSession<Request, Outcome extends HostScreenOutcome> = {
	readonly request: Request;
	readonly complete: (outcome: Outcome) => void;
};

export function useHostScreenSession<Request, Outcome extends HostScreenOutcome>(
	cancelled: Outcome,
	options: { readonly onDismiss?: () => void; readonly onOpen?: (request: Request) => void } = {},
) {
	const pending = useRef<null | ((outcome: Outcome) => void)>(null);
	const [session, setSession] = useState<null | HostScreenSession<Request, Outcome>>(null);
	const open = (request: Request) =>
		Effect.callback<Outcome>((resume) => {
			if (pending.current !== null) {
				resume(Effect.succeed(cancelled));
				return Effect.void;
			}
			const completion = { done: false };
			const clear = () => {
				if (pending.current !== complete) {
					return;
				}
				pending.current = null;
				setSession((current) => (current?.complete === complete ? null : current));
			};
			const complete = (outcome: Outcome) => {
				if (completion.done) {
					return;
				}
				completion.done = true;
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
				if (!completion.done && pending.current === complete) {
					completion.done = true;
					clear();
					options.onDismiss?.();
				}
			});
		});
	return { open, session };
}
