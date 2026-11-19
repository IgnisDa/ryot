import type { MouseEvent } from "react";

export const activateLink =
	(run: () => void | Promise<void>) => (event: MouseEvent<HTMLAnchorElement>) => {
		if (event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
			return;
		}
		event.preventDefault();
		void run();
	};
