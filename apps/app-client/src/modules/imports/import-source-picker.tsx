import clsx from "clsx";
import { useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";

import { AppIcon } from "@/modules/icons";
import { AppButton } from "@/modules/ui/button";
import { FormTextInput } from "@/modules/ui/form";
import { AppStatusState } from "@/modules/ui/status-state";

import {
	groupImportSources,
	type ImportSourceRow,
	importSourceRequirement,
	startableImportSources,
} from "./source-selection";
import { importSourceListError, type ImportSourceListState } from "./state";

function ImportSourceOption(props: {
	readonly isFirst: boolean;
	readonly onChoose: () => void;
	readonly source: ImportSourceRow;
}) {
	const requirement = importSourceRequirement(props.source);
	return (
		<Pressable
			onPress={props.onChoose}
			accessibilityRole="button"
			accessibilityHint={requirement}
			disabled={!props.source.isStartable}
			accessibilityState={{ disabled: !props.source.isStartable }}
			accessibilityLabel={
				props.source.isStartable
					? `Import from ${props.source.name}`
					: `${props.source.name} is unavailable`
			}
			className={clsx(
				"flex-row items-center gap-3 border-b border-border py-3",
				props.isFirst && "border-t",
				!props.source.isStartable && "opacity-70",
			)}
		>
			<View className="min-w-0 flex-1 gap-0.5">
				<Text numberOfLines={1} className="font-ui-medium text-sm text-text">
					{props.source.name}
				</Text>
				<Text numberOfLines={2} className="font-ui text-xs text-text-muted">
					{props.source.description}
				</Text>
				{requirement === undefined ? null : (
					<Text className="font-ui text-xs text-danger">{requirement}</Text>
				)}
			</View>
			<Text className="rounded-pill border border-border-strong px-2 py-0.5 font-ui-medium text-[11px] text-text-muted">
				{props.source.inputShape}
			</Text>
			{props.source.isStartable ? (
				<AppIcon size={16} name="chevron-right" className="text-text-subtle" />
			) : null}
		</Pressable>
	);
}

export function ImportSourcePicker(props: {
	readonly onRetry: () => void;
	readonly state: ImportSourceListState;
	readonly onChoose: (slug: string) => void;
}) {
	const [query, setQuery] = useState("");

	if (props.state.status === "loading") {
		return (
			<AppStatusState
				className="py-12"
				detail="Loading the services you can import from..."
				icon={<ActivityIndicator accessibilityLabel="Loading services" />}
			/>
		);
	}
	if (props.state.status === "malformed" || props.state.status === "transport-error") {
		const error = importSourceListError(props.state);
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
	if (props.state.status === "empty") {
		return (
			<AppStatusState
				className="py-12"
				title="No services yet"
				detail="Once a plugin on this server contributes an importer, it shows up here."
				icon={<AppIcon size={36} name="inbox" className="text-text-subtle" />}
			/>
		);
	}

	const groups = groupImportSources(props.state.sources, query);
	const startable = startableImportSources(groups);
	const chooseOnly = () => {
		const only = startable.length === 1 ? startable.at(0) : undefined;
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
							{group.sources.map((source, index) => (
								<ImportSourceOption
									source={source}
									key={source.slug}
									isFirst={index === 0}
									onChoose={() => props.onChoose(source.slug)}
								/>
							))}
						</View>
					</View>
				))
			)}
		</View>
	);
}
