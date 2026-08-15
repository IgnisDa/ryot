import type { EntityId } from "@ryot-app/contract/schema/brands";
import { Match } from "effect";
import { Link } from "expo-router";
import { ActivityIndicator, Pressable, Text, View } from "react-native";

import { AppIcon } from "@/modules/icons";
import { getEntityHref } from "@/modules/navigation/navigation-data";
import { ImageWithFallback } from "@/modules/ui/image-with-fallback";

import type { ProviderEntityImportEntry } from "./import-controller";
import { describeProviderSearchResultItem } from "./result-display";
import type { ProviderSearchResultItem } from "./search-controller";

const IMAGE_CLASS_NAME = "h-16 w-11 shrink-0 overflow-hidden rounded-md";

function InLibraryBadge() {
	return (
		<View className="flex-row items-center gap-1.5">
			<AppIcon className="text-text-muted" name="check" size={14} />
			<Text className="font-ui text-xs text-text-muted">In library</Text>
		</View>
	);
}

function InLibraryLink(props: { entityId: EntityId; title: string }) {
	return (
		<Link asChild href={getEntityHref(props.entityId)}>
			<Pressable accessibilityRole="link" accessibilityLabel={`Open ${props.title} in library`}>
				<InLibraryBadge />
			</Pressable>
		</Link>
	);
}

function ResultAction(props: {
	readonly title: string;
	readonly onAdd: () => void;
	readonly entry: ProviderEntityImportEntry;
	readonly linkedEntityId: EntityId | undefined;
}) {
	if (props.linkedEntityId !== undefined) {
		return <InLibraryLink title={props.title} entityId={props.linkedEntityId} />;
	}
	return Match.value(props.entry).pipe(
		Match.when({ status: "imported" }, (entry) => (
			<InLibraryLink title={props.title} entityId={entry.entityId} />
		)),
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
	readonly onAdd: () => void;
	readonly item: ProviderSearchResultItem;
	readonly entry: ProviderEntityImportEntry;
	readonly linkedEntityId: EntityId | undefined;
}) {
	const display = describeProviderSearchResultItem(props.item);
	return (
		<View className="flex-row items-center gap-3 rounded-lg bg-surface-2 px-3 py-2.5 md:bg-transparent">
			<ImageWithFallback className={IMAGE_CLASS_NAME} url={display.imageUrl} />
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
				linkedEntityId={props.linkedEntityId}
			/>
		</View>
	);
}
