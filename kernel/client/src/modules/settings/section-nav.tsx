import clsx from "clsx";

import { AppIcon } from "#/modules/navigation/app-icon";
import { activateLink } from "#/modules/navigation/link-activation";
import {
	settingsSections,
	type SettingsSection,
	type SettingsSectionSlug,
} from "#/modules/settings/sections";

type SettingsSectionNavProps = {
	readonly showDisclosure: boolean;
	readonly active: SettingsSectionSlug | null;
	readonly onSelect: (section: SettingsSection) => void | Promise<void>;
};

export function SettingsSectionNav(props: SettingsSectionNavProps) {
	return (
		<div className="flex flex-col gap-1">
			{settingsSections.map((section) => {
				const isActive = section.slug === props.active;
				return (
					<a
						key={section.slug}
						href={section.path}
						aria-current={isActive ? "page" : undefined}
						onClick={activateLink(() => props.onSelect(section))}
						className={clsx(
							"flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm",
							isActive ? "bg-nav-indicator text-text" : "text-text-muted hover:bg-surface-2",
						)}
					>
						<AppIcon name={section.icon} size={17} className="text-text-muted" />
						<span className="flex-1">{section.label}</span>
						{props.showDisclosure && (
							<AppIcon name="chevron-right" size={15} className="text-text-subtle" />
						)}
					</a>
				);
			})}
		</div>
	);
}
