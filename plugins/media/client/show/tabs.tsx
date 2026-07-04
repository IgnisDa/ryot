import clsx from "clsx";

export type ShowTabKey = "overview" | "episodes" | "activity";

const SHOW_TABS: readonly { readonly key: ShowTabKey; readonly label: string }[] = [
	{ key: "overview", label: "Overview" },
	{ key: "episodes", label: "Episodes" },
	{ key: "activity", label: "Activity" },
];

export function ShowTabBar(props: {
	readonly compact: boolean;
	readonly activeTab: ShowTabKey;
	readonly onSelect: (tab: ShowTabKey) => void;
}) {
	return (
		<div
			role="tablist"
			className={clsx("flex border-b border-border", !props.compact && "justify-start gap-2")}
		>
			{SHOW_TABS.map((tab) => {
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
