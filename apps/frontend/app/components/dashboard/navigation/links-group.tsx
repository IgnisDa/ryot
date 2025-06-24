import { Box, Collapse, Group, ThemeIcon, UnstyledButton } from "@mantine/core";
import { IconChevronRight } from "@tabler/icons-react";
import clsx from "clsx";
import { Link, NavLink } from "react-router";
import { ClientOnly } from "remix-utils/client-only";
import { useOnboardingTour } from "~/lib/state/general";
import classes from "~/styles/dashboard.module.css";
import type { LinksGroupProps } from "../types";

export const LinksGroup = (props: LinksGroupProps) => {
	const { advanceOnboardingTourStep } = useOnboardingTour();

	const hasLinks = Array.isArray(props.links);
	const linkItems = (hasLinks ? props.links || [] : []).map((link) => (
		<NavLink
			to={link.link}
			key={link.label}
			className={clsx(classes.link, link.tourControlTarget)}
			onClick={() => {
				props.toggle();
				advanceOnboardingTourStep();
			}}
		>
			{({ isActive }) => (
				<span style={isActive ? { textDecoration: "underline" } : undefined}>
					{link.label}
				</span>
			)}
		</NavLink>
	));

	return (
		<Box>
			<UnstyledButton<typeof Link>
				component={!hasLinks ? Link : undefined}
				// biome-ignore lint/suspicious/noExplicitAny: required here
				to={!hasLinks ? props.href : (undefined as any)}
				className={clsx(classes.control, props.tourControlTarget)}
				onClick={() => {
					advanceOnboardingTourStep();
					if (hasLinks) {
						props.setOpened(!props.opened);
						return;
					}
					props.toggle();
				}}
			>
				<Group justify="space-between" gap={0}>
					<Box style={{ display: "flex", alignItems: "center" }}>
						<ThemeIcon variant="light" size={30}>
							<props.icon size={17.6} />
						</ThemeIcon>
						<Box ml="md">{props.label}</Box>
					</Box>
					{hasLinks ? (
						<ClientOnly>
							{() => (
								<IconChevronRight
									size={16}
									stroke={1.5}
									className={classes.chevron}
									style={{
										transform: props.opened ? "rotate(90deg)" : "none",
									}}
								/>
							)}
						</ClientOnly>
					) : null}
				</Group>
			</UnstyledButton>
			{hasLinks ? <Collapse in={props.opened}>{linkItems}</Collapse> : null}
		</Box>
	);
};
