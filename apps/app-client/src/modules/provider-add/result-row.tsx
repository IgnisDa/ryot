import { Match } from "effect";
import { ActivityIndicator, Pressable, Text, View } from "react-native";

import { AppIcon } from "@/modules/icons";
import { MissingImage, RemoteImage } from "@/modules/ui/image-with-fallback";

import type { ProviderEntityImportEntry } from "./import-controller";
import { describeProviderSearchItem } from "./result-display";
import type { ProviderSearchItem } from "./search-controller";

const IMAGE_CLASS_NAME = "h-16 w-11 shrink-0 overflow-hidden rounded-md";

function ResultImage(props: { url: string | undefined }) {
	if (props.url === undefined) {
		return <MissingImage className={IMAGE_CLASS_NAME} />;
	}
	return <RemoteImage className={IMAGE_CLASS_NAME} url={props.url} />;
}

function InLibraryBadge() {
	return (
		<View className="flex-row items-center gap-1.5">
			<AppIcon className="text-text-muted" name="check" size={14} />
			<Text className="font-ui text-xs text-text-muted">In library</Text>
		</View>
	);
}

function ResultAction(props: {
	readonly title: string;
	readonly isLinked: boolean;
	readonly onAdd: () => void;
	readonly entry: ProviderEntityImportEntry;
}) {
	if (props.isLinked) {
		return <InLibraryBadge />;
	}
	return Match.value(props.entry).pipe(
		Match.when({ status: "imported" }, () => <InLibraryBadge />),
		Match.when({ status: "importing" }, () => (
			<ActivityIndicator accessibilityLabel="Adding to library" size="small" />
		)),
		Match.when({ status: "failed" }, () => (
			<Pressable
				onPress={props.onAdd}
				accessibilityRole="button"
				accessibilityLabel={`Retry adding ${props.title}`}
			>
				<Text className="font-ui-medium text-xs text-accent-text">Retry</Text>
			</Pressable>
		)),
		Match.when({ status: "idle" }, () => (
			<Pressable
				onPress={props.onAdd}
				accessibilityRole="button"
				accessibilityLabel={`Add ${props.title}`}
				className="h-7 shrink-0 flex-row items-center gap-1 rounded-pill bg-accent-soft px-2.5 md:rounded-md md:border md:border-border-strong md:bg-transparent md:px-3"
			>
				<AppIcon className="text-accent-text md:hidden" name="plus" size={13} />
				<Text className="font-ui-medium text-xs text-accent-text md:text-text">Add</Text>
			</Pressable>
		)),
		Match.exhaustive,
	);
}

export function ProviderSearchResultRow(props: {
	readonly isLinked: boolean;
	readonly onAdd: () => void;
	readonly item: ProviderSearchItem;
	readonly entry: ProviderEntityImportEntry;
}) {
	const display = describeProviderSearchItem(props.item);
	return (
		<View className="flex-row items-center gap-3 rounded-lg bg-surface-2 px-3 py-2.5 md:bg-transparent">
			<ResultImage key={display.imageUrl} url={display.imageUrl} />
			<View className="min-w-0 flex-1 gap-0.5">
				<Text numberOfLines={2} className="font-ui-medium text-[15px] text-text">
					{display.title}
				</Text>
				{display.metaText === undefined ? null : (
					<Text numberOfLines={1} className="font-ui text-xs text-text-muted">
						{display.metaText}
					</Text>
				)}
				{props.entry.status === "failed" ? (
					<Text className="font-ui text-xs text-text-muted">{props.entry.message}</Text>
				) : null}
			</View>
			<ResultAction
				entry={props.entry}
				onAdd={props.onAdd}
				title={display.title}
				isLinked={props.isLinked}
			/>
		</View>
	);
}
