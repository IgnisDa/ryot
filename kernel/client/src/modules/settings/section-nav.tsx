import { AppIcon } from "@ryot-app/client-ui-sdk/icon";
import clsx from "clsx";

import { activateLink } from "#/modules/navigation/link-activation";
import {
	settingsGroups,
	type SettingsSection,
	type SettingsSectionSlug,
} from "#/modules/settings/sections";

type SettingsSectionNavProps = {
	readonly variant: "sidebar" | "index";
	readonly active: SettingsSectionSlug | null;
	readonly onSelect: (section: SettingsSection) => void | Promise<void>;
};

export function SettingsSectionNav(props: SettingsSectionNavProps) {
	const isIndex = props.variant === "index";
	return (
		<div className={clsx("flex flex-col", isIndex ? "gap-6" : "gap-4")}>
			{settingsGroups.map((group) => (
				<div
					role="group"
					key={group.label}
					aria-label={group.label}
					className={clsx("flex flex-col", isIndex ? "gap-2" : "gap-1")}
				>
					<span
						className={clsx(
							"text-[11px] font-medium uppercase tracking-[0.8px] text-text-subtle",
							isIndex ? "px-4" : "px-3",
						)}
					>
						{group.label}
					</span>
					<div
						className={clsx(
							"flex flex-col",
							isIndex
								? "divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface"
								: "gap-1",
						)}
					>
						{group.sections.map((section) => {
							const isActive = section.slug === props.active;
							return (
								<a
									key={section.slug}
									href={section.path}
									aria-current={isActive ? "page" : undefined}
									onClick={activateLink(() => props.onSelect(section))}
									className={clsx(
										"flex items-center gap-3 text-sm",
										isIndex ? "min-h-13 px-4" : "min-h-11 rounded-lg px-3",
										isActive && "bg-nav-indicator text-text",
										!isActive && "hover:bg-surface-2",
										!isActive && (isIndex ? "text-text" : "text-text-muted"),
									)}
								>
									<AppIcon size={17} name={section.icon} className="text-text-muted" />
									<span className="flex-1">{section.label}</span>
									{isIndex && (
										<AppIcon size={15} name="chevron-right" className="text-text-subtle" />
									)}
								</a>
							);
						})}
					</div>
				</div>
			))}
		</div>
	);
}
