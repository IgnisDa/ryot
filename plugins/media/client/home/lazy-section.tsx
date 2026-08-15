import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";

const MOUNT_MARGIN = "600px 0px";

/**
 * Mounts its children once they come within 600px of the scroll root. `useRyotQuery` has no
 * enabled flag, so deferring the mount is what defers the query.
 */
export function LazySection(props: {
	readonly children: ReactNode;
	readonly scrollRootRef: RefObject<HTMLElement | null>;
}) {
	const anchor = useRef<HTMLDivElement>(null);
	const [mounted, setMounted] = useState(() => typeof IntersectionObserver === "undefined");
	const { scrollRootRef } = props;
	useEffect(() => {
		const element = anchor.current;
		if (mounted || element === null) {
			return undefined;
		}
		const observer = new IntersectionObserver(
			(entries) => {
				if (entries.some((entry) => entry.isIntersecting)) {
					setMounted(true);
				}
			},
			{ rootMargin: MOUNT_MARGIN, root: scrollRootRef.current },
		);
		observer.observe(element);
		return () => observer.disconnect();
	}, [mounted, scrollRootRef]);
	return mounted ? props.children : <div ref={anchor} className="h-px" />;
}
