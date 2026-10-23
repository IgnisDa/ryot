import clsx from "clsx";
import { type ReactNode, useId } from "react";

export function Tooltip(props: {
	readonly content: string;
	readonly shortcut?: string;
	readonly className?: string;
	readonly children: (describedBy: string) => ReactNode;
}) {
	const id = useId();
	return (
		<span className={clsx("group/tooltip relative inline-flex", props.className)}>
			{props.children(id)}
			<span
				id={id}
				role="tooltip"
				className="pointer-events-none absolute bottom-full left-1/2 z-40 mb-1.5 flex -translate-x-1/2 items-center gap-1.5 rounded-sm bg-text px-2 py-1 text-xs font-medium whitespace-nowrap text-bg opacity-0 transition-opacity delay-300 duration-100 group-focus-within/tooltip:opacity-100 group-hover/tooltip:opacity-100 motion-reduce:transition-none pointer-coarse:hidden"
			>
				{props.content}
				{props.shortcut !== undefined && (
					<span className="font-mono text-[11px] opacity-70">{props.shortcut}</span>
				)}
			</span>
		</span>
	);
}
