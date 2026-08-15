import clsx from "clsx";
import { router, usePathname } from "expo-router";
import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";

import { AppIcon } from "@/modules/icons";
import { activeSectionSlug, type SectionNavItem } from "@/modules/ui/sections";

export function SectionNavList(props: {
	readonly showDisclosure: boolean;
	readonly active: string | null;
	readonly sections: readonly SectionNavItem[];
	readonly onSelect: (section: SectionNavItem) => void;
}) {
	return (
		<View className="gap-1">
			{props.sections.map((section) => {
				const isActive = section.slug === props.active;
				return (
					<Pressable
						key={section.slug}
						accessibilityRole="button"
						accessibilityLabel={section.label}
						onPress={() => props.onSelect(section)}
						accessibilityState={{ selected: isActive }}
						className={clsx(
							"min-h-11 flex-row items-center gap-3 rounded-lg px-3",
							isActive && "bg-nav-indicator",
						)}
					>
						<AppIcon className="text-text-muted" name={section.icon} size={17} />
						<Text
							className={clsx(
								"flex-1 font-ui text-sm",
								isActive ? "font-ui-medium text-text" : "text-text-muted",
							)}
						>
							{section.label}
						</Text>
						{props.showDisclosure ? (
							<AppIcon className="text-text-subtle" name="chevron-right" size={15} />
						) : null}
					</Pressable>
				);
			})}
		</View>
	);
}

export function SectionSidebarLayout(props: {
	readonly title: string;
	readonly footer?: ReactNode;
	readonly children: ReactNode;
	readonly fallbackSlug: string;
	readonly sections: readonly SectionNavItem[];
}) {
	const pathname = usePathname();
	const active = activeSectionSlug(pathname, props.sections, props.fallbackSlug);

	return (
		<View className="flex-1 flex-row bg-bg">
			<View className="hidden w-60 shrink-0 border-r border-border bg-surface px-4 py-8 md:flex">
				<Text className="mb-6 px-3 font-display-semibold text-2xl text-text">{props.title}</Text>
				<SectionNavList
					active={active}
					showDisclosure={false}
					sections={props.sections}
					onSelect={(section) => router.replace(section.href)}
				/>
				{props.footer ? <View className="mt-auto">{props.footer}</View> : null}
			</View>
			<View className="min-w-0 flex-1">{props.children}</View>
		</View>
	);
}
