import { RatingScale } from "@ryot-app/contract/modules/events/rating-scale";
import { isNamedTimeZone } from "@ryot-app/contract/schema/time-zone";
import {
	resolveWeekStart,
	type UserPreferences,
	type UserPreferencesPatch,
} from "@ryot-app/contract/schema/user-preferences";
import { formatDisplayText } from "@ryot-app/i18n/format";
import { formattersFor } from "@ryot-app/i18n/formatters";
import { PSEUDO_LOCALE, WeekDay } from "@ryot-app/i18n/locale";
import { useFormatters, useT } from "@ryot-app/i18n/react";
import type { Text } from "@ryot-app/i18n/text";
import { kernelLocales } from "@ryot-app/kernel-messages/catalog";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
import { formatError } from "@ryot-app/plugin-client-sdk/react";
import {
	Button,
	Field,
	Select,
	type SelectChoice,
	StatusMessage,
	Switch,
	TextField,
} from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import { useForm } from "@tanstack/react-form";
import { Cause, Effect, Schema } from "effect";
import { useState } from "react";

import { makePreferenceDraft, preferencePayload } from "#/modules/settings/preference-draft";
import { SettingsSection } from "#/modules/settings/settings-section";

const CUSTOM_LANGUAGE = "custom";
const DEFAULT_LANGUAGE = "default";
const DEFAULT_CHOICE = "default";

const LANGUAGE_CODES = [
	"en",
	"es",
	"es-ES",
	"fr",
	"de",
	"it",
	"pt",
	"pt-BR",
	"pt-PT",
	"ja",
	"ko",
	"zh",
	"zh-Hans",
	"ru",
] as const;

const RATING_SCALES = [
	{ code: "hundred", value: "hundred" },
	{ code: "ten", value: "ten" },
	{ code: "five", value: "five" },
	{ code: "three_point", value: "three-point" },
] as const satisfies readonly { readonly code: string; readonly value: RatingScale }[];

const isRatingScale = Schema.is(RatingScale);
const isWeekDay = Schema.is(WeekDay);
const weekDays = WeekDay.literals;

export function PreferenceRow(props: {
	title: Text;
	detail: Text;
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
	const t = useT();
	const ratingScaleChoices: readonly SelectChoice[] = RATING_SCALES.map(({ code, value }) => ({
		value,
		label: t(kernelMessage("client.settings.preferences.rating-scale.option", { scale: code })),
	}));
	const [saved, setSaved] = useState(false);
	const [failure, setFailure] = useState<null | { readonly cause: unknown }>(null);
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
					setFailure(null);
					yield* props.onSave(payload).pipe(
						Effect.tap(() =>
							Effect.sync(() => {
								const updated = { ...initial, ...payload };
								setInitial(updated);
								form.reset(makePreferenceDraft(updated));
								setSaved(true);
							}),
						),
						Effect.catchCause((cause) =>
							Effect.sync(() => setFailure({ cause: Cause.squash(cause) })),
						),
					);
				}),
			),
	});

	function changed() {
		setSaved(false);
		setFailure(null);
	}

	return (
		<form
			noValidate
			className="flex flex-col gap-8"
			onSubmit={(event) => {
				event.preventDefault();
				void form.handleSubmit();
			}}
		>
			<form.Subscribe selector={(state) => state.isSubmitting}>
				{(isSubmitting) => (
					<div className="flex flex-col gap-8">
						<SettingsSection
							title={t(kernelMessage("client.route.settings.preferences.language-title"))}
							detail={t(kernelMessage("client.route.settings.preferences.language-detail"))}
						>
							<div className="grid grid-cols-1 gap-5 rounded-xl border border-border bg-surface p-5 lg:grid-cols-2">
								<form.Field name="interfaceLocale">
									{(field) => (
										<InterfaceLocaleField
											value={field.value}
											saved={initial.interfaceLocale}
											disabled={props.disabled === true || isSubmitting}
											onChange={(value) => {
												field.handleChange(value);
												changed();
											}}
										/>
									)}
								</form.Field>
								<form.Field name="contentLanguage">
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
							</div>
						</SettingsSection>
						<SettingsSection
							title={t(kernelMessage("client.route.settings.preferences.reporting-title"))}
							detail={t(kernelMessage("client.route.settings.preferences.reporting-detail"))}
						>
							<div className="grid grid-cols-1 gap-5 rounded-xl border border-border bg-surface p-5 lg:grid-cols-2">
								<form.Subscribe selector={(state) => state.values.interfaceLocale}>
									{(interfaceLocale) => (
										<form.Field name="weekStart">
											{(field) => (
												<WeekStartField
													value={field.value}
													interfaceLocale={interfaceLocale}
													disabled={props.disabled === true || isSubmitting}
													onChange={(value) => {
														field.handleChange(value);
														changed();
													}}
												/>
											)}
										</form.Field>
									)}
								</form.Subscribe>
								<form.Field name="ratingScale">
									{(field) => (
										<Field
											hint={t(kernelMessage("client.settings.preferences.rating-scale.hint"))}
											label={t(kernelMessage("client.settings.preferences.rating-scale.label"))}
										>
											{(control) => (
												<Select
													id={control.id}
													value={field.value}
													choices={ratingScaleChoices}
													aria-describedby={control["aria-describedby"]}
													checkIcon={<AppIcon size={16} name="check" />}
													disabled={props.disabled === true || isSubmitting}
													chevronIcon={<AppIcon size={16} name="chevron-down" />}
													label={t(kernelMessage("client.settings.preferences.rating-scale.label"))}
													onChange={(value) => {
														if (isRatingScale(value)) {
															field.handleChange(value);
															changed();
														}
													}}
												/>
											)}
										</Field>
									)}
								</form.Field>
								<form.Field
									name="reportingTimeZone"
									validators={[
										{
											triggers: ["change", "blur"],
											run: ({ value }) => (isNamedTimeZone(value.trim()) ? undefined : "invalid"),
										},
									]}
								>
									{(field) => (
										<Field
											className="lg:col-span-2"
											hint={t(kernelMessage("client.settings.preferences.time-zone.hint"))}
											label={t(kernelMessage("client.settings.preferences.time-zone.label"))}
											error={
												field.errors[0]
													? t(kernelMessage("client.settings.preferences.time-zone.invalid"))
													: undefined
											}
										>
											{(control) => (
												<TextField
													{...control}
													value={field.value}
													onBlur={field.handleBlur}
													disabled={props.disabled === true || isSubmitting}
													placeholder={t(
														kernelMessage("client.settings.preferences.time-zone.placeholder"),
													)}
													onChange={(event) => {
														field.handleChange(event.currentTarget.value);
														changed();
													}}
												/>
											)}
										</Field>
									)}
								</form.Field>
							</div>
						</SettingsSection>
					</div>
				)}
			</form.Subscribe>
			<div className="flex flex-col items-stretch gap-3 border-t border-border pt-4 sm:items-end">
				{failure !== null && (
					<StatusMessage tone="error">
						{formatError(t, failure.cause, kernelMessage("settings.preferences.save-failed"))}
					</StatusMessage>
				)}
				{saved && (
					<StatusMessage tone="success">
						{t(kernelMessage("client.settings.preferences.saved"))}
					</StatusMessage>
				)}
				<form.Subscribe
					selector={(state) => [state.isDirty, state.isSubmitting, state.canSubmit] as const}
				>
					{([isDirty, isSubmitting, canSubmit]) => (
						<Button
							type="submit"
							variant="primary"
							className="w-full min-w-32 sm:w-auto"
							disabled={props.disabled === true || !isDirty || isSubmitting || !canSubmit}
						>
							{t(
								isSubmitting
									? kernelMessage("common.status.saving")
									: kernelMessage("common.action.save-changes"),
							)}
						</Button>
					)}
				</form.Subscribe>
			</div>
		</form>
	);
}

function InterfaceLocaleField(props: {
	value: string;
	disabled: boolean;
	onChange: (value: string) => void;
	saved: UserPreferences["interfaceLocale"];
}) {
	const t = useT();
	const { displayNames } = useFormatters();
	const names = displayNames({ type: "language" });
	const label = t(kernelMessage("settings.preferences.interface-locale.label"));
	const choices: readonly SelectChoice[] = [
		{
			value: DEFAULT_CHOICE,
			label: t(kernelMessage("settings.preferences.interface-locale.device")),
		},
		...kernelLocales
			.filter((locale) => locale !== PSEUDO_LOCALE || locale === props.saved)
			.map((locale) => ({
				value: locale,
				hint: formatDisplayText(t, names.of(locale) ?? locale),
				label: formatDisplayText(
					t,
					formattersFor(locale).displayNames({ type: "language" }).of(locale) ?? locale,
				),
			})),
	];
	return (
		<Field label={label} hint={t(kernelMessage("settings.preferences.interface-locale.hint"))}>
			{(control) => (
				<Select
					label={label}
					id={control.id}
					choices={choices}
					disabled={props.disabled}
					aria-describedby={control["aria-describedby"]}
					checkIcon={<AppIcon size={16} name="check" />}
					chevronIcon={<AppIcon size={16} name="chevron-down" />}
					value={props.value === "" ? DEFAULT_CHOICE : props.value}
					onChange={(value) => props.onChange(value === DEFAULT_CHOICE ? "" : value)}
				/>
			)}
		</Field>
	);
}

const referenceSunday = Date.UTC(2023, 0, 1);

function WeekStartField(props: {
	value: string;
	disabled: boolean;
	interfaceLocale: string;
	onChange: (value: string) => void;
}) {
	const t = useT();
	const { dateTime } = useFormatters();
	const weekdays = dateTime({ weekday: "long", timeZone: "UTC" });
	const dayName = (day: WeekDay) =>
		formatDisplayText(t, weekdays.format(referenceSunday + day * 86_400_000));
	const interfaceLocale = kernelLocales.find((locale) => locale === props.interfaceLocale) ?? null;
	const choices: readonly SelectChoice[] = [
		{
			value: DEFAULT_CHOICE,
			label: t(
				kernelMessage("settings.preferences.week-start.default", {
					day: dayName(resolveWeekStart({ interfaceLocale, weekStart: null })),
				}),
			),
		},
		...weekDays.map((day) => ({ value: String(day), label: dayName(day) })),
	];
	return (
		<Field
			hint={t(kernelMessage("settings.preferences.week-start.hint"))}
			label={t(kernelMessage("settings.preferences.week-start.label"))}
		>
			{(control) => (
				<Select
					id={control.id}
					choices={choices}
					disabled={props.disabled}
					aria-describedby={control["aria-describedby"]}
					checkIcon={<AppIcon size={16} name="check" />}
					chevronIcon={<AppIcon size={16} name="chevron-down" />}
					value={props.value === "" ? DEFAULT_CHOICE : props.value}
					label={t(kernelMessage("settings.preferences.week-start.label"))}
					onChange={(value) => {
						const day = Number(value);
						props.onChange(value === DEFAULT_CHOICE || !isWeekDay(day) ? "" : value);
					}}
				/>
			)}
		</Field>
	);
}

function LanguageField(props: {
	value: string;
	disabled: boolean;
	onChange: (value: string) => void;
}) {
	const t = useT();
	const { displayNames } = useFormatters();
	const names = displayNames({ type: "language" });
	const languageOptions = LANGUAGE_CODES.map((code) => ({
		value: code,
		hint: formatDisplayText(t, code),
		label: formatDisplayText(t, names.of(code) ?? code),
	}));
	const languageChoices: readonly SelectChoice[] = [
		{
			value: DEFAULT_LANGUAGE,
			label: t(kernelMessage("settings.preferences.content-language.provider")),
		},
		...languageOptions,
		{
			value: CUSTOM_LANGUAGE,
			label: t(kernelMessage("client.settings.preferences.language.other")),
		},
	];
	const code = props.value.trim();
	const known = languageOptions.some((option) => option.value === code);
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
		<div className="grid content-start gap-3">
			<Field
				hint={t(kernelMessage("client.settings.preferences.language.hint"))}
				label={t(kernelMessage("client.settings.preferences.language.label"))}
			>
				{(control) => (
					<Select
						id={control.id}
						value={selected}
						onChange={select}
						choices={languageChoices}
						disabled={props.disabled}
						aria-describedby={control["aria-describedby"]}
						checkIcon={<AppIcon size={16} name="check" />}
						chevronIcon={<AppIcon size={16} name="chevron-down" />}
						label={t(kernelMessage("client.settings.preferences.language.label"))}
					/>
				)}
			</Field>
			{isCustom && (
				<Field label={t(kernelMessage("client.settings.preferences.language.custom-label"))}>
					{(control) => (
						<TextField
							{...control}
							density="compact"
							autoComplete="off"
							value={props.value}
							disabled={props.disabled}
							onChange={(event) => props.onChange(event.currentTarget.value)}
							aria-label={t(kernelMessage("client.settings.preferences.language.custom-label"))}
							placeholder={t(
								kernelMessage("client.settings.preferences.language.custom-placeholder"),
							)}
						/>
					)}
				</Field>
			)}
		</div>
	);
}
