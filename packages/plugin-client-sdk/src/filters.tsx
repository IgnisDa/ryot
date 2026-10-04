import {
	Button,
	Checkbox,
	IconButton,
	Modal,
	MultiSelect,
	SegmentedControl,
	Select,
	TextField,
	useValueChange,
} from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import {
	activeRuleCount,
	decodeFilterParam,
	draftFromRule,
	draftRule,
	editableGroup,
	encodeFilterParam,
	filterOperatorsFor,
	groupFilter,
	newFilterDraft,
	LinkedFilterChoicesInput,
	linkedFilterChoicesInput,
	linkedFilterChoicesRecipe,
	type effectiveFilterFields,
	type FilterDraft,
	type LinkedFilterChoices,
} from "@ryot-app/ryotql-recipes/filters";
import { Effect, Schema } from "effect";
import { useDeferredValue, useState, type ReactNode, type RefObject } from "react";

import { usePluginLocation } from "./navigation/routing";
import { createRyotQuery } from "./queries/definitions";
import { useRyotQuery } from "./queries/hooks";
import { useRyot } from "./queries/provider";

export type ViewFilterField = ReturnType<typeof effectiveFilterFields>[number];
export type ViewFilter = NonNullable<ReturnType<typeof decodeFilterParam>>;
type ViewFilterRule = NonNullable<ReturnType<typeof draftRule>>;
type FilterOperator = ReturnType<typeof filterOperatorsFor>[number];
type LinkedField = Exclude<ViewFilterField, { readonly kind: "value" }>;
type RuleGroup = NonNullable<ReturnType<typeof editableGroup>>;

export const activeFiltersPhrase = (count: number) =>
	`${count} active ${count === 1 ? "filter" : "filters"}`;

export const filtersLabel = (count: number) => `Filters, ${activeFiltersPhrase(count)}`;

export const useViewFilter = (fields: readonly ViewFilterField[]) => {
	const ryot = useRyot();
	const { search } = usePluginLocation();
	const filter = decodeFilterParam(new URLSearchParams(search).get("filters"), fields);
	return {
		filter,
		activeCount: activeRuleCount(filter),
		setFilter: (next: ViewFilter | undefined) =>
			ryot.navigation.pageSearch.replace({ filters: encodeFilterParam(next) }),
	};
};

export function ViewFiltersSheet({
	title,
	compact,
	onClose,
	children,
	triggerRef,
}: {
	readonly title: string;
	readonly compact: boolean;
	readonly onClose: () => void;
	readonly children: ReactNode;
	readonly triggerRef?: RefObject<HTMLElement | null> | undefined;
}) {
	return (
		<Modal
			label={title}
			onClose={onClose}
			triggerRef={triggerRef}
			closeLabel={`Close ${title.toLowerCase()}`}
			containerClassName={compact ? "items-end justify-center" : "items-center justify-center p-4"}
			className={
				compact
					? "max-h-[90%] w-full overflow-y-auto rounded-t-xl border-t border-border bg-surface p-5"
					: "max-h-[90%] w-full max-w-xl overflow-y-auto rounded-xl border border-border bg-surface p-5"
			}
		>
			<h2 className="font-display text-lg font-semibold text-text">{title}</h2>
			{children}
		</Modal>
	);
}

const decodeChoicesInput = Schema.decodeUnknownSync(
	Schema.fromJsonString(LinkedFilterChoicesInput),
);

const choicesQuery = createRyotQuery<string, LinkedFilterChoices>(({ input, client }) => {
	const request = decodeChoicesInput(input);
	return request.ids?.length === 0
		? Effect.succeed<LinkedFilterChoices>([])
		: client.data.query(linkedFilterChoicesRecipe(request));
});

const choicesKey = (
	field: LinkedField,
	extra: { readonly ids?: readonly string[]; readonly searchText?: string },
) => JSON.stringify(linkedFilterChoicesInput(field, extra));

const operatorLabels: Readonly<Record<FilterOperator, string>> = {
	is: "is",
	eq: "equals",
	isTrue: "is yes",
	isFalse: "is no",
	empty: "is empty",
	lte: "is at most",
	after: "is after",
	gte: "is at least",
	anyOf: "is any of",
	before: "is before",
	contains: "contains",
	noneOf: "is none of",
	between: "is between",
	notEmpty: "is not empty",
	allOf: "includes all of",
	betweenDates: "is between",
	notContains: "does not contain",
	withinLastDays: "is within the last (days)",
};

const listOperatorLabels: Partial<Record<FilterOperator, string>> = {
	anyOf: "includes any of",
	noneOf: "includes none of",
};

const operatorLabel = (field: ViewFilterField, operator: FilterOperator) =>
	(field.kind !== "value" || field.type === "enum-list"
		? listOperatorLabels[operator]
		: undefined) ?? operatorLabels[operator];

const fieldChoices = (field: ViewFilterField) => ("choices" in field ? field.choices : []);

const ruleValueText = (rule: ViewFilterRule, labelOf: (value: string) => string) => {
	if ("values" in rule) {
		return rule.values.map(labelOf).join(", ");
	}
	if ("value" in rule) {
		return String(rule.value);
	}
	if ("min" in rule) {
		return `${rule.min} and ${rule.max}`;
	}
	if ("from" in rule) {
		return `${rule.from} and ${rule.to}`;
	}
	return "days" in rule ? `${rule.days} days` : "";
};

const ruleText = (field: ViewFilterField, rule: ViewFilterRule, valueText: string) =>
	[field.label, operatorLabel(field, rule.operator), valueText].filter(Boolean).join(" ");

type PanelRow = { readonly id: number; readonly draft: FilterDraft };

type PanelState = {
	readonly nextId: number;
	readonly rows: readonly PanelRow[];
	readonly match: RuleGroup["match"];
};

const toPanelState = (source: RuleGroup): PanelState => ({
	match: source.match,
	nextId: source.rules.length,
	rows: source.rules.map((rule, id) => ({ id, draft: draftFromRule(rule) })),
});

const stateFilter = (state: PanelState) =>
	groupFilter({
		match: state.match,
		rules: state.rows.flatMap(({ draft }) => {
			const rule = draftRule(draft);
			return rule === undefined ? [] : [rule];
		}),
	});

function LinkedValueEditor({
	field,
	selected,
	onChange,
}: {
	readonly field: LinkedField;
	readonly selected: readonly string[];
	readonly onChange: (values: readonly string[]) => void;
}) {
	const [open, setOpen] = useState(false);
	const [search, setSearch] = useState("");
	const searchText = useDeferredValue(search.trim());
	const page = useRyotQuery(
		choicesQuery,
		choicesKey(field, searchText === "" ? {} : { searchText }),
	);
	const known = useRyotQuery(choicesQuery, choicesKey(field, { ids: selected }));
	const pageChoices = page.data ?? [];
	const pageValues = new Set(pageChoices.map(({ value }) => value));
	const choices = [
		...(known.data ?? []).filter(({ value }) => !pageValues.has(value)),
		...pageChoices,
	];
	const labels = new Map((known.data ?? []).map(({ value, label }) => [value, label]));
	const resolved = selected.every((value) => labels.has(value));
	let summary = "Select options";
	if (selected.length > 0) {
		summary = resolved
			? selected.map((value) => labels.get(value)).join(", ")
			: `${selected.length} selected`;
	}
	const close = () => {
		setOpen(false);
		setSearch("");
	};
	return (
		<>
			<button
				type="button"
				onClick={() => setOpen(true)}
				aria-label={`${field.label} values: ${summary}`}
				className="flex h-9 min-w-0 items-center justify-between gap-2 rounded-md border border-border-strong bg-surface px-3 pointer-coarse:h-11"
			>
				<span className="min-w-0 flex-1 truncate text-left text-sm text-text">{summary}</span>
				<AppIcon size={14} name="chevron-down" className="text-text-muted" />
			</button>
			{open && (
				<Modal
					onClose={close}
					label={field.label}
					closeLabel="Close options"
					containerClassName="items-center justify-center p-4"
					className="flex max-h-[80%] w-full max-w-sm flex-col overflow-hidden rounded-xl bg-raised p-4 shadow-modal"
				>
					<h3 className="mb-3 text-base font-semibold text-text">{field.label}</h3>
					<TextField
						value={search}
						autoComplete="off"
						placeholder="Search"
						aria-label={`Search ${field.label}`}
						onChange={(event) => setSearch(event.currentTarget.value)}
					/>
					<div className="mt-3 grid min-h-0 flex-1 content-start gap-1 overflow-y-auto">
						{choices.map((choice) => (
							<Checkbox
								key={choice.value}
								label={choice.label}
								checked={selected.includes(choice.value)}
								onChange={(event) =>
									onChange(
										event.currentTarget.checked
											? [...selected, choice.value]
											: selected.filter((value) => value !== choice.value),
									)
								}
							/>
						))}
						{choices.length === 0 && !page.isPending && (
							<p className="py-4 text-center text-sm text-text-muted">No matching options.</p>
						)}
					</div>
					<Button onClick={close} className="mt-3" variant="secondary">
						Done
					</Button>
				</Modal>
			)}
		</>
	);
}

const listOperators: ReadonlySet<FilterOperator> = new Set(["anyOf", "allOf", "noneOf"]);
const numberOperators: ReadonlySet<FilterOperator> = new Set(["gte", "lte", "eq"]);
const textOperators: ReadonlySet<FilterOperator> = new Set(["contains", "notContains", "is"]);
const dateOperators: ReadonlySet<FilterOperator> = new Set(["before", "after"]);

function ValueEditor({
	draft,
	field,
	onChange,
}: {
	readonly draft: FilterDraft;
	readonly field: ViewFilterField;
	readonly onChange: (update: Partial<FilterDraft>) => void;
}) {
	const { operator } = draft;
	const input = (
		role: string,
		key: "text" | "second",
		type: "text" | "number" | "date",
		extra: { readonly min?: number; readonly step?: number } = {},
	) => (
		<TextField
			{...extra}
			type={type}
			density="compact"
			value={draft[key]}
			className="min-w-0 flex-1"
			aria-label={`${field.label} ${role}`}
			onChange={(event) => onChange({ [key]: event.currentTarget.value })}
		/>
	);
	if (listOperators.has(operator)) {
		if (field.kind !== "value") {
			return (
				<LinkedValueEditor
					field={field}
					selected={draft.values}
					onChange={(values) => onChange({ values })}
				/>
			);
		}
		return (
			<MultiSelect
				selected={draft.values}
				choices={fieldChoices(field)}
				label={`${field.label} values`}
				closeIcon={<AppIcon name="x" size={18} />}
				onChange={(values) => onChange({ values })}
				checkIcon={<AppIcon size={14} name="check" />}
				searchIcon={<AppIcon size={16} name="search" />}
				chevronIcon={<AppIcon size={14} name="chevron-down" />}
			/>
		);
	}
	if (numberOperators.has(operator)) {
		return input("value", "text", "number");
	}
	if (textOperators.has(operator)) {
		return input("value", "text", "text");
	}
	if (dateOperators.has(operator)) {
		return input("date", "text", "date");
	}
	if (operator === "between") {
		return (
			<div className="flex gap-2">
				{input("minimum", "text", "number")}
				{input("maximum", "second", "number")}
			</div>
		);
	}
	if (operator === "betweenDates") {
		return (
			<div className="flex gap-2">
				{input("from date", "text", "date")}
				{input("to date", "second", "date")}
			</div>
		);
	}
	if (operator === "withinLastDays") {
		return input("days", "text", "number", { min: 1, step: 1 });
	}
	return null;
}

const selectIcons = {
	checkIcon: <AppIcon size={14} name="check" />,
	chevronIcon: <AppIcon size={14} name="chevron-down" />,
};

function RuleRow({
	draft,
	index,
	fields,
	compact,
	onChange,
	onRemove,
}: {
	readonly index: number;
	readonly compact: boolean;
	readonly draft: FilterDraft;
	readonly onRemove: () => void;
	readonly onChange: (draft: FilterDraft) => void;
	readonly fields: readonly ViewFilterField[];
}) {
	const field = fields.find(({ key }) => key === draft.field);
	if (field === undefined) {
		return null;
	}
	const position = index + 1;
	return (
		<div
			role="group"
			aria-label={`Filter ${position}`}
			className="grid gap-2 rounded-lg border border-border bg-surface-2 p-3"
		>
			<div className={compact ? "grid gap-2" : "grid grid-cols-2 gap-2"}>
				<Select
					{...selectIcons}
					value={field.key}
					label={`Filter ${position} field`}
					choices={fields.map(({ key, label }) => ({ label, value: key }))}
					onChange={(key) => {
						const next = fields.find((candidate) => candidate.key === key);
						if (next !== undefined && next.key !== field.key) {
							onChange(newFilterDraft(next));
						}
					}}
				/>
				<Select
					{...selectIcons}
					value={draft.operator}
					label={`Filter ${position} operator`}
					choices={filterOperatorsFor(field).map((operator) => ({
						value: operator,
						label: operatorLabel(field, operator),
					}))}
					onChange={(operator) => {
						const next = filterOperatorsFor(field).find((candidate) => candidate === operator);
						if (next !== undefined) {
							onChange({ ...draft, text: "", second: "", operator: next });
						}
					}}
				/>
			</div>
			<div className="flex items-start gap-2">
				<div className="grid min-w-0 flex-1 gap-2">
					<ValueEditor
						field={field}
						draft={draft}
						onChange={(update) => onChange({ ...draft, ...update })}
					/>
				</div>
				<IconButton size="sm" onClick={onRemove} label={`Remove filter ${position}`}>
					<AppIcon name="x" size={16} />
				</IconButton>
			</div>
		</div>
	);
}

export function FilterRules({
	filter,
	fields,
	compact,
	onChange,
}: {
	readonly compact: boolean;
	readonly filter: ViewFilter | undefined;
	readonly onChange: (filter: ViewFilter | undefined) => void;
	readonly fields: readonly ViewFilterField[];
}) {
	const group = editableGroup(filter);
	const [state, setState] = useState<PanelState>(() =>
		toPanelState(group ?? { rules: [], match: "all" }),
	);
	const applied = encodeFilterParam(filter);
	useValueChange(applied, () => {
		if (group !== null && applied !== encodeFilterParam(stateFilter(state))) {
			setState(toPanelState(group));
		}
	});
	const commit = (next: PanelState) => {
		setState(next);
		onChange(stateFilter(next));
	};
	if (group === null) {
		return (
			<div className="mt-4 grid gap-2">
				<p className="text-xs text-text-muted">
					A custom filter is applied. Clear it to build one here.
				</p>
				<Button variant="secondary" onClick={() => onChange(undefined)}>
					Clear all
				</Button>
			</div>
		);
	}
	return (
		<div className="mt-4 grid gap-3">
			{state.rows.length >= 2 && (
				<SegmentedControl
					value={state.match}
					label="Match rules"
					optionClassName="px-3"
					onChange={(match) => commit({ ...state, match })}
					options={[
						{ value: "all", label: "Match all", content: "Match all" },
						{ value: "any", label: "Match any", content: "Match any" },
					]}
				/>
			)}
			{state.rows.map((row, index) => (
				<RuleRow
					key={row.id}
					index={index}
					fields={fields}
					draft={row.draft}
					compact={compact}
					onRemove={() => commit({ ...state, rows: state.rows.filter(({ id }) => id !== row.id) })}
					onChange={(draft) =>
						commit({
							...state,
							rows: state.rows.map((current) =>
								current.id === row.id ? { draft, id: row.id } : current,
							),
						})
					}
				/>
			))}
			<Select
				{...selectIcons}
				value=""
				label="Add filter"
				placeholder="Add filter"
				choices={fields.map(({ key, label }) => ({ label, value: key }))}
				onChange={(key) => {
					const next = fields.find((candidate) => candidate.key === key);
					if (next !== undefined) {
						commit({
							...state,
							nextId: state.nextId + 1,
							rows: [...state.rows, { id: state.nextId, draft: newFilterDraft(next) }],
						});
					}
				}}
			/>
			{state.rows.length > 0 && (
				<Button variant="ghost" onClick={() => commit({ ...state, rows: [] })}>
					Clear all
				</Button>
			)}
		</div>
	);
}

const chipClassName =
	"inline-flex h-7 max-w-full items-center rounded-pill border border-accent-border bg-accent-soft text-xs font-medium text-accent-text pointer-coarse:h-9";

function FilterChip({
	text,
	onOpen,
	onRemove,
	removeLabel,
}: {
	readonly text: string;
	readonly removeLabel: string;
	readonly onOpen: () => void;
	readonly onRemove?: (() => void) | undefined;
}) {
	return (
		<span className={chipClassName}>
			<button type="button" onClick={onOpen} className="min-w-0 truncate pr-1 pl-3">
				{text}
			</button>
			{onRemove !== undefined && (
				<button
					type="button"
					onClick={onRemove}
					aria-label={removeLabel}
					className="flex h-full items-center pr-2 pl-0.5"
				>
					<AppIcon name="x" size={12} />
				</button>
			)}
		</span>
	);
}

function LinkedRuleChip({
	ids,
	rule,
	field,
	onOpen,
	onRemove,
}: {
	readonly ids: readonly string[];
	readonly field: LinkedField;
	readonly rule: ViewFilterRule;
	readonly onOpen: () => void;
	readonly onRemove: () => void;
}) {
	const known = useRyotQuery(choicesQuery, choicesKey(field, { ids }));
	const labels = new Map((known.data ?? []).map(({ value, label }) => [value, label]));
	const values = "values" in rule ? rule.values : [];
	const resolved = values.every((value) => labels.has(value));
	const valueText = resolved ? ruleValueText(rule, (value) => labels.get(value) ?? value) : "";
	return (
		<FilterChip
			onOpen={onOpen}
			onRemove={onRemove}
			removeLabel={`Remove ${field.label} filter`}
			text={
				resolved ? ruleText(field, rule, valueText) : `${field.label}: ${values.length} selected`
			}
		/>
	);
}

export function FilterChips({
	filter,
	fields,
	onOpen,
	onChange,
}: {
	readonly onOpen: () => void;
	readonly filter: ViewFilter | undefined;
	readonly fields: readonly ViewFilterField[];
	readonly onChange: (filter: ViewFilter | undefined) => void;
}) {
	if (filter === undefined) {
		return null;
	}
	const group = editableGroup(filter);
	let chips: ReactNode;
	if (group === null) {
		chips = (
			<FilterChip
				onOpen={onOpen}
				text="Custom filter"
				removeLabel="Remove custom filter"
				onRemove={() => onChange(undefined)}
			/>
		);
	} else {
		const idsByField = new Map<string, readonly string[]>();
		for (const rule of group.rules) {
			if ("values" in rule) {
				idsByField.set(rule.field, [
					...new Set([...(idsByField.get(rule.field) ?? []), ...rule.values]),
				]);
			}
		}
		const remove = (index: number) =>
			onChange(
				groupFilter({ match: group.match, rules: group.rules.filter((_, at) => at !== index) }),
			);
		chips = (
			<>
				{group.match === "any" && group.rules.length > 1 && (
					<FilterChip onOpen={onOpen} text="Match any" removeLabel="Match any" />
				)}
				{group.rules.map((rule, index) => {
					const field = fields.find(({ key }) => key === rule.field);
					if (field === undefined) {
						return null;
					}
					const key = JSON.stringify([index, rule]);
					if (field.kind !== "value") {
						return (
							<LinkedRuleChip
								key={key}
								rule={rule}
								field={field}
								onOpen={onOpen}
								onRemove={() => remove(index)}
								ids={idsByField.get(rule.field) ?? []}
							/>
						);
					}
					const choices = new Map(fieldChoices(field).map(({ value, label }) => [value, label]));
					return (
						<FilterChip
							key={key}
							onOpen={onOpen}
							onRemove={() => remove(index)}
							removeLabel={`Remove ${field.label} filter`}
							text={ruleText(
								field,
								rule,
								ruleValueText(rule, (value) => choices.get(value) ?? value),
							)}
						/>
					);
				})}
			</>
		);
	}
	return (
		<div
			role="group"
			aria-label="Active filters"
			className="flex flex-wrap items-center gap-1.5 pb-2"
		>
			{chips}
			<Button
				size="sm"
				variant="ghost"
				onClick={() => onChange(undefined)}
				className="text-xs text-accent-text"
			>
				Clear
			</Button>
		</div>
	);
}
