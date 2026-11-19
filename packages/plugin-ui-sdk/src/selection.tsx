import { useT } from "@ryot-app/i18n/react";
import type { Text } from "@ryot-app/i18n/text";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
import clsx from "clsx";
import type { ReactNode } from "react";

import { ActionDock } from "./action-dock";
import { Button } from "./button";

export type ItemSelection = {
	readonly toggle: (id: string) => void;
	readonly isSelected: (id: string) => boolean;
};

type SelectionAction = {
	readonly label: Text;
	readonly icon: ReactNode;
	readonly run: () => void;
	readonly danger?: boolean | undefined;
};

export function SelectableItem({
	id,
	label,
	children,
	selection,
	className,
}: {
	readonly id: string;
	readonly label: Text;
	readonly children: ReactNode;
	readonly className?: string | undefined;
	readonly selection: undefined | ItemSelection;
}) {
	const t = useT();
	if (selection === undefined) {
		return children;
	}
	const selected = selection.isSelected(id);
	return (
		<div className={clsx("relative min-w-0", className)}>
			<div inert>{children}</div>
			<button
				type="button"
				role="checkbox"
				aria-checked={selected}
				onClick={() => selection.toggle(id)}
				aria-label={t(kernelMessage("ui.selection.select-item", { name: label }))}
				className={clsx(
					"absolute inset-0 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-focus",
					selected && "bg-accent-soft/40 ring-2 ring-accent-border",
				)}
			>
				<SelectionMark selected={selected} className="absolute top-2 left-2" />
			</button>
		</div>
	);
}

export function SelectionBar({
	busy,
	label,
	extend,
	onExit,
	actions,
	disabled,
	safeAreaBottom,
}: {
	readonly label: Text;
	readonly disabled: boolean;
	readonly onExit: () => void;
	readonly safeAreaBottom: number;
	readonly busy?: string | undefined;
	readonly actions: readonly SelectionAction[];
	readonly extend?: undefined | { readonly label: Text; readonly run: () => void };
}) {
	const t = useT();
	return (
		<ActionDock safeAreaBottom={safeAreaBottom} label={t(kernelMessage("ui.selection.label"))}>
			<div className="flex flex-wrap items-center gap-2">
				<div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
					<span role="status" className="text-sm font-semibold text-text">
						{busy ?? label}
					</span>
					{extend !== undefined && busy === undefined ? (
						<Button variant="link" onClick={extend.run}>
							{extend.label}
						</Button>
					) : null}
				</div>
				{actions.map((action) => (
					<Button
						key={action.label}
						onClick={action.run}
						disabled={disabled || busy !== undefined}
						variant={action.danger ? "dangerGhost" : "secondary"}
					>
						{action.icon}
						{action.label}
					</Button>
				))}
				<Button variant="ghost" onClick={onExit}>
					{t(kernelMessage("common.action.done"))}
				</Button>
			</div>
		</ActionDock>
	);
}

function SelectionMark({
	selected,
	className,
}: {
	readonly selected: boolean;
	readonly className?: string;
}) {
	return (
		<span
			aria-hidden="true"
			className={clsx(
				"grid size-6 shrink-0 place-items-center rounded-pill border-2 shadow-sm",
				selected ? "border-accent-deep bg-accent-deep" : "border-border-strong bg-raised/90",
				className,
			)}
		>
			<span
				className={clsx(
					"mb-0.5 h-2.5 w-1.5 rotate-45 border-r-2 border-b-2 border-surface",
					!selected && "opacity-0",
				)}
			/>
		</span>
	);
}
