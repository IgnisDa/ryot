import type { ImportRunStatus } from "@ryot/contract/modules/imports/types";
import clsx from "clsx";
import { Text, View } from "react-native";

import { AppIcon } from "@/modules/icons";

import { importRunStatusPill, type ImportRunStatusTone } from "./run-presentation";

const toneClassName: Record<ImportRunStatusTone, string> = {
	info: "text-info",
	danger: "text-danger",
	success: "text-success",
	muted: "text-text-muted",
};

export function ImportStatusPill(props: { readonly status: ImportRunStatus }) {
	const pill = importRunStatusPill(props.status);
	return (
		<View className="h-6 flex-row items-center gap-1.5 rounded-pill border border-border px-2">
			<AppIcon size={12} name={pill.icon} className={toneClassName[pill.tone]} />
			<Text className={clsx("font-ui-medium text-[11px]", toneClassName[pill.tone])}>
				{pill.label}
			</Text>
		</View>
	);
}

export function ImportStatusGlyph(props: { readonly status: ImportRunStatus }) {
	const pill = importRunStatusPill(props.status);
	return (
		<View accessibilityRole="image" accessibilityLabel={pill.label}>
			<AppIcon size={16} name={pill.icon} className={toneClassName[pill.tone]} />
		</View>
	);
}
