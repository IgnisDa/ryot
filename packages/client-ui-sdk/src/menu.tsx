import clsx from "clsx";
import {
	useEffect,
	useEffectEvent,
	useLayoutEffect,
	useRef,
	useState,
	type KeyboardEvent,
	type RefObject,
} from "react";
import { createPortal } from "react-dom";

import { useDismissOnOutside } from "./overlay";
import { OverlayScope } from "./shortcut";

const MENU_GAP = 4;
const MENU_WIDTH = 224;
const VIEWPORT_PADDING = 8;

export type MenuItem = {
	readonly key: string;
	readonly label: string;
	readonly disabled?: boolean;
	readonly destructive?: boolean;
	readonly onSelect: () => void;
};

type MenuProps = {
	readonly id?: string;
	readonly note?: string;
	readonly label: string;
	readonly className?: string;
	readonly activeIndex: number;
	readonly items: ReadonlyArray<MenuItem>;
	readonly onInterceptBack?: () => boolean;
	readonly onClose: (restoreFocus: boolean) => void;
	readonly onActiveIndexChange: (index: number) => void;
	readonly triggerRef: RefObject<HTMLElement | null>;
};

const enabledIndices = (items: ReadonlyArray<MenuItem>) =>
	items.flatMap((item, index) => (item.disabled === true ? [] : [index]));

export function Menu({
	id,
	note,
	label,
	items,
	onClose,
	className,
	triggerRef,
	activeIndex,
	onInterceptBack,
	onActiveIndexChange,
}: MenuProps) {
	const menuRef = useRef<HTMLDivElement>(null);
	const menuItems = useRef<Array<HTMLButtonElement | null>>([]);
	const [position, setPosition] = useState({ top: 0, left: 0 });
	const close = useEffectEvent((restoreFocus: boolean) => {
		if (onInterceptBack?.() === true) {
			return;
		}
		onClose(restoreFocus);
	});

	useLayoutEffect(() => {
		const updatePosition = () => {
			const trigger = triggerRef.current;
			const menu = menuRef.current;
			if (trigger === null || menu === null) {
				return;
			}
			const triggerRect = trigger.getBoundingClientRect();
			const menuRect = menu.getBoundingClientRect();
			const viewportWidth = Math.max(window.innerWidth, document.documentElement.clientWidth);
			const viewportHeight = Math.max(window.innerHeight, document.documentElement.clientHeight);
			const menuWidth =
				menuRect.width || Math.min(MENU_WIDTH, viewportWidth - VIEWPORT_PADDING * 2);
			const menuHeight = menuRect.height;
			const maxLeft = Math.max(VIEWPORT_PADDING, viewportWidth - menuWidth - VIEWPORT_PADDING);
			const left = Math.min(Math.max(triggerRect.right - menuWidth, VIEWPORT_PADDING), maxLeft);
			const below = triggerRect.bottom + MENU_GAP;
			const above = triggerRect.top - menuHeight - MENU_GAP;
			const maxTop = Math.max(VIEWPORT_PADDING, viewportHeight - menuHeight - VIEWPORT_PADDING);
			const top =
				above >= VIEWPORT_PADDING && below + menuHeight > viewportHeight - VIEWPORT_PADDING
					? above
					: Math.min(Math.max(below, VIEWPORT_PADDING), maxTop);
			setPosition({ top, left });
		};

		updatePosition();
		window.addEventListener("resize", updatePosition);
		document.addEventListener("scroll", updatePosition, true);
		return () => {
			window.removeEventListener("resize", updatePosition);
			document.removeEventListener("scroll", updatePosition, true);
		};
	}, [triggerRef]);

	useEffect(() => {
		const indices = enabledIndices(items);
		const index = items[activeIndex]?.disabled === true ? indices.at(0) : activeIndex;
		if (index === undefined) {
			return;
		}
		if (index === activeIndex) {
			menuItems.current[index]?.focus();
			return;
		}
		onActiveIndexChange(index);
	}, [activeIndex, items, onActiveIndexChange]);

	useDismissOnOutside([menuRef, triggerRef], () => close(false), { enabled: true });

	const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		const indices = enabledIndices(items);
		if (indices.length === 0) {
			return;
		}
		let index: number | undefined;
		if (event.key === "Home") {
			index = indices[0];
		} else if (event.key === "End") {
			index = indices.at(-1);
		} else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
			const current = Math.max(0, indices.indexOf(activeIndex));
			const offset = event.key === "ArrowDown" ? 1 : -1;
			index = indices[(current + offset + indices.length) % indices.length];
		}
		if (index !== undefined) {
			event.preventDefault();
			onActiveIndexChange(index);
		}
	};

	return createPortal(
		<OverlayScope onEscape={() => close(true)}>
			<div
				id={id}
				role="menu"
				ref={menuRef}
				aria-label={label}
				onKeyDown={onKeyDown}
				style={{ top: position.top, left: position.left }}
				className={clsx(
					"fixed z-50 flex max-h-[calc(100vh-1rem)] w-56 max-w-[calc(100vw-1rem)] flex-col overflow-y-auto rounded-xl border border-border bg-surface p-1.5 shadow-card",
					className,
				)}
				onBlur={(event) => {
					const relatedTarget = event.relatedTarget;
					if (
						!(relatedTarget instanceof Node) ||
						(!event.currentTarget.contains(relatedTarget) &&
							triggerRef.current?.contains(relatedTarget) !== true)
					) {
						close(false);
					}
				}}
			>
				{items.map((item, index) => (
					<button
						type="button"
						key={item.key}
						role="menuitem"
						onClick={item.onSelect}
						disabled={item.disabled}
						tabIndex={index === activeIndex ? 0 : -1}
						onFocus={() => onActiveIndexChange(index)}
						ref={(element) => {
							menuItems.current[index] = element;
						}}
						className={clsx(
							"flex min-h-10 w-full items-center rounded-lg px-3 py-2 text-left text-sm font-semibold hover:bg-surface-2 focus-visible:bg-surface-2",
							item.destructive === true ? "text-danger" : "text-text",
							"disabled:text-text-subtle",
						)}
					>
						{item.label}
					</button>
				))}
				{note !== undefined && (
					<p className="border-t border-border px-3 pt-2 pb-1 text-xs text-text-subtle">{note}</p>
				)}
			</div>
		</OverlayScope>,
		document.body,
	);
}
