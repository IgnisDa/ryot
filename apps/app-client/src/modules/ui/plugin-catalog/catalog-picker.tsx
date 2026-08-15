import clsx from "clsx";
import { useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";

import { requestFailureCopy, type RequestFailureState } from "@/api/request-failure";
import { AppIcon } from "@/modules/icons";
import { AppButton } from "@/modules/ui/button";
import { FormTextInput } from "@/modules/ui/form";
import { AppStatusState } from "@/modules/ui/status-state";

import {
	availableCatalogEntries,
	type CatalogEntry,
	groupCatalogEntries,
} from "./catalog-selection";

export type CatalogPickerState<Source> =
	| RequestFailureState
	| { readonly status: "empty" }
	| { readonly status: "loading" }
	| { readonly status: "ready"; readonly sources: readonly Source[] };

export type CatalogPickerCopy = {
	readonly emptyTitle: string;
	readonly errorTitle: string;
	readonly emptyDetail: string;
	readonly errorSubject: string;
	readonly loadingLabel: string;
	readonly loadingDetail: string;
};

function CatalogOption(props: {
	readonly isFirst: boolean;
	readonly entry: CatalogEntry;
	readonly onChoose: () => void;
	readonly chooseLabel: (entry: CatalogEntry) => string;
}) {
	return (
		<Pressable
			onPress={props.onChoose}
			accessibilityRole="button"
			disabled={!props.entry.isAvailable}
			accessibilityHint={props.entry.requirement}
			accessibilityLabel={props.chooseLabel(props.entry)}
			accessibilityState={{ disabled: !props.entry.isAvailable }}
			className={clsx(
				"flex-row items-center gap-3 border-b border-border py-3",
				props.isFirst && "border-t",
				!props.entry.isAvailable && "opacity-70",
			)}
		>
			<View className="min-w-0 flex-1 gap-0.5">
				<Text numberOfLines={1} className="font-ui-medium text-sm text-text">
					{props.entry.name}
				</Text>
				<Text numberOfLines={2} className="font-ui text-xs text-text-muted">
					{props.entry.description}
				</Text>
				{props.entry.requirement === undefined ? null : (
					<Text className="font-ui text-xs text-danger">{props.entry.requirement}</Text>
				)}
			</View>
			<Text className="rounded-pill border border-border-strong px-2 py-0.5 font-ui-medium text-[11px] text-text-muted">
				{props.entry.badge}
			</Text>
			{props.entry.isAvailable ? (
				<AppIcon size={16} name="chevron-right" className="text-text-subtle" />
			) : null}
		</Pressable>
	);
}

export function CatalogPicker<
	Source extends { name: string; pluginSlug: string; description: string },
>(props: {
	readonly onRetry: () => void;
	readonly copy: CatalogPickerCopy;
	readonly onChoose: (slug: string) => void;
	readonly state: CatalogPickerState<Source>;
	readonly toEntry: (source: Source) => CatalogEntry;
	readonly chooseLabel: (entry: CatalogEntry) => string;
}) {
	const [query, setQuery] = useState("");

	if (props.state.status === "loading") {
		return (
			<AppStatusState
				className="py-12"
				detail={props.copy.loadingDetail}
				icon={<ActivityIndicator accessibilityLabel={props.copy.loadingLabel} />}
			/>
		);
	}
	if (props.state.status === "malformed" || props.state.status === "transport-error") {
		const error = requestFailureCopy(props.state, {
			title: props.copy.errorTitle,
			subject: props.copy.errorSubject,
		});
		return (
			<AppStatusState
				className="py-10"
				detailTone="danger"
				title={error.title}
				detail={error.detail}
				action={<AppButton label="Try again" onPress={props.onRetry} />}
			/>
		);
	}
	if (props.state.status !== "ready") {
		return (
			<AppStatusState
				className="py-12"
				title={props.copy.emptyTitle}
				detail={props.copy.emptyDetail}
				icon={<AppIcon size={36} name="inbox" className="text-text-subtle" />}
			/>
		);
	}

	const groups = groupCatalogEntries(props.state.sources, query, props.toEntry);
	const available = availableCatalogEntries(groups);
	const chooseOnly = () => {
		const only = available.length === 1 ? available.at(0) : undefined;
		if (only !== undefined) {
			props.onChoose(only.slug);
		}
	};

	return (
		<View className="gap-4">
			<FormTextInput
				value={query}
				density="compact"
				returnKeyType="go"
				autoCorrect={false}
				autoCapitalize="none"
				onChangeText={setQuery}
				onSubmitEditing={chooseOnly}
				placeholder="Search services"
				accessibilityLabel="Search services"
			/>
			{groups.length === 0 ? (
				<AppStatusState
					className="py-10"
					title="Nothing matches that"
					detail="Try a shorter word, or clear the search to see everything."
					icon={<AppIcon size={36} name="search-x" className="text-text-subtle" />}
				/>
			) : (
				groups.map((group) => (
					<View key={group.pluginSlug} className="gap-1.5">
						<Text className="font-ui-medium text-[11px] uppercase tracking-[0.8px] text-text-subtle">
							{group.heading}
						</Text>
						<View>
							{group.entries.map((entry, index) => (
								<CatalogOption
									entry={entry}
									key={entry.slug}
									isFirst={index === 0}
									chooseLabel={props.chooseLabel}
									onChoose={() => props.onChoose(entry.slug)}
								/>
							))}
						</View>
					</View>
				))
			)}
		</View>
	);
}
