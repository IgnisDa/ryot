import { Menu as BaseMenu } from "@base-ui/react/menu";
import type { Text } from "@ryot-app/i18n/text";
import type { HotkeyChord } from "@tanstack/react-hotkeys";
import clsx from "clsx";
import { type ReactElement, type ReactNode, useRef, useState } from "react";

import { AppIcon } from "./icon";
import { ShortcutScopeContext, useOverlayScope, useShortcut } from "./shortcut";

export type MenuItem = {
	readonly key: string;
	readonly label: Text;
	readonly icon?: string;
	readonly title?: string;
	readonly checked?: boolean;
	readonly disabled?: boolean;
	readonly content?: ReactNode;
	readonly onSelect: () => void;
	readonly destructive?: boolean;
	readonly accessibleLabel?: Text;
};

export function Menu(props: {
	readonly label: Text;
	readonly open?: boolean;
	readonly className?: string;
	readonly trigger: ReactElement;
	readonly checkIcon?: ReactNode;
	readonly shortcut?: HotkeyChord;
	readonly note?: Text | undefined;
	readonly align?: "end" | "start";
	readonly focusSelected?: boolean;
	readonly matchTriggerWidth?: boolean;
	readonly onSelectAfterClose?: boolean;
	readonly items: ReadonlyArray<MenuItem>;
	readonly onOpenChange?: (open: boolean) => void;
}) {
	const [internalOpen, setInternalOpen] = useState(false);
	const open = props.open ?? internalOpen;
	const onOpenChange = props.onOpenChange ?? setInternalOpen;
	const actions = useRef<BaseMenu.Root.Actions>(null);
	const selectedItem = useRef<HTMLElement>(null);
	const pendingSelection = useRef<null | (() => void)>(null);
	const overlay = useOverlayScope(open, () => actions.current?.close());
	const focusSelected = () => selectedItem.current?.focus();
	const checkedKey = props.items.find((item) => item.checked === true)?.key;
	const items = props.items.map((item) => {
		const itemProps = {
			label: item.label,
			title: item.title,
			disabled: item.disabled,
			"aria-label": item.accessibleLabel,
			onClick: () => {
				if (props.onSelectAfterClose === true) {
					pendingSelection.current = item.onSelect;
				} else {
					item.onSelect();
				}
			},
			className: clsx(
				"flex min-h-8 w-full cursor-default items-center gap-2 rounded-sm px-2.5 py-1.5 text-left text-sm outline-none data-highlighted:bg-hover data-disabled:text-text-subtle pointer-coarse:min-h-11",
				item.destructive === true ? "text-danger" : "text-text",
			),
			children: item.content ?? (
				<>
					{item.icon === undefined ? null : (
						<AppIcon size={16} name={item.icon} className="shrink-0 text-text-muted" />
					)}
					<span className="min-w-0 flex-1 truncate">{item.label}</span>
					{item.checked === true && (
						<span aria-hidden="true" className="shrink-0 text-accent-text">
							{props.checkIcon}
						</span>
					)}
				</>
			),
		};
		return item.checked === undefined ? (
			<BaseMenu.Item key={item.key} {...itemProps} />
		) : (
			<BaseMenu.RadioItem
				closeOnClick
				key={item.key}
				value={item.key}
				ref={item.checked && !item.disabled ? selectedItem : undefined}
				{...itemProps}
			/>
		);
	});
	return (
		<BaseMenu.Root
			loopFocus
			open={open}
			modal={false}
			actionsRef={actions}
			onOpenChange={(next) => onOpenChange(next)}
			onOpenChangeComplete={(opened) => {
				if (opened) {
					if (props.focusSelected) {
						focusSelected();
					}
					return;
				}
				const select = pendingSelection.current;
				pendingSelection.current = null;
				if (select !== null) {
					requestAnimationFrame(select);
				}
			}}
		>
			<BaseMenu.Trigger render={props.trigger} />
			{props.shortcut !== undefined && (
				<MenuShortcut shortcut={props.shortcut} activate={() => onOpenChange(true)} />
			)}
			<BaseMenu.Portal>
				<ShortcutScopeContext value={overlay.scope}>
					{props.shortcut !== undefined && props.focusSelected === true && (
						<MenuShortcut activate={focusSelected} shortcut={props.shortcut} />
					)}
					<BaseMenu.Positioner
						sideOffset={4}
						className="z-50"
						collisionPadding={8}
						align={props.align ?? "end"}
					>
						<BaseMenu.Popup
							aria-label={props.label}
							className={clsx(
								"flex max-h-(--available-height) max-w-(--available-width) flex-col overflow-y-auto overscroll-contain rounded-lg border border-border bg-raised p-1 shadow-card outline-none",
								props.matchTriggerWidth ? "w-(--anchor-width)" : "w-56",
								props.className,
							)}
						>
							{props.items.some((item) => item.checked !== undefined) ? (
								<BaseMenu.RadioGroup value={checkedKey ?? null}>{items}</BaseMenu.RadioGroup>
							) : (
								items
							)}
							{props.note !== undefined && (
								<p className="mt-1 border-t border-border px-2.5 pt-2 pb-1 text-xs text-text-subtle">
									{props.note}
								</p>
							)}
						</BaseMenu.Popup>
					</BaseMenu.Positioner>
				</ShortcutScopeContext>
			</BaseMenu.Portal>
		</BaseMenu.Root>
	);
}

function MenuShortcut(props: { readonly activate: () => void; readonly shortcut: HotkeyChord }) {
	useShortcut(props.shortcut, props.activate);
	return null;
}
