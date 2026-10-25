import { isNamedTimeZone } from "@ryot-app/contract/schema/time-zone";
import type {
	UserPreferences,
	UserPreferencesPatch,
} from "@ryot-app/contract/schema/user-preferences";
import {
	Button,
	Select,
	type SelectChoice,
	StatusMessage,
	Switch,
	TextField,
} from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import { useForm } from "@tanstack/react-form";
import { Effect } from "effect";
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

export function PreferenceRow(props: {
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

export function PreferencesForm(props: {
	disabled?: boolean;
	preferences: UserPreferences;
	onSave: (payload: UserPreferencesPatch) => Effect.Effect<void, Error>;
}) {
	const [saved, setSaved] = useState(false);
	const [failed, setFailed] = useState(false);
	const [initial, setInitial] = useState(props.preferences);
	const form = useForm({
		defaultValues: makePreferenceDraft(props.preferences),
		onSubmit: ({ value }) =>
			Effect.runPromise(
				Effect.gen(function* () {
					const payload = preferencePayload(initial, value);
					if (Object.keys(payload).length === 0) {
						return;
					}
					setFailed(false);
					yield* props.onSave(payload).pipe(
						Effect.tap(() =>
							Effect.sync(() => {
								const updated = { ...initial, ...payload };
								setInitial(updated);
								form.reset(makePreferenceDraft(updated));
								setSaved(true);
							}),
						),
						Effect.catchCause(() => Effect.sync(() => setFailed(true))),
					);
				}),
			),
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
						<div className="flex flex-col gap-2 px-4 py-3.5">
							<form.Field name="language">
								{(field) => (
									<LanguageField
										value={field.value}
										disabled={props.disabled === true || isSubmitting}
										onChange={(value) => {
											field.handleChange(value);
											changed();
										}}
									/>
								)}
							</form.Field>
							<form.Field
								name="reportingTimeZone"
								validators={[
									{
										triggers: ["change", "blur"],
										run: ({ value }) =>
											isNamedTimeZone(value.trim()) ? undefined : "Enter a valid IANA time zone.",
									},
								]}
							>
								{(field) => (
									<div className="flex flex-col gap-2">
										<label className="flex flex-col gap-2 text-sm">
											<span>Reporting time zone</span>
											<TextField
												value={field.value}
												placeholder="America/New_York"
												disabled={props.disabled === true || isSubmitting}
												onChange={(event) => {
													field.handleChange(event.currentTarget.value);
													changed();
												}}
											/>
										</label>
										<p className="text-xs text-text-muted">
											Sets reporting days and comparisons. Travel does not change this setting.
										</p>
										{field.errors.length > 0 && (
											<StatusMessage tone="error">Enter a valid IANA time zone.</StatusMessage>
										)}
									</div>
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
				<form.Subscribe
					selector={(state) => [state.isDirty, state.isSubmitting, state.canSubmit] as const}
				>
					{([isDirty, isSubmitting, canSubmit]) => (
						<Button
							type="submit"
							variant="primary"
							className="min-w-32"
							disabled={props.disabled === true || !isDirty || isSubmitting || !canSubmit}
						>
							{isSubmitting ? "Saving..." : "Save changes"}
						</Button>
					)}
				</form.Subscribe>
			</div>
		</form>
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
				label="Entity language"
				choices={languageChoices}
				disabled={props.disabled}
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
					aria-label="Custom entity language code"
					onChange={(event) => props.onChange(event.currentTarget.value)}
				/>
			)}
		</>
	);
}
