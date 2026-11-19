import { useRouter } from "@tanstack/react-router";
import { useEffect, useEffectEvent, useRef } from "react";

/**
 * A settings overlay whose open state lives in the URL: opening pushes an entry, and every close
 * affordance pops the one it pushed, falling back to a replace when the overlay was entered
 * directly. `markCompleted` defers the caller's reload until the overlay has actually left.
 */
export function useSearchParamModal(input: {
	readonly isOpen: boolean;
	readonly open: () => void;
	readonly close: () => void;
	readonly onCompleted: () => void;
}) {
	const router = useRouter();
	const pushed = useRef(false);
	const completed = useRef(false);

	const settle = useEffectEvent(() => {
		pushed.current = false;
		if (!completed.current) {
			return;
		}
		completed.current = false;
		input.onCompleted();
	});

	useEffect(() => {
		if (input.isOpen) {
			return;
		}
		settle();
	}, [input.isOpen]);

	return {
		markCompleted: () => {
			completed.current = true;
		},
		open: () => {
			pushed.current = true;
			input.open();
		},
		close: () => {
			if (pushed.current) {
				pushed.current = false;
				router.history.back();
				return;
			}
			input.close();
		},
	};
}
