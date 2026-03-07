import { ActionIcon, Group, NavLink, Tooltip } from "@mantine/core";
import { Link } from "@tanstack/react-router";
import { ChevronDown, ChevronUp, Pencil } from "lucide-react";
import type { MouseEvent } from "react";
import { FacetIcon } from "../icons";
import type { TrackingNavItem } from "../nav";
import {
	useFacetSidebarActions,
	useFacetSidebarState,
} from "../sidebar-context";

interface FacetNavItemProps {
	isLast: boolean;
	isFirst: boolean;
	facet: TrackingNavItem;
}

function stopEvent(event: MouseEvent<HTMLButtonElement>) {
	event.preventDefault();
	event.stopPropagation();
}

export function FacetNavItem(props: FacetNavItemProps) {
	const state = useFacetSidebarState();
	const actions = useFacetSidebarActions();
	const actionsVisible = state.isCustomizeMode;

	return (
		<div>
			<Link
				to="/tracking/$facetSlug"
				params={{ facetSlug: props.facet.facetSlug }}
				style={{
					color: "inherit",
					display: "block",
					textDecoration: "none",
				}}
			>
				<NavLink
					variant="light"
					label={props.facet.label}
					leftSection={<FacetIcon icon={props.facet.icon} />}
					description={props.facet.enabled ? undefined : "Disabled"}
					style={{
						transition: "opacity 120ms ease",
						opacity: props.facet.enabled ? 1 : 0.62,
					}}
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
				/>
			</Link>
		</div>
	);
}
