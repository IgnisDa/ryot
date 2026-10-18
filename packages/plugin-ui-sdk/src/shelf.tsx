import clsx from "clsx";
import {
	Children,
	type KeyboardEvent,
	type ReactNode,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";

import { IconButton } from "./button";

const FOCUSABLE = "a[href], button:not(:disabled), [tabindex]:not([tabindex='-1'])";

const scrollEdges = (element: HTMLElement) => ({
	start: element.scrollLeft > 1,
	end: element.scrollLeft + element.clientWidth < element.scrollWidth - 1,
});

const moveFocus = (event: KeyboardEvent<HTMLUListElement>) => {
	const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
	const items = Array.from(event.currentTarget.children);
	const current = items.findIndex((item) => item.contains(document.activeElement));
	if (step === undefined || current === -1) {
		return;
	}
	const target = items[current + step]?.querySelector<HTMLElement>(FOCUSABLE);
	if (target === null || target === undefined) {
		return;
	}
	event.preventDefault();
	target.focus();
};

export function Shelf(props: {
	readonly label: string;
	readonly compact: boolean;
	readonly children: ReactNode;
	readonly className?: string | undefined;
	readonly icons: { readonly next: ReactNode; readonly previous: ReactNode };
}) {
	const scroller = useRef<HTMLUListElement>(null);
	const [edges, setEdges] = useState({ end: false, start: false });
	const measure = useCallback(() => {
		if (scroller.current === null) {
			return;
		}
		const next = scrollEdges(scroller.current);
		setEdges((current) =>
			current.start === next.start && current.end === next.end ? current : next,
		);
	}, []);

	useEffect(() => {
		measure();
	});

	useEffect(() => {
		window.addEventListener("resize", measure);
		return () => window.removeEventListener("resize", measure);
	}, [measure]);

	const page = (direction: 1 | -1) => {
		const element = scroller.current;
		element?.scrollBy({ behavior: "smooth", left: direction * element.clientWidth * 0.85 });
	};

	const control = (direction: 1 | -1, visible: boolean) =>
		props.compact ? null : (
			<IconButton
				size="sm"
				tone="filled"
				tabIndex={-1}
				aria-hidden="true"
				onClick={() => page(direction)}
				label={direction === 1 ? "Scroll forward" : "Scroll back"}
				className={clsx(
					"absolute top-1/3 z-10 -translate-y-1/2 shadow-card transition-opacity duration-150 motion-reduce:transition-none",
					direction === 1 ? "-right-3" : "-left-3",
					visible
						? "opacity-0 group-hover/shelf:opacity-100 group-focus-within/shelf:opacity-100"
						: "pointer-events-none opacity-0",
				)}
			>
				{direction === 1 ? props.icons.next : props.icons.previous}
			</IconButton>
		);

	return (
		<div className={clsx("group/shelf relative", props.className)}>
			{control(-1, edges.start)}
			<ul
				ref={scroller}
				onScroll={measure}
				onKeyDown={moveFocus}
				aria-label={props.label}
				className={clsx(
					"flex snap-x snap-proximity overflow-x-auto overscroll-x-contain pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
					props.compact ? "-mx-4 scroll-px-4 gap-3 px-4" : "gap-4",
				)}
			>
				{Children.map(props.children, (child) => (
					<li className="shrink-0 snap-start">{child}</li>
				))}
			</ul>
			{control(1, edges.end)}
		</div>
	);
}
