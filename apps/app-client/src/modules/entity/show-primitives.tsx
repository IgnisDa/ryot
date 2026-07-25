import clsx from "clsx";
import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";

import { AppIcon } from "@/modules/icons";

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
					<Text className="font-ui text-[13px] text-text-subtle">{props.suffix}</Text>
				)}
			</Text>
			<Text className="font-ui text-[12px] text-text-subtle">{props.label}</Text>
		</View>
	);
}

export function ShowFactDivider() {
	return <View className="h-9 w-px bg-border" />;
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

export function ShowDetailRow(props: { readonly label: string; readonly value: string }) {
	return (
		<View className="flex-row items-start justify-between gap-4 py-1.5">
			<Text className="font-ui text-[13px] text-text-subtle">{props.label}</Text>
			<Text className="max-w-[60%] text-right font-ui text-[13px] text-text">{props.value}</Text>
		</View>
	);
}

export function ShowSection(props: {
	readonly title: string;
	readonly action?: ReactNode;
	readonly children: ReactNode;
}) {
	return (
		<View className="gap-2 rounded-lg border border-border bg-surface p-4">
			<View className="flex-row items-center justify-between gap-3">
				<Text className="font-display-semibold text-lg text-text">{props.title}</Text>
				{props.action}
			</View>
			{props.children}
		</View>
	);
}

export function ShowLinkButton(props: { readonly label: string; readonly onPress: () => void }) {
	return (
		<Pressable accessibilityRole="button" onPress={props.onPress}>
			<Text className="font-ui-medium text-[13px] text-accent-text">{props.label}</Text>
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
		<View className="min-h-96 items-center justify-center gap-3 px-6">
			<Text className="font-ui-medium text-base text-text">{props.title}</Text>
			<Text className="max-w-xl text-center font-ui text-sm text-text-muted">{props.detail}</Text>
			{props.onRetry ? <ShowLinkButton label="Try again" onPress={props.onRetry} /> : null}
		</View>
	);
}
