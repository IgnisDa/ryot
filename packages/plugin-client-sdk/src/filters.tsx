import {
	type RatingScale,
	ratingScales,
	scaledRangeBound,
	threePointRatings,
} from "@ryot-app/contract/modules/events/rating-scale";
import {
	filterOperatorEntitlement,
	filterRuleCountEntitlement,
} from "@ryot-app/contract/modules/filters/schemas";
import { formatDisplayText } from "@ryot-app/i18n/format";
import type { Formatters } from "@ryot-app/i18n/formatters";
import type { Message } from "@ryot-app/i18n/message";
import { useFormatters, useT } from "@ryot-app/i18n/react";
import type { Text } from "@ryot-app/i18n/text";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
import {
	Button,
	entitlementActionLabel,
	IconButton,
	type MetricFormat,
	Modal,
	ModalClose,
	MultiSelect,
	SegmentedControl,
	Select,
	TextField,
	useMetricFormat,
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
	type FilterDraft,
	groupFilter,
	type LinkedFilterChoices,
	LinkedFilterChoicesInput,
	linkedFilterChoicesInput,
	linkedFilterChoicesRecipe,
	newFilterDraft,
	ratingDraftFromRule,
	ratingDraftRule,
} from "@ryot-app/ryotql-recipes/filters";
import { type FilterFieldSpec, filterOperatorsFor } from "@ryot-app/ryotql/filters";
import { Effect, Schema } from "effect";
import { type ReactNode, type RefObject, useDeferredValue, useState } from "react";

import { usePluginLocation } from "./navigation/routing";
import { useEntitlement } from "./queries/account";
import { createRyotQuery } from "./queries/definitions";
import { useRyotQuery } from "./queries/hooks";
import { PreferencesGate } from "./queries/preferences-gate";
import { useRyot } from "./queries/provider";

export type ViewFilterField = FilterFieldSpec;
export type ViewFilter = NonNullable<ReturnType<typeof decodeFilterParam>>;
type RuleGroup = NonNullable<ReturnType<typeof editableGroup>>;
type ViewFilterRule = NonNullable<ReturnType<typeof draftRule>>;
type FilterOperator = ReturnType<typeof filterOperatorsFor>[number];
type LinkedField = Exclude<ViewFilterField, { readonly kind: "value" }>;

export const activeFiltersMessage = (count: number) =>
	kernelMessage("sdk.filters.active-count", { count });

export const useViewFilter = (fields: readonly ViewFilterField[]) => {
	const ryot = useRyot();
	const { search } = usePluginLocation();
	const filter = decodeFilterParam(new URLSearchParams(search).get("filters"), fields);
	return {
		filter,
		activeCount: activeRuleCount(filter),
		setFilter: (next: undefined | ViewFilter) =>
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
	readonly title: Text;
	readonly compact: boolean;
	readonly onClose: () => void;
	readonly children: ReactNode;
	readonly triggerRef?: undefined | RefObject<null | HTMLElement>;
}) {
	const t = useT();
	return (
		<Modal
			{...(compact ? { kind: "drawer", placement: "sheet" } : { kind: "dialog" })}
			label={title}
			onClose={onClose}
			triggerRef={triggerRef}
			containerClassName={compact ? "items-end justify-center" : "items-center justify-center p-4"}
			className={
				compact
					? "max-h-[90%] w-full overflow-y-auto rounded-t-xl border-t border-border bg-surface p-5"
					: "max-h-[90%] w-full max-w-xl overflow-y-auto rounded-xl border border-border bg-surface p-5"
			}
		>
			<div className="flex items-center justify-between gap-2">
				<h2 className="font-display text-lg font-semibold text-text">{title}</h2>
				<ModalClose label={t(kernelMessage("common.action.close"))} />
			</div>
			{children}
		</Modal>
	);
}

const decodeChoicesInput = Schema.decodeUnknownEffect(
	Schema.fromJsonString(LinkedFilterChoicesInput),
);

const choicesQuery = createRyotQuery<string, LinkedFilterChoices>(({ input, client }) =>
	decodeChoicesInput(input).pipe(
		Effect.orDie,
		Effect.flatMap((request) =>
			request.ids?.length === 0
				? Effect.succeed<LinkedFilterChoices>([])
				: client.data.query(linkedFilterChoicesRecipe({ link: request.link }), {
						...(request.ids === undefined ? {} : { ids: request.ids }),
						...(request.searchText === undefined ? {} : { searchText: request.searchText.trim() }),
					}),
		),
	),
);

const choicesKey = (
	field: LinkedField,
	extra: { readonly searchText?: string; readonly ids?: readonly string[] },
) => JSON.stringify(linkedFilterChoicesInput(field, extra));

type RuleText = { readonly field: string; readonly value: string };
type OperatorMessages = { readonly label: Message; readonly rule: (text: RuleText) => Message };

const operatorMessages: Readonly<Record<FilterOperator, OperatorMessages>> = {
	is: {
		label: kernelMessage("sdk.filters.operator.is"),
		rule: (text) => kernelMessage("sdk.filters.rule.is", text),
	},
	eq: {
		label: kernelMessage("sdk.filters.operator.eq"),
		rule: (text) => kernelMessage("sdk.filters.rule.eq", text),
	},
	lte: {
		label: kernelMessage("sdk.filters.operator.lte"),
		rule: (text) => kernelMessage("sdk.filters.rule.lte", text),
	},
	gte: {
		label: kernelMessage("sdk.filters.operator.gte"),
		rule: (text) => kernelMessage("sdk.filters.rule.gte", text),
	},
	after: {
		label: kernelMessage("sdk.filters.operator.after"),
		rule: (text) => kernelMessage("sdk.filters.rule.after", text),
	},
	anyOf: {
		label: kernelMessage("sdk.filters.operator.any-of"),
		rule: (text) => kernelMessage("sdk.filters.rule.any-of", text),
	},
	allOf: {
		label: kernelMessage("sdk.filters.operator.all-of"),
		rule: (text) => kernelMessage("sdk.filters.rule.all-of", text),
	},
	before: {
		label: kernelMessage("sdk.filters.operator.before"),
		rule: (text) => kernelMessage("sdk.filters.rule.before", text),
	},
	noneOf: {
		label: kernelMessage("sdk.filters.operator.none-of"),
		rule: (text) => kernelMessage("sdk.filters.rule.none-of", text),
	},
	between: {
		label: kernelMessage("sdk.filters.operator.between"),
		rule: (text) => kernelMessage("sdk.filters.rule.between", text),
	},
	contains: {
		label: kernelMessage("sdk.filters.operator.contains"),
		rule: (text) => kernelMessage("sdk.filters.rule.contains", text),
	},
	empty: {
		label: kernelMessage("sdk.filters.operator.empty"),
		rule: ({ field }) => kernelMessage("sdk.filters.rule.empty", { field }),
	},
	betweenDates: {
		label: kernelMessage("sdk.filters.operator.between"),
		rule: (text) => kernelMessage("sdk.filters.rule.between", text),
	},
	isTrue: {
		label: kernelMessage("sdk.filters.operator.is-true"),
		rule: ({ field }) => kernelMessage("sdk.filters.rule.is-true", { field }),
	},
	isFalse: {
		label: kernelMessage("sdk.filters.operator.is-false"),
		rule: ({ field }) => kernelMessage("sdk.filters.rule.is-false", { field }),
	},
	notContains: {
		label: kernelMessage("sdk.filters.operator.not-contains"),
		rule: (text) => kernelMessage("sdk.filters.rule.not-contains", text),
	},
	notEmpty: {
		label: kernelMessage("sdk.filters.operator.not-empty"),
		rule: ({ field }) => kernelMessage("sdk.filters.rule.not-empty", { field }),
	},
	withinLastDays: {
		label: kernelMessage("sdk.filters.operator.within-last-days"),
		rule: (text) => kernelMessage("sdk.filters.rule.within-last-days", text),
	},
};

const listOperatorMessages: Partial<Record<FilterOperator, OperatorMessages>> = {
	anyOf: {
		label: kernelMessage("sdk.filters.operator.list-any-of"),
		rule: (text) => kernelMessage("sdk.filters.rule.list-any-of", text),
	},
	noneOf: {
		label: kernelMessage("sdk.filters.operator.list-none-of"),
		rule: (text) => kernelMessage("sdk.filters.rule.list-none-of", text),
	},
};

const operatorMessagesFor = (field: ViewFilterField, operator: FilterOperator) =>
	(field.kind !== "value" || field.type === "enum-list"
		? listOperatorMessages[operator]
		: undefined) ?? operatorMessages[operator];

const fieldChoices = (t: Translate, field: ViewFilterField) =>
	"choices" in field
		? field.choices.map(({ value, label }) => ({ value, label: formatDisplayText(t, label) }))
		: [];

const isRatingField = (field: ViewFilterField) => field.kind === "value" && field.type === "rating";

type Translate = (message: Message) => Text;

const threePointMessage = (index: number) =>
	kernelMessage("ui.rating.three-point", { rating: threePointRatings[index] ?? "neutral" });

const ratingBoundText = (
	t: Translate,
	format: MetricFormat,
	stored: number,
	bound: "min" | "max",
	scale: RatingScale,
) =>
	scale === "three-point"
		? t(threePointMessage(scaledRangeBound(stored, bound, scale)))
		: format.formatRating(stored, scale);

const ratingRuleValueText = (
	t: Translate,
	format: MetricFormat,
	rule: ViewFilterRule,
	scale: RatingScale,
) => {
	if (rule.operator === "gte" || rule.operator === "lte") {
		return ratingBoundText(t, format, rule.value, rule.operator === "gte" ? "min" : "max", scale);
	}
	return rule.operator === "between"
		? t(
				kernelMessage("sdk.filters.range-value", {
					min: ratingBoundText(t, format, rule.min, "min", scale),
					max: ratingBoundText(t, format, rule.max, "max", scale),
				}),
			)
		: "";
};

const ruleValueText = (
	t: Translate,
	formatters: Formatters,
	rule: ViewFilterRule,
	labelOf: (value: string) => string,
) => {
	if ("values" in rule) {
		return formatters.list({ type: "unit", style: "short" }).format(rule.values.map(labelOf));
	}
	if ("value" in rule) {
		return String(rule.value);
	}
	if ("min" in rule) {
		return t(
			kernelMessage("sdk.filters.range-value", { min: String(rule.min), max: String(rule.max) }),
		);
	}
	if ("from" in rule) {
		return t(kernelMessage("sdk.filters.range-value", { max: rule.to, min: rule.from }));
	}
	return "days" in rule ? t(kernelMessage("sdk.filters.days-value", { days: rule.days })) : "";
};

const ruleText = (t: Translate, field: ViewFilterField, rule: ViewFilterRule, value: string) =>
	t(
		operatorMessagesFor(field, rule.operator).rule({
			value,
			field: formatDisplayText(t, field.label),
		}),
	);

type RatingScaleOf = (fieldKey: string) => undefined | RatingScale;

type PanelRow = { readonly id: number; readonly draft: FilterDraft };

type PanelState = {
	readonly nextId: number;
	readonly rows: readonly PanelRow[];
	readonly match: RuleGroup["match"];
};

const toPanelState = (source: RuleGroup, scaleOf: RatingScaleOf): PanelState => ({
	match: source.match,
	nextId: source.rules.length,
	rows: source.rules.map((rule, id) => {
		const scale = scaleOf(rule.field);
		return {
			id,
			draft: scale === undefined ? draftFromRule(rule) : ratingDraftFromRule(rule, scale),
		};
	}),
});

const stateFilter = (state: PanelState, scaleOf: RatingScaleOf) =>
	groupFilter({
		match: state.match,
		rules: state.rows.flatMap(({ draft }) => {
			const scale = scaleOf(draft.field);
			const rule = scale === undefined ? draftRule(draft) : ratingDraftRule(draft, scale);
			return rule === undefined ? [] : [rule];
		}),
	});

const ratingScaleOf =
	(fields: readonly ViewFilterField[], scale: RatingScale): RatingScaleOf =>
	(fieldKey) => {
		const field = fields.find(({ key }) => key === fieldKey);
		return field !== undefined && isRatingField(field) ? scale : undefined;
	};

function LinkedValueEditor({
	field,
	selected,
	onChange,
}: {
	readonly field: LinkedField;
	readonly selected: readonly string[];
	readonly onChange: (values: readonly string[]) => void;
}) {
	const t = useT();
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
	const resolved = selected.every((value) => choices.some((choice) => choice.value === value));
	return (
		<MultiSelect
			selected={selected}
			onChange={onChange}
			label={formatDisplayText(t, field.label)}
			search={{ query: search, onChange: setSearch, pending: page.isPending }}
			choices={choices.map(({ value, label }) => ({ value, label: formatDisplayText(t, label) }))}
			{...(!resolved && {
				unresolvedSummary: t(
					kernelMessage("sdk.selection.selected-count", { count: selected.length }),
				),
			})}
		/>
	);
}

const listOperators: ReadonlySet<FilterOperator> = new Set(["anyOf", "allOf", "noneOf"]);
const numberOperators: ReadonlySet<FilterOperator> = new Set(["eq", "gte", "lte"]);
const textOperators: ReadonlySet<FilterOperator> = new Set(["is", "contains", "notContains"]);
const dateOperators: ReadonlySet<FilterOperator> = new Set(["after", "before"]);

function ValueEditor({
	draft,
	field,
	scale,
	onChange,
}: {
	readonly scale: RatingScale;
	readonly draft: FilterDraft;
	readonly field: ViewFilterField;
	readonly onChange: (update: Partial<FilterDraft>) => void;
}) {
	const t = useT();
	const { operator } = draft;
	const rating = isRatingField(field) ? ratingScales[scale] : undefined;
	const input = (
		role: "to" | "date" | "days" | "from" | "value" | "maximum" | "minimum",
		key: "text" | "second",
		type: "text" | "date" | "number",
		extra: { readonly min?: number; readonly max?: number; readonly step?: number } = {},
	) =>
		rating?.input === "choices" ? (
			<Select
				{...selectIcons}
				value={draft[key]}
				onChange={(value) => onChange({ [key]: value })}
				placeholder={t(kernelMessage("sdk.filters.select-rating"))}
				label={t(kernelMessage("sdk.filters.value-input", { role, field: field.label }))}
				choices={threePointRatings.map((_, index) => ({
					value: String(index),
					label: t(threePointMessage(index)),
				}))}
			/>
		) : (
			<TextField
				{...extra}
				type={type}
				density="compact"
				value={draft[key]}
				className="min-w-0 flex-1"
				onChange={(event) => onChange({ [key]: event.currentTarget.value })}
				aria-label={t(kernelMessage("sdk.filters.value-input", { role, field: field.label }))}
			/>
		);
	const numberExtra = rating === undefined ? {} : { min: 0, max: rating.max, step: rating.step };
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
				choices={fieldChoices(t, field)}
				closeIcon={<AppIcon name="x" size={18} />}
				onChange={(values) => onChange({ values })}
				checkIcon={<AppIcon size={14} name="check" />}
				searchIcon={<AppIcon size={16} name="search" />}
				chevronIcon={<AppIcon size={14} name="chevron-down" />}
				label={t(kernelMessage("sdk.filters.values", { field: field.label }))}
			/>
		);
	}
	if (numberOperators.has(operator)) {
		return input("value", "text", "number", numberExtra);
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
				{input("minimum", "text", "number", numberExtra)}
				{input("maximum", "second", "number", numberExtra)}
			</div>
		);
	}
	if (operator === "betweenDates") {
		return (
			<div className="flex gap-2">
				{input("from", "text", "date")}
				{input("to", "second", "date")}
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

type FilterRulesProps = {
	readonly compact: boolean;
	readonly filter: undefined | ViewFilter;
	readonly fields: readonly ViewFilterField[];
	readonly onChange: (filter: undefined | ViewFilter) => void;
};

export function FilterRules(props: FilterRulesProps) {
	return props.fields.some(isRatingField) ? (
		<RatingScaleStatus>
			{(scale) => <FilterRulesPanel {...props} scale={scale} />}
		</RatingScaleStatus>
	) : (
		<FilterRulesPanel {...props} scale="hundred" />
	);
}

function RatingScaleStatus(props: { readonly children: (scale: RatingScale) => ReactNode }) {
	return <PreferencesGate>{({ ratingScale }) => props.children(ratingScale)}</PreferencesGate>;
}

const filterFieldChoices = (
	t: Translate,
	fields: readonly ViewFilterField[],
	draftFor: (field: ViewFilterField) => undefined | FilterDraft,
	current?: string,
) =>
	fields.map((field) => {
		const granted = field.key === current || draftFor(field) !== undefined;
		return {
			value: field.key,
			disabled: !granted,
			label: entitlementActionLabel(t, formatDisplayText(t, field.label), "pro", granted),
		};
	});

function RuleRow({
	draft,
	index,
	scale,
	fields,
	allowed,
	compact,
	draftFor,
	onChange,
	onRemove,
}: {
	readonly index: number;
	readonly compact: boolean;
	readonly scale: RatingScale;
	readonly draft: FilterDraft;
	readonly onRemove: () => void;
	readonly fields: readonly ViewFilterField[];
	readonly onChange: (draft: FilterDraft) => void;
	readonly allowed: (operator: FilterOperator) => boolean;
	readonly draftFor: (field: ViewFilterField) => undefined | FilterDraft;
}) {
	const t = useT();
	const field = fields.find(({ key }) => key === draft.field);
	if (field === undefined) {
		return null;
	}
	const position = index + 1;
	return (
		<div
			role="group"
			aria-label={t(kernelMessage("sdk.filters.rule-group", { position }))}
			className="grid gap-2 rounded-lg border border-border bg-surface-2 p-3"
		>
			<div className={compact ? "grid gap-2" : "grid grid-cols-2 gap-2"}>
				<Select
					{...selectIcons}
					value={field.key}
					choices={filterFieldChoices(t, fields, draftFor, field.key)}
					label={t(kernelMessage("sdk.filters.rule-field", { position }))}
					onChange={(key) => {
						const next = fields.find((candidate) => candidate.key === key);
						const nextDraft = next === undefined ? undefined : draftFor(next);
						if (next !== undefined && next.key !== field.key && nextDraft !== undefined) {
							onChange(nextDraft);
						}
					}}
				/>
				<Select
					{...selectIcons}
					value={draft.operator}
					label={t(kernelMessage("sdk.filters.rule-operator", { position }))}
					onChange={(operator) => {
						const next = filterOperatorsFor(field).find((candidate) => candidate === operator);
						if (next !== undefined && allowed(next)) {
							onChange({ ...draft, text: "", second: "", operator: next });
						}
					}}
					choices={filterOperatorsFor(field).map((operator) => {
						const granted = operator === draft.operator || allowed(operator);
						return {
							value: operator,
							disabled: !granted,
							label: entitlementActionLabel(
								t,
								t(operatorMessagesFor(field, operator).label),
								"pro",
								granted,
							),
						};
					})}
				/>
			</div>
			<div className="flex items-start gap-2">
				<div className="grid min-w-0 flex-1 gap-2">
					<ValueEditor
						field={field}
						draft={draft}
						scale={scale}
						onChange={(update) => onChange({ ...draft, ...update })}
					/>
				</div>
				<IconButton
					size="sm"
					onClick={onRemove}
					label={t(kernelMessage("sdk.filters.remove-rule", { position }))}
				>
					<AppIcon name="x" size={16} />
				</IconButton>
			</div>
		</div>
	);
}

function FilterRulesPanel({
	scale,
	filter,
	fields,
	compact,
	onChange,
}: FilterRulesProps & { readonly scale: RatingScale }) {
	const t = useT();
	const group = editableGroup(filter);
	const scaleOf = ratingScaleOf(fields, scale);
	const [state, setState] = useState<PanelState>(() =>
		toPanelState(group ?? { rules: [], match: "all" }, scaleOf),
	);
	const applied = encodeFilterParam(filter);
	useValueChange(applied, () => {
		if (group !== null && applied !== encodeFilterParam(stateFilter(state, scaleOf))) {
			setState(toPanelState(group, scaleOf));
		}
	});
	const commit = (next: PanelState) => {
		setState(next);
		onChange(stateFilter(next, scaleOf));
	};
	const pro = useEntitlement("pro");
	const allowed = (operator: FilterOperator) =>
		pro.granted || filterOperatorEntitlement(operator) === undefined;
	const draftFor = (field: ViewFilterField) => {
		const operator = filterOperatorsFor(field).find(allowed);
		return operator === undefined ? undefined : { ...newFilterDraft(field), operator };
	};
	const canAdd = pro.granted || filterRuleCountEntitlement(state.rows.length + 1) === undefined;
	if (group === null) {
		return (
			<div className="mt-4 grid gap-2">
				<p className="text-xs text-text-muted">{t(kernelMessage("sdk.filters.custom-applied"))}</p>
				<Button variant="secondary" onClick={() => onChange(undefined)}>
					{t(kernelMessage("sdk.filters.clear-all"))}
				</Button>
			</div>
		);
	}
	return (
		<div className="mt-4 grid gap-3">
			{state.rows.length >= 2 && (
				<SegmentedControl
					value={state.match}
					optionClassName="px-3"
					onChange={(match) => commit({ ...state, match })}
					label={t(kernelMessage("sdk.filters.match-rules"))}
					options={(["all", "any"] as const).map((match) => {
						const label = t(kernelMessage("sdk.filters.match", { match }));
						return { label, value: match, content: label };
					})}
				/>
			)}
			{state.rows.map((row, index) => (
				<RuleRow
					key={row.id}
					index={index}
					scale={scale}
					fields={fields}
					draft={row.draft}
					compact={compact}
					allowed={allowed}
					draftFor={draftFor}
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
				disabled={!canAdd}
				label={t(kernelMessage("sdk.filters.add"))}
				choices={filterFieldChoices(t, fields, draftFor)}
				placeholder={entitlementActionLabel(t, t(kernelMessage("sdk.filters.add")), "pro", canAdd)}
				onChange={(key) => {
					const next = fields.find((candidate) => candidate.key === key);
					const draft = next === undefined ? undefined : draftFor(next);
					if (draft !== undefined) {
						commit({
							...state,
							nextId: state.nextId + 1,
							rows: [...state.rows, { draft, id: state.nextId }],
						});
					}
				}}
			/>
			{state.rows.length > 0 && (
				<Button variant="ghost" onClick={() => commit({ ...state, rows: [] })}>
					{t(kernelMessage("sdk.filters.clear-all"))}
				</Button>
			)}
		</div>
	);
}

const chipClassName =
	"inline-flex h-7 max-w-full items-center rounded-pill border border-accent-border bg-accent-soft text-xs font-medium text-accent-text pointer-coarse:h-9";

type FilterChipsProps = {
	readonly onOpen: () => void;
	readonly filter: undefined | ViewFilter;
	readonly fields: readonly ViewFilterField[];
	readonly onChange: (filter: undefined | ViewFilter) => void;
};

export function FilterChips(props: FilterChipsProps) {
	if (props.filter === undefined) {
		return null;
	}
	return props.fields.some(isRatingField) ? (
		<RatingScaleStatus>{(scale) => <FilterChipsList {...props} scale={scale} />}</RatingScaleStatus>
	) : (
		<FilterChipsList {...props} scale="hundred" />
	);
}

function FilterChip({
	text,
	onOpen,
	onRemove,
	removeLabel,
}: {
	readonly text: string;
	readonly removeLabel: Text;
	readonly onOpen: () => void;
	readonly onRemove?: undefined | (() => void);
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
	readonly field: LinkedField;
	readonly onOpen: () => void;
	readonly rule: ViewFilterRule;
	readonly onRemove: () => void;
	readonly ids: readonly string[];
}) {
	const t = useT();
	const formatters = useFormatters();
	const known = useRyotQuery(choicesQuery, choicesKey(field, { ids }));
	const labels = new Map((known.data ?? []).map(({ value, label }) => [value, label]));
	const values = "values" in rule ? rule.values : [];
	const resolved = values.every((value) => labels.has(value));
	const valueText = resolved
		? ruleValueText(t, formatters, rule, (value) => labels.get(value) ?? value)
		: "";
	return (
		<FilterChip
			onOpen={onOpen}
			onRemove={onRemove}
			removeLabel={t(kernelMessage("sdk.filters.remove-field-rule", { field: field.label }))}
			text={
				resolved
					? ruleText(t, field, rule, valueText)
					: t(
							kernelMessage("sdk.filters.unresolved-rule", {
								field: field.label,
								count: values.length,
							}),
						)
			}
		/>
	);
}

function FilterChipsList({
	scale,
	filter,
	fields,
	onOpen,
	onChange,
}: FilterChipsProps & { readonly scale: RatingScale }) {
	const t = useT();
	const formatters = useFormatters();
	const format = useMetricFormat();
	if (filter === undefined) {
		return null;
	}
	const group = editableGroup(filter);
	let chips: ReactNode;
	if (group === null) {
		chips = (
			<FilterChip
				onOpen={onOpen}
				onRemove={() => onChange(undefined)}
				text={t(kernelMessage("sdk.filters.custom"))}
				removeLabel={t(kernelMessage("sdk.filters.remove-custom"))}
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
					<FilterChip
						onOpen={onOpen}
						text={t(kernelMessage("sdk.filters.match", { match: "any" }))}
						removeLabel={t(kernelMessage("sdk.filters.match", { match: "any" }))}
					/>
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
					const choices = new Map(fieldChoices(t, field).map(({ value, label }) => [value, label]));
					const chip = (valueText: string) => (
						<FilterChip
							key={key}
							onOpen={onOpen}
							onRemove={() => remove(index)}
							text={ruleText(t, field, rule, valueText)}
							removeLabel={t(
								kernelMessage("sdk.filters.remove-field-rule", { field: field.label }),
							)}
						/>
					);
					return isRatingField(field)
						? chip(ratingRuleValueText(t, format, rule, scale))
						: chip(ruleValueText(t, formatters, rule, (value) => choices.get(value) ?? value));
				})}
			</>
		);
	}
	return (
		<div
			role="group"
			aria-label={t(kernelMessage("sdk.filters.active"))}
			className="flex flex-wrap items-center gap-1.5 pb-2"
		>
			{chips}
			<Button
				size="sm"
				variant="ghost"
				onClick={() => onChange(undefined)}
				className="text-xs text-accent-text"
			>
				{t(kernelMessage("sdk.selection.clear"))}
			</Button>
		</div>
	);
}

export type { FilterTarget } from "@ryot-app/ryotql/filters";
export { collectionsFilterField } from "@ryot-app/ryotql-recipes/filters";
export type { QueryFilterField } from "@ryot-app/contract/modules/filters/schemas";
