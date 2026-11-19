import { type RefObject, useEffect, useLayoutEffect, useRef } from "react";

const END_TOLERANCE_PX = 16;

export function useFollowEnd(
	scrollRoot: RefObject<null | HTMLElement>,
	content: RefObject<null | HTMLElement>,
	key: string | undefined,
) {
	const following = useRef(true);
	const enabled = key !== undefined;

	useLayoutEffect(() => {
		const root = scrollRoot.current;
		if (key === undefined || root === null) {
			return;
		}
		following.current = true;
		root.scrollTo({ top: root.scrollHeight });
	}, [key, scrollRoot]);

	useEffect(() => {
		const root = scrollRoot.current;
		const inner = content.current;
		if (!enabled || root === null || inner === null || typeof ResizeObserver === "undefined") {
			return undefined;
		}
		const track = () => {
			following.current =
				root.scrollHeight - root.scrollTop - root.clientHeight <= END_TOLERANCE_PX;
		};
		const observer = new ResizeObserver(() => {
			if (following.current) {
				root.scrollTo({ top: root.scrollHeight });
			}
		});
		observer.observe(root);
		observer.observe(inner);
		root.addEventListener("scroll", track, { passive: true });
		return () => {
			observer.disconnect();
			root.removeEventListener("scroll", track);
		};
	}, [content, enabled, scrollRoot]);
}
