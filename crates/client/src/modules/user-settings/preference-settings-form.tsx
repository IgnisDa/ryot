import type {
	UpdateUserPreferencesBody,
	UserPreferences,
} from "@ryot-app/contract/modules/user-settings/schemas";
import { useForm } from "@tanstack/react-form";
import clsx from "clsx";
import { Exit } from "effect";
import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

import { AppIcon } from "@/modules/icons";
import { FormMessage, FormSubmitButton, FormTextInput } from "@/modules/ui/form";
import { AppModal } from "@/modules/ui/modal";
import { AppSwitch } from "@/modules/ui/switch";

import { makePreferenceDraft, preferencePayload } from "./preference-draft";

const LANGUAGE_OPTIONS = [
	{ code: null, label: "Provider default" },
	{ code: "en", label: "English" },
	{ code: "es", label: "Spanish" },
	{ code: "fr", label: "French" },
	{ code: "de", label: "German" },
	{ code: "it", label: "Italian" },
	{ code: "pt", label: "Portuguese" },
	{ code: "ja", label: "Japanese" },
	{ code: "ko", label: "Korean" },
	{ code: "zh", label: "Chinese" },
	{ code: "ru", label: "Russian" },
] as const;

function PreferenceRow(props: {
	title: string;
	detail: string;
	checked: boolean;
	disabled: boolean;
	onChange: (value: boolean) => void;
}) {
	return (
		<View className="flex-row items-center gap-4 px-4 py-3.5">
			<View className="min-w-0 flex-1 gap-0.5">
				<Text className="font-ui-medium text-sm text-text">{props.title}</Text>
				<Text className="font-ui text-xs leading-4 text-text-muted">{props.detail}</Text>
			</View>
			<AppSwitch
				label={props.title}
				checked={props.checked}
				disabled={props.disabled}
				onChange={props.onChange}
			/>
		</View>
	);
}

function LanguagePicker(props: {
	value: string;
	disabled: boolean;
	onSubmit: () => void;
	onChange: (value: string) => void;
}) {
	const matched = LANGUAGE_OPTIONS.find((option) => option.code === (props.value.trim() || null));
	const [open, setOpen] = useState(false);
	const [custom, setCustom] = useState(matched === undefined);
	let selectedLabel: string = matched?.label ?? "Provider default";
	if (custom) {
		selectedLabel = props.value.trim() === "" ? "Other language" : `Other (${props.value.trim()})`;
	}

	function select(code: (typeof LANGUAGE_OPTIONS)[number]["code"]) {
		setOpen(false);
		setCustom(false);
		props.onChange(code ?? "");
	}

	function selectCustom() {
		setOpen(false);
		setCustom(true);
	}

	return (
		<>
			<Pressable
				disabled={props.disabled}
				accessibilityRole="button"
				onPress={() => setOpen(true)}
				accessibilityState={{ expanded: open }}
				accessibilityLabel={`Metadata language: ${selectedLabel}`}
				className={clsx(
					"h-11 flex-row items-center justify-between rounded-lg border border-border bg-raised px-3",
					props.disabled && "opacity-50",
				)}
			>
				<Text className="font-ui text-sm text-text">{selectedLabel}</Text>
				<AppIcon name="chevron-down" size={16} className="text-text-muted" />
			</Pressable>

			{custom ? (
				<FormTextInput
					density="compact"
					returnKeyType="go"
					autoCorrect={false}
					value={props.value}
					autoCapitalize="none"
					editable={!props.disabled}
					onChangeText={props.onChange}
					onSubmitEditing={props.onSubmit}
					placeholder="For example, sv or pt-BR"
					accessibilityLabel="Custom metadata language code"
				/>
			) : null}

			<AppModal
				visible={open}
				backdropClassName="bg-black/45"
				closeLabel="Close language picker"
				onClose={() => setOpen(false)}
				className="items-center justify-center px-5"
			>
				<View className="max-h-[80%] w-full max-w-sm overflow-hidden rounded-xl border border-border bg-raised shadow-card">
					<View className="border-b border-border px-4 py-3">
						<Text className="font-ui-semibold text-base text-text">Metadata language</Text>
					</View>
					<ScrollView contentContainerClassName="py-1">
						{LANGUAGE_OPTIONS.map((option) => {
							const selected = !custom && matched?.code === option.code;
							return (
								<Pressable
									accessibilityRole="radio"
									key={option.code ?? "default"}
									onPress={() => select(option.code)}
									accessibilityState={{ checked: selected }}
									className={clsx(
										"h-11 flex-row items-center gap-3 px-4",
										selected && "bg-accent-soft",
									)}
								>
									<Text className="flex-1 font-ui text-sm text-text">{option.label}</Text>
									{option.code === null ? null : (
										<Text className="font-ui text-xs text-text-subtle">{option.code}</Text>
									)}
									{selected ? (
										<AppIcon name="check" size={16} className="text-accent-text" />
									) : null}
								</Pressable>
							);
						})}
						<Pressable
							onPress={selectCustom}
							accessibilityRole="radio"
							accessibilityState={{ checked: custom }}
							className={clsx("h-11 flex-row items-center gap-3 px-4", custom && "bg-accent-soft")}
						>
							<Text className="flex-1 font-ui text-sm text-text">Other language...</Text>
							{custom ? <AppIcon name="check" size={16} className="text-accent-text" /> : null}
						</Pressable>
					</ScrollView>
				</View>
			</AppModal>
		</>
	);
}

export function PreferenceSettingsForm(props: {
	preferences: UserPreferences;
	onSave: (payload: UpdateUserPreferencesBody) => Promise<Exit.Exit<UserPreferences, unknown>>;
}) {
	const [initial, setInitial] = useState(props.preferences);
	const [failure, setFailure] = useState(false);
	const [saved, setSaved] = useState(false);
	const form = useForm({
		defaultValues: makePreferenceDraft(props.preferences),
		onSubmit: async ({ value }) => {
			const payload = preferencePayload(initial, value);
			if (Object.keys(payload).length === 0) {
				return;
			}
			setFailure(false);
			const result = await props.onSave(payload);
			if (Exit.isFailure(result)) {
				setFailure(true);
				return;
			}
			setInitial(result.value);
			form.reset(makePreferenceDraft(result.value));
			setSaved(true);
		},
	});

	function changed() {
		setFailure(false);
		setSaved(false);
	}

	return (
		<>
			<form.Subscribe selector={(state) => state.isSubmitting}>
				{(isSubmitting) => (
					<View className="overflow-hidden rounded-xl border border-border bg-surface">
						<form.Field name="allowNsfw">
							{(field) => (
								<PreferenceRow
									checked={field.value}
									disabled={isSubmitting}
									title="Show NSFW content"
									detail="Allow providers to include adult metadata and results."
									onChange={(value) => {
										field.handleChange(value);
										changed();
									}}
								/>
							)}
						</form.Field>
						<View className="h-px bg-border" />
						<form.Field name="disableIntegrations">
							{(field) => (
								<PreferenceRow
									checked={field.value}
									disabled={isSubmitting}
									title="Disable integrations"
									detail="Pause all external integration processing for your account."
									onChange={(value) => {
										field.handleChange(value);
										changed();
									}}
								/>
							)}
						</form.Field>
						<View className="h-px bg-border" />
						<View className="gap-2 px-4 py-3.5">
							<View className="gap-0.5">
								<Text className="font-ui-medium text-sm text-text">Metadata language</Text>
								<Text className="font-ui text-xs leading-4 text-text-muted">
									Used when translated metadata is available. Language availability varies by
									provider.
								</Text>
							</View>
							<form.Field name="language">
								{(field) => (
									<LanguagePicker
										value={field.value}
										disabled={isSubmitting}
										onSubmit={() => void form.handleSubmit()}
										onChange={(value) => {
											field.handleChange(value);
											changed();
										}}
									/>
								)}
							</form.Field>
						</View>
					</View>
				)}
			</form.Subscribe>
			<View className="items-end gap-2">
				{failure ? <FormMessage>Could not save preferences. Try again.</FormMessage> : null}
				{saved ? <Text className="font-ui text-xs text-success">Preferences saved.</Text> : null}
				<form.Subscribe selector={(state) => [state.isDirty, state.isSubmitting] as const}>
					{([isDirty, isSubmitting]) => (
						<FormSubmitButton
							density="compact"
							disabled={!isDirty}
							label="Save changes"
							className="min-w-32"
							pending={isSubmitting}
							pendingLabel="Saving..."
							onPress={() => void form.handleSubmit()}
						/>
					)}
				</form.Subscribe>
			</View>
		</>
	);
}
