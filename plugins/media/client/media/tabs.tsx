import clsx from "clsx";

export type MediaTab<Key extends string> = { readonly key: Key; readonly label: string };

export function MediaTabBar<Key extends string>(props: {
	readonly compact: boolean;
	readonly activeTab: Key;
	readonly tabs: readonly MediaTab<Key>[];
	readonly onSelect: (tab: Key) => void;
}) {
	return (
		<div
			role="tablist"
			className={clsx("flex border-b border-border", !props.compact && "justify-start gap-2")}
		>
			{props.tabs.map((tab) => {
				const isActive = tab.key === props.activeTab;
				return (
					<button
						role="tab"
						key={tab.key}
						type="button"
						aria-selected={isActive}
						onClick={() => props.onSelect(tab.key)}
						className={clsx(
							"flex items-center justify-center border-b-2 px-3 pb-2.5 pt-3",
							props.compact ? "flex-1" : "flex-none",
							isActive ? "border-accent" : "border-transparent",
						)}
					>
						<span
							className={clsx(
								"font-ui font-medium text-[14px]",
								isActive ? "text-accent-text" : "text-text-muted",
							)}
						>
							{tab.label}
						</span>
					</button>
				);
			})}
		</div>
	);
}
