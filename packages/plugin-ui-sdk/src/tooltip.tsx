import type { HotkeyChord } from "@tanstack/react-hotkeys";
import clsx from "clsx";
import { type ReactNode, useId } from "react";

import { ShortcutKeys } from "./shortcut-hint";

export function Tooltip(props: {
	readonly content?: string;
	readonly className?: string;
	readonly shortcut?: HotkeyChord;
	readonly children: (describedBy: string | undefined) => ReactNode;
}) {
	const id = useId();
	const describedBy = props.content === undefined ? undefined : id;
	return (
		<span className={clsx("group/tooltip relative inline-flex", props.className)}>
			{props.children(describedBy)}
			<span
				id={describedBy}
				role={describedBy === undefined ? undefined : "tooltip"}
				aria-hidden={describedBy === undefined ? true : undefined}
				className="pointer-events-none absolute bottom-full left-1/2 z-40 mb-1.5 flex -translate-x-1/2 items-center gap-1.5 rounded-sm bg-text px-2 py-1 text-xs font-medium whitespace-nowrap text-bg opacity-0 transition-opacity delay-300 duration-100 group-focus-within/tooltip:opacity-100 group-hover/tooltip:opacity-100 motion-reduce:transition-none pointer-coarse:hidden"
			>
				{props.content}
				{props.shortcut !== undefined && (
					<span className="inline-flex items-center gap-0.5 font-mono text-micro opacity-70">
						<ShortcutKeys shortcut={props.shortcut} />
					</span>
				)}
			</span>
		</span>
	);
}
