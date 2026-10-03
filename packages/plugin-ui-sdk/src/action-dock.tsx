import clsx from "clsx";
import type { ReactNode } from "react";

export function ActionDock(props: {
	readonly label: string;
	readonly className?: string | undefined;
	readonly children: ReactNode;
	readonly safeAreaBottom: number;
}) {
	return (
		<div
			role="region"
			aria-label={props.label}
			style={{ bottom: Math.max(12, props.safeAreaBottom + 8) }}
			className={clsx(
				"absolute inset-x-2.5 z-20 rounded-xl border border-border bg-raised p-2.5 text-text shadow-modal",
				props.className,
			)}
		>
			{props.children}
		</div>
	);
}
