import { SiGithub } from "@icons-pack/react-simple-icons";
import {
	Anchor,
	Avatar,
	Box,
	Button,
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
import {
	BookOpen,
	ExternalLink,
	Globe,
	Info,
	Key,
	Laptop,
	LogOut,
	Mail,
	MessageCircle,
	Moon,
	Settings,
	Sun,
} from "lucide-react";
import { useIsMobileScreen } from "~/hooks/screen";
import { useThemeTokens } from "~/hooks/theme";
import { authClient } from "~/lib/auth";
import type { SidebarAccount } from "./Sidebar.types";
import { SidebarApiKeysSection } from "./SidebarApiKeysSection";
import {
	formatSidebarAccountDate,
	getSidebarAccountInitials,
} from "./sidebar-account";

const ABOUT_LINKS = [
	{
		label: "Discord",
		icon: MessageCircle,
		description: "Join the community",
		href: "https://discord.gg/D9XTg2a7R8",
	},
	{
		icon: SiGithub,
		label: "GitHub",
		description: "View the source code",
		href: "https://github.com/IgnisDa/ryot",
	},
	{
		icon: Globe,
		label: "Website",
		href: "https://ryot.io",
		description: "Learn more about Ryot",
	},
	{
		icon: BookOpen,
		label: "Documentation",
		href: "https://docs.ryot.io",
		description: "Read the docs",
	},
	{
		icon: Mail,
		label: "Contact",
		href: "mailto:ignisda2001@gmail.com",
		description: "ignisda2001@gmail.com",
	},
];

function AccountMetaItem(props: { label: string; value: string }) {
	return (
		<Box>
			<Text
				fw={600}
				size="xs"
				c="dimmed"
				tt="uppercase"
				style={{ letterSpacing: "0.5px" }}
			>
				{props.label}
			</Text>
			<Text size="md" fw={500} mt={6}>
				{props.value}
			</Text>
		</Box>
	);
}

export function SidebarAccountSection(props: { account: SidebarAccount }) {
	const isMobile = useIsMobileScreen();
	const { hovered, ref } = useHover<HTMLButtonElement>();
	const { colorScheme, setColorScheme } = useMantineColorScheme();
	const [opened, { close, open }] = useDisclosure(false);
	const { isDark, border, textMuted, textPrimary } = useThemeTokens();
	const borderAccent = "var(--mantine-color-accent-5)";
	const initials = getSidebarAccountInitials(
		props.account.name,
		props.account.email,
	);

	const handleLogout = async () => {
		await authClient.signOut();
		window.location.href = "/start";
	};

	return (
		<>
			<Box p="md" style={{ borderTop: `1px solid ${border}` }}>
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
							? isDark
								? "rgba(212, 165, 116, 0.08)"
								: "rgba(212, 165, 116, 0.09)"
							: "transparent",
						transition: "all 140ms ease",
						borderLeft: hovered
							? `2px solid ${borderAccent}`
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
						<Box miw={0} style={{ flex: 1 }}>
							<Text c={textPrimary} fw={500} size="sm" truncate="end">
								{props.account.name}
							</Text>
							<Text c={textMuted} size="xs" truncate="end">
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
				withCloseButton={false}
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
							borderRight: isMobile ? "none" : `1px solid ${border}`,
						}}
					>
						<Tabs.Tab value="general" leftSection={<Settings size={16} />}>
							General
						</Tabs.Tab>
						<Tabs.Tab value="api-keys" leftSection={<Key size={16} />}>
							API Keys
						</Tabs.Tab>
						<Tabs.Tab value="about" leftSection={<Info size={16} />}>
							About
						</Tabs.Tab>
					</Tabs.List>

					<Tabs.Panel value="general" style={{ flex: 1 }}>
						<Stack gap="lg">
							<Group gap="md" wrap="nowrap">
								<Avatar
									size={64}
									radius="md"
									color="accent"
									variant="light"
									src={props.account.image}
								>
									{initials}
								</Avatar>
								<Box miw={0} style={{ flex: 1 }}>
									<Text
										fw={600}
										size="xl"
										truncate="end"
										ff="var(--mantine-headings-font-family)"
									>
										{props.account.name}
									</Text>
									<Text c={textMuted} size="sm" mt={4} truncate="end">
										{props.account.email}
									</Text>
								</Box>
							</Group>

							<Box
								p="md"
								style={{
									borderRadius: "14px",
									border: `1px solid ${border}`,
									background: isDark
										? "rgba(255, 255, 255, 0.02)"
										: "rgba(255, 255, 255, 0.82)",
								}}
							>
								<Stack gap="md">
									<Group
										wrap="nowrap"
										align="flex-start"
										justify="space-between"
									>
										<Box>
											<Text
												fw={600}
												size="md"
												ff="var(--mantine-headings-font-family)"
											>
												Appearance
											</Text>
											<Text c={textMuted} size="sm" mt={4}>
												Theme follows your journal preference across the app.
											</Text>
										</Box>
									</Group>
									<SegmentedControl
										fullWidth
										value={colorScheme}
										onChange={setColorScheme}
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
										border: `1px solid ${border}`,
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
										border: `1px solid ${border}`,
									}}
								>
									<AccountMetaItem
										label="Last updated"
										value={formatSidebarAccountDate(props.account.updatedAt)}
									/>
								</Box>
							</SimpleGrid>

							<Button
								fullWidth
								color="red"
								variant="light"
								onClick={handleLogout}
								leftSection={<LogOut size={16} />}
							>
								Log Out
							</Button>
						</Stack>
					</Tabs.Panel>

					<Tabs.Panel value="api-keys" style={{ flex: 1 }}>
						<SidebarApiKeysSection opened={opened} />
					</Tabs.Panel>

					<Tabs.Panel value="about" style={{ flex: 1 }}>
						<Stack gap="lg">
							<Box>
								<Text
									fw={600}
									size="xl"
									ff="var(--mantine-headings-font-family)"
								>
									About Ryot
								</Text>
								<Text c={textMuted} size="sm" mt={4}>
									A journal of personal tracking
								</Text>
							</Box>
							<Stack gap="xs">
								{ABOUT_LINKS.map((link) => (
									<Anchor
										key={link.label}
										href={link.href}
										target={
											link.href.startsWith("mailto:") ? undefined : "_blank"
										}
										rel="noopener noreferrer"
										underline="never"
										style={{ display: "block" }}
									>
										<Box
											p="md"
											style={{
												borderRadius: "10px",
												border: `1px solid ${border}`,
												transition: "all 140ms ease",
											}}
										>
											<Group justify="space-between" wrap="nowrap">
												<Group gap="sm" wrap="nowrap">
													<Box
														c={borderAccent}
														style={{ display: "flex", alignItems: "center" }}
													>
														<link.icon size={18} />
													</Box>
													<Box>
														<Text size="sm" fw={500} c={textPrimary}>
															{link.label}
														</Text>
														<Text size="xs" c={textMuted}>
															{link.description}
														</Text>
													</Box>
												</Group>
												<ExternalLink size={14} color={textMuted} />
											</Group>
										</Box>
									</Anchor>
								))}
							</Stack>
						</Stack>
					</Tabs.Panel>
				</Tabs>
			</Modal>
		</>
	);
}
