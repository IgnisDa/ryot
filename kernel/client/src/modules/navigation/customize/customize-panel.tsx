import { ReorderableList } from "@ryot-app/client-ui-sdk";
import { AppIcon } from "@ryot-app/client-ui-sdk/icon";
import { useEffect, useRef, type ReactNode, type RefObject } from "react";

import { CustomizeHomeRow, CustomizeRow } from "#/modules/navigation/customize/customize-row";
import {
	customizeSectionCounts,
	type CustomizeDraft,
	type CustomizeDraftItem,
	type CustomizeSection,
} from "#/modules/navigation/customize/customize-state";
import { impactLight, selectionChanged } from "#/modules/navigation/haptics";

const ROW_HEIGHT = 44;

type CustomizePanelProps = {
	readonly draft: CustomizeDraft;
	readonly initialSection?: CustomizeSection | undefined;
	readonly onToggle: (section: CustomizeSection, slug: string) => void;
	readonly onMove: (section: CustomizeSection, fromIndex: number, toIndex: number) => void;
};

type SectionProps = {
	readonly title: string;
	readonly leading?: ReactNode;
	readonly emptyMessage?: string;
	readonly onToggle: (slug: string) => void;
	readonly items: readonly CustomizeDraftItem[];
	readonly scrollRef: RefObject<HTMLDivElement | null>;
	readonly anchorRef: (element: HTMLElement | null) => void;
	readonly onMove: (fromIndex: number, toIndex: number) => void;
	readonly counts: { readonly shown: number; readonly total: number };
	readonly toggleDisabled?: ((item: CustomizeDraftItem) => boolean) | undefined;
};

function CustomizeSection(props: SectionProps) {
	return (
		<section className="flex flex-col gap-1.5">
			<h2
				ref={props.anchorRef}
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
						onPickUp={impactLight}
						itemHeight={ROW_HEIGHT}
						onReorder={props.onMove}
						onDrop={selectionChanged}
						scrollRef={props.scrollRef}
						itemKey={(item) => item.slug}
						itemLabel={(item) => item.name}
						handleIcon={<AppIcon name="grip-vertical" size={18} />}
						renderItem={({ handle, index, item }) => (
							<CustomizeRow
								item={item}
								handle={handle}
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

export function CustomizePanel(props: CustomizePanelProps) {
	const scrollRef = useRef<HTMLDivElement>(null);
	const anchors = useRef(new Map<CustomizeSection, HTMLElement | null>());
	const initialSection = props.initialSection;
	const enabledWorkspaceCount = props.draft.workspaces.filter(
		({ isDisabled }) => !isDisabled,
	).length;

	useEffect(() => {
		const scroller = scrollRef.current;
		const anchor = initialSection === undefined ? undefined : anchors.current.get(initialSection);
		if (scroller !== null && anchor !== undefined && anchor !== null) {
			scroller.scrollTop = anchor.offsetTop;
		}
	}, [initialSection]);

	const anchorRef = (section: CustomizeSection) => (element: HTMLElement | null) => {
		anchors.current.set(section, element);
	};

	return (
		<div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
			<div className="flex flex-col gap-5 px-3 pt-4.5 pb-5">
				<CustomizeSection
					title="Workspaces"
					scrollRef={scrollRef}
					items={props.draft.workspaces}
					emptyMessage="No workspaces available."
					anchorRef={anchorRef("workspaces")}
					onToggle={(slug) => props.onToggle("workspaces", slug)}
					toggleDisabled={(item) => !item.isDisabled && enabledWorkspaceCount === 1}
					counts={customizeSectionCounts({ draft: props.draft, section: "workspaces" })}
					onMove={(fromIndex, toIndex) => props.onMove("workspaces", fromIndex, toIndex)}
				/>
				<CustomizeSection
					title="Views"
					scrollRef={scrollRef}
					items={props.draft.views}
					leading={<CustomizeHomeRow />}
					anchorRef={anchorRef("views")}
					onToggle={(slug) => props.onToggle("views", slug)}
					counts={customizeSectionCounts({ draft: props.draft, section: "views" })}
					onMove={(fromIndex, toIndex) => props.onMove("views", fromIndex, toIndex)}
				/>
				<CustomizeSection
					title="Saved Views"
					scrollRef={scrollRef}
					items={props.draft.savedViews}
					emptyMessage="No saved views yet."
					anchorRef={anchorRef("savedViews")}
					onToggle={(slug) => props.onToggle("savedViews", slug)}
					counts={customizeSectionCounts({ draft: props.draft, section: "savedViews" })}
					onMove={(fromIndex, toIndex) => props.onMove("savedViews", fromIndex, toIndex)}
				/>
				<p className="flex items-start gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2.5 text-xs leading-5 text-text-muted">
					<AppIcon name="info" size={15} className="mt-0.5 shrink-0" />
					<span className="min-w-0 flex-1">
						Collections are always shown and are not included in sidebar customization.
					</span>
				</p>
			</div>
		</div>
	);
}
