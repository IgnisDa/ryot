import clsx from "clsx";
import {
	useEffect,
	useRef,
	useState,
	type KeyboardEvent,
	type PointerEvent,
	type ReactNode,
	type RefObject,
} from "react";

import {
	createReorderPositions,
	moveReorderPosition,
	type ReorderPositions,
} from "./reorderable-list-state";

const AUTO_SCROLL_EDGE = 48;
const AUTO_SCROLL_SPEED = 0.5;

const clamp = (value: number, minimum: number, maximum: number) =>
	Math.min(Math.max(value, minimum), maximum);

const edgeDelta = (pointer: number, bounds: DOMRect) => {
	const above = pointer - (bounds.top + AUTO_SCROLL_EDGE);
	if (above < 0) {
		return above;
	}
	const below = pointer - (bounds.bottom - AUTO_SCROLL_EDGE);
	return below > 0 ? below : 0;
};

type Drag = {
	readonly key: string;
	readonly pointerId: number;
	readonly startIndex: number;
	readonly startPointerY: number;
	readonly startScrollTop: number;
};

type ReorderableListProps<T> = {
	readonly label: string;
	readonly itemHeight: number;
	readonly className?: string;
	readonly items: readonly T[];
	readonly onDrop?: () => void;
	readonly handleIcon: ReactNode;
	readonly onPickUp?: () => void;
	readonly itemKey: (item: T) => string;
	readonly itemLabel: (item: T) => string;
	readonly scrollRef?: RefObject<HTMLElement | null>;
	readonly onReorder: (fromIndex: number, toIndex: number) => void;
	readonly renderItem: (state: {
		readonly item: T;
		readonly index: number;
		readonly handle: ReactNode;
		readonly isDragging: boolean;
	}) => ReactNode;
};

export function ReorderableList<T>(props: ReorderableListProps<T>) {
	const pointerY = useRef(0);
	const drag = useRef<Drag | null>(null);
	const [offset, setOffset] = useState(0);
	const frame = useRef<number | null>(null);
	const focusKey = useRef<string | null>(null);
	const [announcement, setAnnouncement] = useState("");
	const [dragKey, setDragKey] = useState<string | null>(null);
	const [positions, setPositions] = useState<ReorderPositions>({});
	const handles = useRef(new Map<string, HTMLButtonElement | null>());
	const count = props.items.length;

	useEffect(() => {
		const key = focusKey.current;
		if (key === null) {
			return;
		}
		focusKey.current = null;
		handles.current.get(key)?.focus();
	}, [props.items]);

	useEffect(
		() => () => {
			if (frame.current !== null) {
				cancelAnimationFrame(frame.current);
			}
		},
		[],
	);

	const track = (clientY: number) => {
		const active = drag.current;
		const scroller = props.scrollRef?.current ?? null;
		if (active === null) {
			return;
		}
		const scrollTop = scroller?.scrollTop ?? active.startScrollTop;
		const travel = clientY - active.startPointerY + scrollTop - active.startScrollTop;
		const position = clamp(
			active.startIndex * props.itemHeight + travel,
			0,
			(count - 1) * props.itemHeight,
		);
		setOffset(position);
		const nextIndex = clamp(Math.round(position / props.itemHeight), 0, count - 1);
		setPositions((current) => {
			const currentIndex = current[active.key] ?? active.startIndex;
			return currentIndex === nextIndex
				? current
				: moveReorderPosition({ positions: current, toIndex: nextIndex, fromIndex: currentIndex });
		});
	};

	const autoScroll = () => {
		const scroller = props.scrollRef?.current ?? null;
		if (drag.current === null || scroller === null) {
			frame.current = null;
			return;
		}
		const delta = edgeDelta(pointerY.current, scroller.getBoundingClientRect());
		if (delta !== 0) {
			scroller.scrollTop = clamp(
				scroller.scrollTop + delta * AUTO_SCROLL_SPEED,
				0,
				scroller.scrollHeight - scroller.clientHeight,
			);
			track(pointerY.current);
		}
		frame.current = requestAnimationFrame(autoScroll);
	};

	const start = (event: PointerEvent<HTMLButtonElement>, key: string, index: number) => {
		if (event.button !== 0 && event.pointerType === "mouse") {
			return;
		}
		event.preventDefault();
		event.currentTarget.focus();
		event.currentTarget.setPointerCapture(event.pointerId);
		pointerY.current = event.clientY;
		drag.current = {
			key,
			startIndex: index,
			pointerId: event.pointerId,
			startPointerY: event.clientY,
			startScrollTop: props.scrollRef?.current?.scrollTop ?? 0,
		};
		setDragKey(key);
		setOffset(index * props.itemHeight);
		setPositions(createReorderPositions(props.items.map(props.itemKey)));
		props.onPickUp?.();
		if (props.scrollRef !== undefined && frame.current === null) {
			frame.current = requestAnimationFrame(autoScroll);
		}
	};

	const move = (event: PointerEvent<HTMLButtonElement>) => {
		if (drag.current?.pointerId !== event.pointerId) {
			return;
		}
		pointerY.current = event.clientY;
		track(event.clientY);
	};

	const finish = (event: PointerEvent<HTMLButtonElement>) => {
		const active = drag.current;
		if (active?.pointerId !== event.pointerId) {
			return;
		}
		const toIndex = positions[active.key] ?? active.startIndex;
		drag.current = null;
		if (frame.current !== null) {
			cancelAnimationFrame(frame.current);
			frame.current = null;
		}
		setDragKey(null);
		setPositions({});
		props.onDrop?.();
		if (toIndex !== active.startIndex) {
			focusKey.current = active.key;
			props.onReorder(active.startIndex, toIndex);
		}
	};

	const reorderByKey = (event: KeyboardEvent<HTMLButtonElement>, item: T, index: number) => {
		let toIndex: number | undefined;
		if (event.key === "ArrowUp") {
			toIndex = index - 1;
		} else if (event.key === "ArrowDown") {
			toIndex = index + 1;
		} else if (event.key === "Home") {
			toIndex = 0;
		} else if (event.key === "End") {
			toIndex = count - 1;
		}
		if (toIndex === undefined) {
			return;
		}
		event.preventDefault();
		if (toIndex < 0 || toIndex > count - 1 || toIndex === index) {
			return;
		}
		focusKey.current = props.itemKey(item);
		setAnnouncement(`${props.itemLabel(item)}, position ${toIndex + 1} of ${count}`);
		props.onReorder(index, toIndex);
	};

	return (
		<div className={props.className}>
			<ul
				aria-label={props.label}
				className="relative m-0 list-none p-0"
				style={{ height: count * props.itemHeight }}
			>
				{props.items.map((item, index) => {
					const key = props.itemKey(item);
					const isDragging = key === dragKey;
					const slot = dragKey === null ? index : (positions[key] ?? index);
					return (
						<li
							key={key}
							style={{
								height: props.itemHeight,
								transform: `translateY(${isDragging ? offset : slot * props.itemHeight}px)`,
							}}
							className={clsx(
								"absolute inset-x-0 top-0",
								isDragging
									? "z-10 shadow-card"
									: "motion-safe:transition-transform motion-safe:duration-150",
							)}
						>
							{props.renderItem({
								item,
								index,
								isDragging,
								handle: (
									<button
										type="button"
										onPointerMove={move}
										onPointerUp={finish}
										onPointerCancel={finish}
										aria-label={`Reorder ${props.itemLabel(item)}`}
										onPointerDown={(event) => start(event, key, index)}
										onKeyDown={(event) => reorderByKey(event, item, index)}
										ref={(element) => {
											handles.current.set(key, element);
										}}
										className="flex size-10 shrink-0 touch-none items-center justify-center rounded-md text-text-subtle"
									>
										{props.handleIcon}
									</button>
								),
							})}
						</li>
					);
				})}
			</ul>
			<div aria-live="polite" className="sr-only">
				{announcement}
			</div>
		</div>
	);
}
