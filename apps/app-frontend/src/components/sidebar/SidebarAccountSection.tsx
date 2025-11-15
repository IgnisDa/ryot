import {
	Avatar,
	Box,
	Group,
	Modal,
	SegmentedControl,
	SimpleGrid,
	Stack,
	Tabs,
	Text,
	useMantineColorScheme,
} from "@mantine/core";
import { useDisclosure, useHover } from "@mantine/hooks";
import { Laptop, Moon, Sun } from "lucide-react";
import { useIsMobileScreen } from "#/hooks/screen";
import { useColorScheme } from "#/hooks/theme";
import type { SidebarAccount } from "./Sidebar.types";
import { SidebarApiKeysSection } from "./SidebarApiKeysSection";
import {
	formatSidebarAccountDate,
	getSidebarAccountInitials,
} from "./sidebar-account";

function AccountMetaItem(props: { label: string; value: string }) {
	return (
		<Box>
			<Text size="xs" c="dimmed" tt="uppercase" lts="0.5px" fw={600}>
				{props.label}
			</Text>
			<Text size="md" fw={500} mt={6}>
				{props.value}
			</Text>
		</Box>
	);
}

export function SidebarAccountSection(props: {
	border: string;
	isDark: boolean;
	textMuted: string;
	textPrimary: string;
	borderAccent: string;
	account: SidebarAccount;
}) {
	const isMobile = useIsMobileScreen();
	const computedColorScheme = useColorScheme();
	const { hovered, ref } = useHover<HTMLButtonElement>();
	const { colorScheme, setColorScheme } = useMantineColorScheme();
	const [opened, { close, open }] = useDisclosure(false);
	const initials = getSidebarAccountInitials(
		props.account.name,
		props.account.email,
	);

	return (
		<>
			<Box p="md" style={{ borderTop: `1px solid ${props.border}` }}>
				<Box
					ref={ref}
					onClick={open}
					component="button"
					style={{
						width: "100%",
						border: "none",
						padding: "12px",
						cursor: "pointer",
						textAlign: "left",
						borderRadius: "10px",
						background: hovered
							? props.isDark
								? "rgba(212, 165, 116, 0.08)"
								: "rgba(212, 165, 116, 0.09)"
							: "transparent",
						transition: "all 140ms ease",
						borderLeft: hovered
							? `2px solid ${props.borderAccent}`
							: "2px solid transparent",
					}}
				>
					<Group gap="sm" wrap="nowrap">
						<Avatar
							radius="md"
							color="accent"
							variant="light"
							src={props.account.image || undefined}
						>
							{initials}
						</Avatar>
						<Box style={{ flex: 1, minWidth: 0 }}>
							<Text c={props.textPrimary} fw={500} size="sm" truncate="end">
								{props.account.name}
							</Text>
							<Text c={props.textMuted} size="xs" truncate="end">
								{props.account.email}
							</Text>
						</Box>
					</Group>
				</Box>
			</Box>

			<Modal
				centered
				size="xl"
				radius="lg"
				title={null}
				opened={opened}
				onClose={close}
			>
				<Tabs
					defaultValue="general"
					orientation={isMobile ? "horizontal" : "vertical"}
					style={{
						display: "flex",
						gap: isMobile ? "0" : "32px",
						flexDirection: isMobile ? "column" : "row",
					}}
				>
					<Tabs.List
						style={{
							paddingBottom: "0",
							borderBottom: "none",
							paddingRight: isMobile ? "0" : "24px",
							marginBottom: isMobile ? "20px" : "0",
							minWidth: isMobile ? "auto" : "150px",
							borderRight: isMobile ? "none" : `1px solid ${props.border}`,
						}}
					>
						<Tabs.Tab value="general">General</Tabs.Tab>
						<Tabs.Tab value="api-keys">API Keys</Tabs.Tab>
					</Tabs.List>

					<Tabs.Panel value="general" style={{ flex: 1 }}>
						<Stack gap="lg">
							<Group gap="md" wrap="nowrap">
								<Avatar
									size={64}
									radius="md"
									color="accent"
									variant="light"
									src={props.account.image || undefined}
								>
									{initials}
								</Avatar>
								<Box style={{ flex: 1, minWidth: 0 }}>
									<Text
										fw={600}
										size="xl"
										truncate="end"
										ff="var(--mantine-headings-font-family)"
									>
										{props.account.name}
									</Text>
									<Text c={props.textMuted} size="sm" mt={4} truncate="end">
										{props.account.email}
									</Text>
								</Box>
							</Group>

							<Box
								p="md"
								style={{
									borderRadius: "14px",
									border: `1px solid ${props.border}`,
									background: props.isDark
										? "rgba(255, 255, 255, 0.02)"
										: "rgba(255, 255, 255, 0.82)",
								}}
							>
								<Stack gap="md">
									<Group
										justify="space-between"
										align="flex-start"
										wrap="nowrap"
									>
										<Box>
											<Text
												fw={600}
												size="md"
												ff="var(--mantine-headings-font-family)"
											>
												Appearance
											</Text>
											<Text c={props.textMuted} size="sm" mt={4}>
												Theme follows your journal preference across the app.
											</Text>
										</Box>
										<Text c={props.textMuted} size="xs" mt={2}>
											Active: {computedColorScheme}
										</Text>
									</Group>
									<SegmentedControl
										fullWidth
										value={colorScheme}
										onChange={(value) => setColorScheme(value)}
										data={[
											{
												value: "auto",
												label: (
													<Group gap={6} wrap="nowrap">
														<Laptop size={14} />
														<span>Auto</span>
													</Group>
												),
											},
											{
												value: "light",
												label: (
													<Group gap={6} wrap="nowrap">
														<Sun size={14} />
														<span>Light</span>
													</Group>
												),
											},
											{
												value: "dark",
												label: (
													<Group gap={6} wrap="nowrap">
														<Moon size={14} />
														<span>Dark</span>
													</Group>
												),
											},
										]}
									/>
								</Stack>
							</Box>

							<SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
								<Box
									p="lg"
									style={{
										borderRadius: "14px",
										border: `1px solid ${props.border}`,
									}}
								>
									<AccountMetaItem
										label="Member since"
										value={formatSidebarAccountDate(props.account.createdAt)}
									/>
								</Box>
								<Box
									p="lg"
									style={{
										borderRadius: "14px",
										border: `1px solid ${props.border}`,
									}}
								>
									<AccountMetaItem
										label="Last updated"
										value={formatSidebarAccountDate(props.account.updatedAt)}
									/>
								</Box>
							</SimpleGrid>
						</Stack>
					</Tabs.Panel>

					<Tabs.Panel value="api-keys" style={{ flex: 1 }}>
						<SidebarApiKeysSection
							opened={opened}
							border={props.border}
							isDark={props.isDark}
							textMuted={props.textMuted}
						/>
					</Tabs.Panel>
				</Tabs>
			</Modal>
		</>
	);
}
