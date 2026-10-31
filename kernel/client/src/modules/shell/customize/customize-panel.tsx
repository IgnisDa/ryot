import { ReorderableList } from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import { Effect } from "effect";
import { type ReactNode, type RefObject, useEffect, useRef } from "react";

import { impactHaptic, selectionHaptic } from "#/modules/device/haptics";
import { CustomizeHomeRow, CustomizeRow } from "#/modules/shell/customize/customize-row";
import {
	type CustomizeDraft,
	type CustomizeDraftItem,
	type CustomizeSection,
	customizeSectionCounts,
} from "#/modules/shell/customize/customize-state";

const ROW_HEIGHT = 44;

type CustomizePanelProps = {
	readonly readOnly?: boolean;
	readonly draft: CustomizeDraft;
	readonly initialSection?: undefined | CustomizeSection;
	readonly onToggle: (section: CustomizeSection, slug: string) => void;
	readonly onMove: (section: CustomizeSection, fromIndex: number, toIndex: number) => void;
};

type SectionProps = {
	readonly title: string;
	readonly readOnly?: boolean;
	readonly leading?: ReactNode;
	readonly emptyMessage?: string;
	readonly onToggle: (slug: string) => void;
	readonly items: readonly CustomizeDraftItem[];
	readonly scrollRef: RefObject<null | HTMLDivElement>;
	readonly anchorRef: (element: null | HTMLElement) => void;
	readonly onMove: (fromIndex: number, toIndex: number) => void;
	readonly counts: { readonly shown: number; readonly total: number };
	readonly toggleDisabled?: undefined | ((item: CustomizeDraftItem) => boolean);
};

export function CustomizePanel(props: CustomizePanelProps) {
	const scrollRef = useRef<HTMLDivElement>(null);
	const anchors = useRef(new Map<CustomizeSection, null | HTMLElement>());
	const initialSection = props.initialSection;
	const enabledWorkspaceCount = props.draft.workspaces.filter(({ isHidden }) => !isHidden).length;

	useEffect(() => {
		const scroller = scrollRef.current;
		const anchor = initialSection === undefined ? undefined : anchors.current.get(initialSection);
		if (scroller !== null && anchor !== undefined && anchor !== null) {
			scroller.scrollTop = anchor.offsetTop;
		}
	}, [initialSection]);

	const anchorRef = (section: CustomizeSection) => (element: null | HTMLElement) => {
		anchors.current.set(section, element);
	};

	return (
		<div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
			<div className="flex flex-col gap-5 px-3 pt-4.5 pb-5">
				<CustomizeSection
					title="Workspaces"
					scrollRef={scrollRef}
					readOnly={props.readOnly}
					items={props.draft.workspaces}
					anchorRef={anchorRef("workspaces")}
					emptyMessage="No workspaces available."
					onToggle={(slug) => props.onToggle("workspaces", slug)}
					toggleDisabled={(item) => !item.isHidden && enabledWorkspaceCount === 1}
					counts={customizeSectionCounts({ draft: props.draft, section: "workspaces" })}
					onMove={(fromIndex, toIndex) => props.onMove("workspaces", fromIndex, toIndex)}
				/>
				<CustomizeSection
					title="Views"
					scrollRef={scrollRef}
					readOnly={props.readOnly}
					items={props.draft.views}
					leading={<CustomizeHomeRow />}
					anchorRef={anchorRef("views")}
					onToggle={(slug) => props.onToggle("views", slug)}
					counts={customizeSectionCounts({ section: "views", draft: props.draft })}
					onMove={(fromIndex, toIndex) => props.onMove("views", fromIndex, toIndex)}
				/>
				<CustomizeSection
					title="Saved Views"
					scrollRef={scrollRef}
					readOnly={props.readOnly}
					items={props.draft.savedViews}
					emptyMessage="No saved views yet."
					anchorRef={anchorRef("savedViews")}
					onToggle={(slug) => props.onToggle("savedViews", slug)}
					counts={customizeSectionCounts({ draft: props.draft, section: "savedViews" })}
					onMove={(fromIndex, toIndex) => props.onMove("savedViews", fromIndex, toIndex)}
				/>
				<p className="flex items-start gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2.5 text-xs leading-5 text-text-muted">
					<AppIcon size={15} name="info" className="mt-0.5 shrink-0" />
					<span className="min-w-0 flex-1">
						Collections are always shown and are not included in sidebar customization.
					</span>
				</p>
			</div>
		</div>
	);
}

function CustomizeSection({ anchorRef, scrollRef, ...props }: SectionProps) {
	return (
		<section className="flex flex-col gap-1.5">
			<h2
				ref={anchorRef}
				className="px-1 text-xs font-semibold uppercase tracking-[1.6px] text-text-subtle"
			>
				{props.title} · {props.counts.shown} of {props.counts.total} shown
			</h2>
			<div className="overflow-hidden rounded-lg border border-border bg-raised">
				{props.leading}
				{props.items.length === 0 && props.emptyMessage !== undefined && (
					<p className="px-2 py-1 text-xs text-text-subtle">{props.emptyMessage}</p>
				)}
				{props.items.length > 0 && (
					<ReorderableList
						label={props.title}
						items={props.items}
						scrollRef={scrollRef}
						itemHeight={ROW_HEIGHT}
						onReorder={props.onMove}
						itemKey={(item) => item.id}
						itemLabel={(item) => item.name}
						onPickUp={() => Effect.runFork(impactHaptic)}
						onDrop={() => Effect.runFork(selectionHaptic)}
						handleIcon={<AppIcon size={18} name="grip-vertical" />}
						renderItem={({ item, index, handle }) => (
							<CustomizeRow
								item={item}
								handle={handle}
								readOnly={props.readOnly}
								onToggle={props.onToggle}
								isLast={index === props.items.length - 1}
								toggleDisabled={props.toggleDisabled?.(item)}
							/>
						)}
					/>
				)}
			</div>
		</section>
	);
}
