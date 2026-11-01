import clsx from "clsx";
import {
	type KeyboardEvent,
	type PointerEvent,
	type ReactNode,
	type RefObject,
	useEffect,
	useRef,
	useState,
} from "react";

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
	readonly itemHeight: number;
	readonly startIndex: number;
	readonly startPointerY: number;
	readonly startScrollTop: number;
	readonly keys: readonly string[];
};

type ReorderableListProps<T> = {
	readonly label: string;
	readonly itemHeight: number;
	readonly className?: string;
	readonly onDrop: () => void;
	readonly items: readonly T[];
	readonly onPickUp: () => void;
	readonly handleIcon: ReactNode;
	readonly itemKey: (item: T) => string;
	readonly itemLabel: (item: T) => string;
	readonly scrollRef?: RefObject<null | HTMLElement>;
	readonly onReorder: (fromIndex: number, toIndex: number) => void;
	readonly renderItem: (state: {
		readonly item: T;
		readonly index: number;
		readonly handle: ReactNode;
		readonly isDragging: boolean;
	}) => ReactNode;
};

const scrollWithin = (scroller: HTMLElement, delta: number) => {
	scroller.scrollTop = clamp(
		scroller.scrollTop + delta * AUTO_SCROLL_SPEED,
		0,
		scroller.scrollHeight - scroller.clientHeight,
	);
};

export function ReorderableList<T>(props: ReorderableListProps<T>) {
	const pointerY = useRef(0);
	const drag = useRef<Drag | null>(null);
	const [offset, setOffset] = useState(0);
	const frame = useRef<null | number>(null);
	const focusKey = useRef<null | string>(null);
	const [announcement, setAnnouncement] = useState("");
	const [dragKey, setDragKey] = useState<null | string>(null);
	const handles = useRef(new Map<string, null | HTMLButtonElement>());
	const count = props.items.length;
	const fromIndex = props.items.findIndex((item) => props.itemKey(item) === dragKey);
	const destination = clamp(Math.round(offset / props.itemHeight), 0, count - 1);

	const { items, itemKey } = props;
	useEffect(() => {
		const key = focusKey.current;
		if (key === null) {
			return;
		}
		focusKey.current = null;
		if (items.some((item) => itemKey(item) === key)) {
			handles.current.get(key)?.focus();
		}
	}, [itemKey, items]);

	const { onDrop, itemHeight } = props;
	useEffect(() => {
		const active = drag.current;
		if (
			active === null ||
			(active.itemHeight === itemHeight &&
				active.keys.length === items.length &&
				items.every((item, index) => itemKey(item) === active.keys[index]))
		) {
			return;
		}
		drag.current = null;
		if (frame.current !== null) {
			cancelAnimationFrame(frame.current);
			frame.current = null;
		}
		setDragKey(null);
		onDrop();
	}, [itemHeight, itemKey, items, onDrop]);

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
	};

	const autoScroll = () => {
		const scroller = props.scrollRef?.current ?? null;
		if (drag.current === null || scroller === null) {
			frame.current = null;
			return;
		}
		const delta = edgeDelta(pointerY.current, scroller.getBoundingClientRect());
		if (delta !== 0) {
			scrollWithin(scroller, delta);
			track(pointerY.current);
		}
		frame.current = requestAnimationFrame(autoScroll);
	};

	const start = (event: PointerEvent<HTMLButtonElement>, key: string, index: number) => {
		if (drag.current !== null || (event.button !== 0 && event.pointerType === "mouse")) {
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
			itemHeight: props.itemHeight,
			startPointerY: event.clientY,
			keys: props.items.map(props.itemKey),
			startScrollTop: props.scrollRef?.current?.scrollTop ?? 0,
		};
		setDragKey(key);
		setOffset(index * props.itemHeight);
		props.onPickUp();
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
		drag.current = null;
		if (frame.current !== null) {
			cancelAnimationFrame(frame.current);
			frame.current = null;
		}
		setDragKey(null);
		props.onDrop();
		if (destination !== active.startIndex) {
			focusKey.current = active.key;
			props.onReorder(active.startIndex, destination);
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
		props.onDrop();
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
					let slot = index;
					if (
						fromIndex !== -1 &&
						fromIndex < destination &&
						index > fromIndex &&
						index <= destination
					) {
						slot -= 1;
					} else if (
						fromIndex !== -1 &&
						fromIndex > destination &&
						index >= destination &&
						index < fromIndex
					) {
						slot += 1;
					}
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
