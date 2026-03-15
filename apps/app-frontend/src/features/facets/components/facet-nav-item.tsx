import { ActionIcon, Group, NavLink, Tooltip } from "@mantine/core";
import { Link } from "@tanstack/react-router";
import {
	ChevronDown,
	ChevronUp,
	Pencil,
	ToggleLeft,
	ToggleRight,
} from "lucide-react";
import type { MouseEvent } from "react";
import { useEntitySchemasQuery } from "#/features/entity-schemas/hooks";
import type { AppSavedView } from "#/features/saved-views/model";
import { getSavedViewsForFacet } from "#/features/saved-views/model";
import { FacetIcon } from "../icons";
import type { TrackingNavItem } from "../nav";
import {
	useFacetSidebarActions,
	useFacetSidebarState,
} from "../sidebar-context";
import { getFacetNavActionUi } from "./facet-nav-item-ui";

interface FacetNavItemProps {
	isLast: boolean;
	isFirst: boolean;
	facet: TrackingNavItem;
	savedViews: AppSavedView[];
}

function stopEvent(event: MouseEvent<HTMLButtonElement>) {
	event.preventDefault();
	event.stopPropagation();
}

export function FacetNavItem(props: FacetNavItemProps) {
	const state = useFacetSidebarState();
	const actions = useFacetSidebarActions();
	const toggleUi = getFacetNavActionUi(props.facet);
	const actionsVisible = state.isCustomizeMode;

	const entitySchemasQuery = useEntitySchemasQuery(
		props.facet.facetId,
		!props.facet.isBuiltin,
	);
	const entitySchemaIds = entitySchemasQuery.entitySchemas.map(
		(schema) => schema.id,
	);
	const facetSavedViews = getSavedViewsForFacet(
		props.savedViews,
		entitySchemaIds,
	);

	return (
		<div>
			<NavLink
				variant="light"
				label={props.facet.label}
				defaultOpened={facetSavedViews.length > 0}
				leftSection={<FacetIcon icon={props.facet.icon} />}
				description={props.facet.enabled ? undefined : "Disabled"}
				style={{
					transition: "opacity 120ms ease",
					opacity: props.facet.enabled ? 1 : 0.62,
				}}
				renderRoot={(rootProps) => (
					<Link
						{...rootProps}
						to="/tracking/$facetSlug"
						params={{ facetSlug: props.facet.facetSlug }}
					/>
				)}
				rightSection={
					<Group
						gap={4}
						wrap="nowrap"
						style={{
							opacity: actionsVisible ? 1 : 0,
							transition: "opacity 120ms ease",
							pointerEvents: actionsVisible ? "auto" : "none",
						}}
					>
						{props.facet.isBuiltin ? undefined : (
							<Tooltip label="Edit facet">
								<ActionIcon
									size="sm"
									variant="subtle"
									aria-label="Edit facet"
									disabled={state.isMutationBusy}
									tabIndex={actionsVisible ? 0 : -1}
									onClick={(event) => {
										stopEvent(event);
										actions.openEditModal(props.facet.facetId);
									}}
								>
									<Pencil size={14} strokeWidth={1.8} />
								</ActionIcon>
							</Tooltip>
						)}

						<Tooltip label={toggleUi.label}>
							<ActionIcon
								size="sm"
								variant="subtle"
								aria-label={toggleUi.label}
								disabled={state.isMutationBusy}
								tabIndex={actionsVisible ? 0 : -1}
								onClick={(event) => {
									stopEvent(event);
									void actions.toggleFacetById(props.facet.facetId);
								}}
							>
								{props.facet.enabled ? (
									<ToggleRight size={14} strokeWidth={1.8} />
								) : (
									<ToggleLeft size={14} strokeWidth={1.8} />
								)}
							</ActionIcon>
						</Tooltip>

						<Tooltip label="Move up">
							<ActionIcon
								size="sm"
								variant="subtle"
								aria-label="Move facet up"
								tabIndex={actionsVisible ? 0 : -1}
								disabled={props.isFirst || state.isReordering}
								onClick={(event) => {
									stopEvent(event);
									void actions.moveFacetById(props.facet.facetId, "up");
								}}
							>
								<ChevronUp size={14} strokeWidth={1.8} />
							</ActionIcon>
						</Tooltip>

						<Tooltip label="Move down">
							<ActionIcon
								size="sm"
								variant="subtle"
								aria-label="Move facet down"
								tabIndex={actionsVisible ? 0 : -1}
								disabled={props.isLast || state.isReordering}
								onClick={(event) => {
									stopEvent(event);
									void actions.moveFacetById(props.facet.facetId, "down");
								}}
							>
								<ChevronDown size={14} strokeWidth={1.8} />
							</ActionIcon>
						</Tooltip>
					</Group>
				}
			>
				{facetSavedViews.map((view) => (
					<NavLink
						key={view.id}
						variant="light"
						label={view.name}
						renderRoot={(rootProps) => (
							<Link
								{...rootProps}
								to="/tracking/$facetSlug/views/$viewId"
								params={{
									viewId: view.id,
									facetSlug: props.facet.facetSlug,
								}}
							/>
						)}
					/>
				))}
			</NavLink>
		</div>
	);
}
