import clsx from "clsx";
import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";

import { AppIcon } from "@/modules/icons";
import { AppStatusState } from "@/modules/ui/status-state";

export function ShowChip(props: { readonly label: string }) {
	return (
		<View className="rounded-pill border border-border bg-surface-2 px-2.5 py-1">
			<Text className="font-ui text-[12px] text-text-muted">{props.label}</Text>
		</View>
	);
}

export function ShowFact(props: {
	readonly label: string;
	readonly value: string;
	readonly suffix?: string;
}) {
	return (
		<View className="min-w-20">
			<Text className="font-ui-semibold text-[15px] text-text">
				{props.value}
				{props.suffix === undefined ? null : (
					<Text className="font-ui text-[13px]">{props.suffix}</Text>
				)}
			</Text>
			<Text className="font-ui text-[12px] text-text">{props.label}</Text>
		</View>
	);
}

export function ShowFactDivider() {
	return <View className="h-9 w-px bg-border" />;
}

export function ShowProgressBar(props: { readonly percent: number }) {
	return (
		<View className="h-1 max-w-md overflow-hidden rounded-pill bg-surface-2">
			<View className="h-full rounded-pill bg-success" style={{ width: `${props.percent}%` }} />
		</View>
	);
}

export function ShowRailRow(props: {
	readonly icon: string;
	readonly title: string;
	readonly detail?: string;
	readonly divided?: boolean;
	readonly trailing?: ReactNode;
}) {
	return (
		<View
			className={clsx("gap-2.5 px-4 py-3.5", props.divided !== false && "border-b border-border")}
		>
			<View className="flex-row items-center gap-3">
				<View className="md:hidden">
					<AppIcon name={props.icon} size={18} className="text-text-subtle" />
				</View>
				<View className="min-w-0 flex-1">
					<Text className="font-ui-medium text-[14px] text-text">{props.title}</Text>
					{props.detail === undefined ? null : (
						<Text className="font-ui text-[12px] text-text-subtle">{props.detail}</Text>
					)}
				</View>
				{props.trailing}
			</View>
		</View>
	);
}

export function ShowOverviewSection(props: {
	readonly title: string;
	readonly divided?: boolean;
	readonly action?: ReactNode;
	readonly className?: string;
	readonly children: ReactNode;
}) {
	return (
		<View
			className={clsx(props.divided !== false && "border-t border-border pt-5", props.className)}
		>
			<View className="flex-row items-center justify-between gap-3 pb-4">
				<Text className="font-display-semibold text-[17px] text-text md:text-xl">
					{props.title}
				</Text>
				{props.action}
			</View>
			{props.children}
		</View>
	);
}

export function ShowLinkButton(props: {
	readonly label: string;
	readonly onPress: () => void;
	readonly tone?: "accent" | "plain";
}) {
	return (
		<Pressable accessibilityRole="button" onPress={props.onPress}>
			<Text
				className={clsx(
					"font-ui-medium text-[13px]",
					props.tone === "plain" ? "text-text" : "text-accent-text",
				)}
			>
				{props.label}
			</Text>
		</Pressable>
	);
}

export function ShowActionButton(props: {
	readonly label: string;
	readonly onPress: () => void;
	readonly variant: "primary" | "secondary";
}) {
	const isPrimary = props.variant === "primary";
	return (
		<Pressable
			onPress={props.onPress}
			accessibilityRole="button"
			className={clsx(
				"h-12 flex-1 items-center justify-center rounded-md md:h-8 md:w-full md:flex-none",
				isPrimary ? "bg-accent" : "border border-border bg-surface-2",
			)}
		>
			<Text
				className={clsx(
					"font-ui-semibold text-[14px]",
					isPrimary ? "text-accent-ink" : "text-text",
				)}
			>
				{props.label}
			</Text>
		</Pressable>
	);
}

export function ShowStatusMessage(props: {
	readonly title: string;
	readonly detail: string;
	readonly onRetry?: () => void;
}) {
	return (
		<AppStatusState
			title={props.title}
			className="min-h-96"
			detail={props.detail}
			action={
				props.onRetry ? <ShowLinkButton label="Try again" onPress={props.onRetry} /> : undefined
			}
		/>
	);
}
