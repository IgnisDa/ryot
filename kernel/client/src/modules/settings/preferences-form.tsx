import {
	Button,
	Select,
	StatusMessage,
	Switch,
	TextField,
	type SelectChoice,
} from "@ryot-app/client-ui-sdk";
import { AppIcon } from "@ryot-app/client-ui-sdk/icon";
import type {
	UpdateUserPreferencesBody,
	UserPreferences,
} from "@ryot-app/contract/modules/user-settings/schemas";
import { useForm } from "@tanstack/react-form";
import { useState } from "react";

import { makePreferenceDraft, preferencePayload } from "#/modules/settings/preference-draft";

const CUSTOM_LANGUAGE = "custom";
const DEFAULT_LANGUAGE = "default";

const LANGUAGE_OPTIONS = [
	{ hint: "en", value: "en", label: "English" },
	{ hint: "es", value: "es", label: "Spanish" },
	{ hint: "fr", value: "fr", label: "French" },
	{ hint: "de", value: "de", label: "German" },
	{ hint: "it", value: "it", label: "Italian" },
	{ hint: "pt", value: "pt", label: "Portuguese" },
	{ hint: "ja", value: "ja", label: "Japanese" },
	{ hint: "ko", value: "ko", label: "Korean" },
	{ hint: "zh", value: "zh", label: "Chinese" },
	{ hint: "ru", value: "ru", label: "Russian" },
] as const satisfies readonly SelectChoice[];

const languageChoices: readonly SelectChoice[] = [
	{ value: DEFAULT_LANGUAGE, label: "Provider default" },
	...LANGUAGE_OPTIONS,
	{ value: CUSTOM_LANGUAGE, label: "Other language..." },
];

function PreferenceRow(props: {
	title: string;
	detail: string;
	checked: boolean;
	disabled: boolean;
	onChange: (value: boolean) => void;
}) {
	return (
		<div className="flex items-center gap-4 px-4 py-3.5">
			<div className="flex min-w-0 flex-1 flex-col gap-0.5">
				<span className="text-sm font-medium text-text">{props.title}</span>
				<span className="text-xs leading-4 text-text-muted">{props.detail}</span>
			</div>
			<Switch
				label={props.title}
				checked={props.checked}
				disabled={props.disabled}
				onChange={props.onChange}
			/>
		</div>
	);
}

function LanguageField(props: {
	value: string;
	disabled: boolean;
	onChange: (value: string) => void;
}) {
	const code = props.value.trim();
	const known = LANGUAGE_OPTIONS.some((option) => option.value === code);
	const [custom, setCustom] = useState(code !== "" && !known);
	const isCustom = custom || (code !== "" && !known);
	let selected: string = code === "" ? DEFAULT_LANGUAGE : code;
	if (isCustom) {
		selected = CUSTOM_LANGUAGE;
	}

	const select = (next: string) => {
		if (next === CUSTOM_LANGUAGE) {
			setCustom(true);
			return;
		}
		setCustom(false);
		props.onChange(next === DEFAULT_LANGUAGE ? "" : next);
	};

	return (
		<>
			<Select
				value={selected}
				onChange={select}
				choices={languageChoices}
				disabled={props.disabled}
				label="Metadata language"
				checkIcon={<AppIcon size={16} name="check" />}
				chevronIcon={<AppIcon size={16} name="chevron-down" />}
			/>
			{isCustom && (
				<TextField
					density="compact"
					autoComplete="off"
					value={props.value}
					disabled={props.disabled}
					placeholder="For example, sv or pt-BR"
					aria-label="Custom metadata language code"
					onChange={(event) => props.onChange(event.currentTarget.value)}
				/>
			)}
		</>
	);
}

export function PreferencesForm(props: {
	preferences: UserPreferences;
	onSave: (payload: UpdateUserPreferencesBody) => Promise<UserPreferences>;
}) {
	const [saved, setSaved] = useState(false);
	const [failed, setFailed] = useState(false);
	const [initial, setInitial] = useState(props.preferences);
	const form = useForm({
		defaultValues: makePreferenceDraft(props.preferences),
		onSubmit: async ({ value }) => {
			const payload = preferencePayload(initial, value);
			if (Object.keys(payload).length === 0) {
				return;
			}
			setFailed(false);
			const updated = await props.onSave(payload).catch(() => null);
			if (updated === null) {
				setFailed(true);
				return;
			}
			setInitial(updated);
			form.reset(makePreferenceDraft(updated));
			setSaved(true);
		},
	});

	function changed() {
		setSaved(false);
		setFailed(false);
	}

	return (
		<form
			noValidate
			className="flex flex-col gap-3"
			onSubmit={(event) => {
				event.preventDefault();
				void form.handleSubmit();
			}}
		>
			<form.Subscribe selector={(state) => state.isSubmitting}>
				{(isSubmitting) => (
					<div className="overflow-hidden rounded-xl border border-border bg-surface">
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
						<div className="h-px bg-border" />
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
						<div className="h-px bg-border" />
						<div className="flex flex-col gap-2 px-4 py-3.5">
							<div className="flex flex-col gap-0.5">
								<span className="text-sm font-medium text-text">Metadata language</span>
								<span className="text-xs leading-4 text-text-muted">
									Used when translated metadata is available. Language availability varies by
									provider.
								</span>
							</div>
							<form.Field name="language">
								{(field) => (
									<LanguageField
										value={field.value}
										disabled={isSubmitting}
										onChange={(value) => {
											field.handleChange(value);
											changed();
										}}
									/>
								)}
							</form.Field>
						</div>
					</div>
				)}
			</form.Subscribe>
			<div className="flex flex-col items-end gap-2">
				{failed && (
					<StatusMessage tone="error">Could not save preferences. Try again.</StatusMessage>
				)}
				{saved && <StatusMessage tone="success">Preferences saved.</StatusMessage>}
				<form.Subscribe selector={(state) => [state.isDirty, state.isSubmitting] as const}>
					{([isDirty, isSubmitting]) => (
						<Button
							type="submit"
							variant="primary"
							className="min-w-32"
							disabled={!isDirty || isSubmitting}
						>
							{isSubmitting ? "Saving..." : "Save changes"}
						</Button>
					)}
				</form.Subscribe>
			</div>
		</form>
	);
}
