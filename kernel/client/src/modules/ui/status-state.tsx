import clsx from "clsx";
import type { ReactNode } from "react";
import { Text, View } from "react-native";

export function AppStatusState(props: {
	readonly title?: string;
	readonly detail?: string;
	readonly icon?: ReactNode;
	readonly action?: ReactNode;
	readonly className?: string;
	readonly titleSize?: "default" | "large";
	readonly detailTone?: "default" | "danger";
}) {
	return (
		<View className={clsx("items-center justify-center gap-3 px-6", props.className)}>
			{props.icon}
			{props.title === undefined ? null : (
				<Text
					className={clsx(
						"text-center text-text",
						props.titleSize === "large" ? "font-ui-semibold text-xl" : "font-ui-medium text-base",
					)}
				>
					{props.title}
				</Text>
			)}
			{props.detail === undefined ? null : (
				<Text
					className={clsx(
						"max-w-xl text-center font-ui text-sm",
						props.detailTone === "danger" ? "text-danger" : "text-text-muted",
					)}
				>
					{props.detail}
				</Text>
			)}
			{props.action}
		</View>
	);
}
