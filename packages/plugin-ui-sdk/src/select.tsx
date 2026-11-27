import { Combobox } from "@base-ui/react/combobox";
import { Select as BaseSelect } from "@base-ui/react/select";
import { useFormatters, useLocale, useT } from "@ryot-app/i18n/react";
import type { Text } from "@ryot-app/i18n/text";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
import clsx from "clsx";
import { Check, ChevronDown, Search, X } from "lucide-react";
import { type ReactElement, type ReactNode, useId, useMemo, useRef, useState } from "react";

import { useReportBlock } from "./report";
import { ShortcutScopeContext, useOverlayScope } from "./shortcut";

export type MultiSelectChoice<Value extends string = string> = Choice<Value>;

export type SelectChoice<Value extends string = string> = Choice<Value> & { readonly label: Text };
type ChoiceSearch = {
	readonly query: string;
	readonly pending: boolean;
	readonly onChange: (query: string) => void;
};

type Choice<Value extends string> = {
	readonly value: Value;
	readonly hint?: Text | undefined;
	readonly label?: Text | undefined;
	readonly disabled?: boolean | undefined;
};

type ChoiceProps<Value extends string> = {
	readonly label: Text;
	readonly checkIcon?: ReactNode;
	readonly searchIcon?: ReactNode;
	readonly chevronIcon?: ReactNode;
	readonly choices: ReadonlyArray<Choice<Value>>;
};

const defaultCheck = <Check size={14} />;
const defaultChevron = <ChevronDown size={16} />;
const defaultSearch = <Search size={16} />;
const defaultClear = <X size={18} />;

const fieldClassName =
	"flex h-9 w-full min-w-0 items-center justify-between gap-2 rounded-md border border-border-strong bg-surface px-3 transition-colors duration-100 hover:border-text-subtle motion-reduce:transition-none pointer-coarse:h-11";
const compactClassName =
	"inline-flex h-8 max-w-full min-w-0 items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 text-label whitespace-nowrap shadow-sm transition-colors duration-100 hover:border-border-emphasis hover:bg-hover disabled:opacity-60 motion-reduce:transition-none pointer-coarse:h-11";
const popupClassName =
	"max-h-(--available-height) max-w-(--available-width) min-w-[min(var(--anchor-width),var(--available-width))] overflow-hidden rounded-lg border border-border bg-raised shadow-card outline-none";
const listClassName = "min-h-0 overflow-y-auto overscroll-contain p-1";
const itemClassName =
	"flex min-h-8 cursor-default items-center gap-2 rounded-sm px-2.5 py-1.5 text-left text-sm text-text outline-none data-highlighted:bg-hover data-disabled:text-text-subtle pointer-coarse:min-h-11";

const choiceLabel = <Value extends string>(choice: Choice<Value>) => choice.label ?? choice.value;

export function Select<Value extends string>({
	chevronIcon = defaultChevron,
	...props
}: ChoiceProps<Value> & {
	readonly id?: string;
	readonly value: Value;
	readonly disabled?: boolean;
	readonly className?: string;
	readonly placeholder?: Text;
	readonly searchable?: boolean;
	readonly variant?: "field" | "compact";
	readonly onChange: (value: Value) => void;
	readonly "aria-describedby"?: string | undefined;
	readonly choices: ReadonlyArray<SelectChoice<Value>>;
}) {
	const t = useT();
	const compact = props.variant === "compact";
	const selection = props.choices.find((choice) => choice.value === props.value);
	const valueLabel =
		selection?.label ?? props.placeholder ?? t(kernelMessage("ui.select.placeholder"));
	const label = t(kernelMessage("ui.field-value", { value: valueLabel, label: props.label }));
	const report = useReportBlock(() => ({ kind: "text", lines: [label] }));
	const trigger = (
		<button
			id={props.id}
			type="button"
			aria-label={label}
			aria-describedby={props["aria-describedby"]}
			className={clsx(compact ? compactClassName : fieldClassName, props.className)}
		>
			{compact && <span className="text-text-muted">{props.label}</span>}
			<span
				className={clsx(
					"min-w-0 flex-1 truncate text-left",
					selection === undefined ? "text-text-subtle" : "text-text",
					compact ? "font-medium" : "text-sm",
				)}
			>
				{valueLabel}
			</span>
			<span aria-hidden="true" className="shrink-0 text-text-muted">
				{chevronIcon}
			</span>
		</button>
	);
	const control = props.searchable ? (
		<ChoiceCombobox<Value, false>
			{...props}
			multiple={false}
			trigger={trigger}
			selected={[props.value]}
			onValueChange={(value) => {
				if (value !== null) {
					props.onChange(value);
				}
			}}
		/>
	) : (
		<AnchoredSelect {...props} trigger={trigger} />
	);
	return compact ? (
		<div ref={report} className="contents">
			{control}
		</div>
	) : (
		control
	);
}

export function MultiSelect<Value extends string>({
	closeIcon = defaultClear,
	chevronIcon = defaultChevron,
	...props
}: ChoiceProps<Value> & {
	readonly placeholder?: Text;
	readonly closeIcon?: ReactNode;
	readonly search?: ChoiceSearch;
	readonly unresolvedSummary?: Text;
	readonly selected: ReadonlyArray<Value>;
	readonly variant?: "chip" | "field" | undefined;
	readonly onChange: (value: ReadonlyArray<Value>) => void;
}) {
	const t = useT();
	const summaryId = useId();
	const formatters = useFormatters();
	const selectedLabels = props.selected.map((value) =>
		choiceLabel(props.choices.find((choice) => choice.value === value) ?? { value }),
	);
	const count = selectedLabels.length;
	const names = formatters.list({ type: "unit", style: "short" });
	const chip = props.variant === "chip";
	let label: string = props.label;
	if (chip && count > 0) {
		label = t(kernelMessage("ui.multi-select.chip-count", { count, label: props.label }));
	} else if (!chip) {
		if (count === 0) {
			label = props.placeholder ?? t(kernelMessage("ui.multi-select.placeholder"));
		} else if (props.unresolvedSummary !== undefined) {
			label = props.unresolvedSummary;
		} else if (count < 3) {
			label = names.format(selectedLabels);
		} else {
			label = t(
				kernelMessage("ui.multi-select.overflow-summary", {
					count: count - 2,
					names: names.format(selectedLabels.slice(0, 2)),
				}),
			);
		}
	}
	const control = (
		<ChoiceCombobox<Value, true>
			{...props}
			multiple
			value={props.selected}
			onValueChange={props.onChange}
			clear={
				!chip &&
				count > 0 && (
					<button
						type="button"
						onClick={() => props.onChange([])}
						aria-label={t(kernelMessage("ui.multi-select.clear-field", { label: props.label }))}
						className="flex size-8 shrink-0 items-center justify-center rounded-sm text-text-subtle hover:bg-hover pointer-coarse:size-10"
					>
						{closeIcon}
					</button>
				)
			}
			footer={
				count > 0 && (
					<button
						type="button"
						onClick={() => props.onChange([])}
						className="mx-2 self-start rounded-sm px-2 py-1 text-xs font-medium text-text-muted hover:bg-hover"
						aria-label={t(
							kernelMessage("ui.multi-select.clear-selections-in", { label: props.label }),
						)}
					>
						{t(kernelMessage("ui.multi-select.clear-selections"))}
					</button>
				)
			}
			trigger={
				<button
					type="button"
					aria-label={props.label}
					aria-describedby={count === 0 ? undefined : summaryId}
					className={clsx(
						chip
							? "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-pill border px-3 text-label font-medium whitespace-nowrap transition-colors duration-100 motion-reduce:transition-none pointer-coarse:h-10"
							: fieldClassName,
						chip &&
							(count === 0
								? "border-border-emphasis bg-surface text-text hover:bg-hover"
								: "border-accent-border bg-accent-soft text-accent-text"),
					)}
				>
					<span
						id={summaryId}
						className={clsx(
							!chip && "min-w-0 flex-1 truncate text-left text-sm",
							!chip && count === 0 && "text-text-subtle",
						)}
					>
						{label}
					</span>
					<span aria-hidden="true" className="shrink-0">
						{chevronIcon}
					</span>
				</button>
			}
		/>
	);
	return chip ? control : <div className="flex items-center gap-2">{control}</div>;
}

function ChoiceText(props: { readonly label: string; readonly hint?: Text | undefined }) {
	return (
		<>
			<span className="min-w-0 flex-1 truncate">{props.label}</span>
			{props.hint !== undefined && (
				<span aria-hidden="true" className="text-xs text-text-subtle">
					{props.hint}
				</span>
			)}
		</>
	);
}

function AnchoredSelect<Value extends string>(
	props: ChoiceProps<Value> & {
		readonly value: Value;
		readonly trigger: ReactElement;
		readonly disabled?: boolean | undefined;
		readonly onChange: (value: Value) => void;
	},
) {
	const [open, setOpen] = useState(false);
	const actions = useRef<BaseSelect.Root.Actions>(null);
	const overlay = useOverlayScope(open, () => actions.current?.close());
	return (
		<BaseSelect.Root<Value>
			open={open}
			modal={false}
			value={props.value}
			actionsRef={actions}
			onOpenChange={setOpen}
			disabled={props.disabled}
			items={props.choices.map((choice) => ({ value: choice.value, label: choiceLabel(choice) }))}
			onValueChange={(value) => {
				if (value !== null) {
					props.onChange(value);
				}
			}}
		>
			<BaseSelect.Trigger render={props.trigger} />
			<BaseSelect.Portal>
				<ShortcutScopeContext value={overlay.scope}>
					<BaseSelect.Positioner
						align="start"
						sideOffset={4}
						className="z-50"
						collisionPadding={8}
						alignItemWithTrigger={false}
					>
						<BaseSelect.Popup className={clsx(popupClassName, "flex min-w-36 flex-col")}>
							<BaseSelect.List aria-label={props.label} className={listClassName}>
								{props.choices.map((choice) => (
									<BaseSelect.Item
										key={choice.value}
										value={choice.value}
										className={itemClassName}
										disabled={choice.disabled}
										label={choiceLabel(choice)}
									>
										<ChoiceText hint={choice.hint} label={choiceLabel(choice)} />
										<BaseSelect.ItemIndicator
											aria-hidden="true"
											className="shrink-0 text-accent-text"
										>
											{props.checkIcon === undefined ? defaultCheck : props.checkIcon}
										</BaseSelect.ItemIndicator>
									</BaseSelect.Item>
								))}
							</BaseSelect.List>
						</BaseSelect.Popup>
					</BaseSelect.Positioner>
				</ShortcutScopeContext>
			</BaseSelect.Portal>
		</BaseSelect.Root>
	);
}

function ChoiceCombobox<Value extends string, Multiple extends boolean>({
	checkIcon = defaultCheck,
	searchIcon = defaultSearch,
	...props
}: ChoiceProps<Value> & {
	readonly clear?: ReactNode;
	readonly multiple: Multiple;
	readonly footer?: ReactNode;
	readonly search?: ChoiceSearch;
	readonly trigger: ReactElement;
	readonly disabled?: boolean | undefined;
	readonly selected: ReadonlyArray<Value>;
	readonly value: Combobox.Root.Props<Value, Multiple>["value"];
	readonly onValueChange: NonNullable<Combobox.Root.Props<Value, Multiple>["onValueChange"]>;
}) {
	const t = useT();
	const locale = useLocale();
	const [open, setOpen] = useState(false);
	const actions = useRef<Combobox.Root.Actions>(null);
	const input = useRef<HTMLInputElement>(null);
	const overlay = useOverlayScope(open, () => actions.current?.close());
	const { contains } = Combobox.useFilter({ locale });
	const items = useMemo(
		() =>
			Combobox.createItems(props.choices, {
				getLabel: choiceLabel,
				getValue: (choice) => choice.value,
			}),
		[props.choices],
	);
	return (
		<Combobox.Root<Value, Multiple, Choice<Value>>
			open={open}
			items={items}
			value={props.value}
			actionsRef={actions}
			multiple={props.multiple}
			disabled={props.disabled}
			inputValue={props.search?.query}
			onValueChange={props.onValueChange}
			onOpenChange={(next) => {
				setOpen(next);
				if (!next) {
					props.search?.onChange("");
				}
			}}
			onInputValueChange={(query, details) => {
				if (details.reason === "input-change") {
					props.search?.onChange(query);
				}
			}}
			filter={
				props.search === undefined
					? (choice, query) =>
							props.selected.includes(choice.value) || contains(choiceLabel(choice), query)
					: null
			}
		>
			<Combobox.Trigger render={props.trigger} />
			{props.clear}
			<Combobox.Portal>
				<ShortcutScopeContext value={overlay.scope}>
					<Combobox.Positioner align="start" sideOffset={4} className="z-50" collisionPadding={8}>
						<Combobox.Popup
							initialFocus={input}
							aria-label={props.label}
							className={clsx(popupClassName, "flex w-72 flex-col")}
						>
							<div className="m-2 flex min-h-9 shrink-0 items-center gap-2 rounded-md bg-surface-2 px-3 focus-within:ring-2 focus-within:ring-focus">
								<span aria-hidden="true" className="text-text-subtle">
									{searchIcon}
								</span>
								<Combobox.Input
									ref={input}
									aria-busy={props.search?.pending}
									placeholder={t(kernelMessage("ui.select.search-options"))}
									aria-label={t(kernelMessage("ui.select.search-field", { label: props.label }))}
									className="min-w-0 flex-1 bg-transparent text-base text-text outline-none pointer-fine:text-sm"
								/>
							</div>
							{props.footer}
							<Combobox.Empty className="text-center text-sm text-text-muted not-empty:p-3">
								{t(
									kernelMessage(
										props.search?.pending === true
											? "common.status.loading"
											: "ui.select.no-matches",
									),
								)}
							</Combobox.Empty>
							<Combobox.List aria-label={props.label} className={listClassName}>
								{(choice: Choice<Value>) => (
									<Combobox.Item
										key={choice.value}
										value={choice.value}
										className={itemClassName}
										disabled={choice.disabled}
									>
										<ChoiceText hint={choice.hint} label={choiceLabel(choice)} />
										<Combobox.ItemIndicator
											aria-hidden="true"
											className="shrink-0 text-accent-text"
										>
											{checkIcon}
										</Combobox.ItemIndicator>
									</Combobox.Item>
								)}
							</Combobox.List>
						</Combobox.Popup>
					</Combobox.Positioner>
				</ShortcutScopeContext>
			</Combobox.Portal>
		</Combobox.Root>
	);
}
