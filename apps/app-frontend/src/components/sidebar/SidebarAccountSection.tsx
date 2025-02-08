import {
	Avatar,
	Box,
	Group,
	Modal,
	SegmentedControl,
	Stack,
	Text,
	useComputedColorScheme,
	useMantineColorScheme,
} from "@mantine/core";
import { useDisclosure, useHover } from "@mantine/hooks";
import { Laptop, Moon, Sparkles, Sun } from "lucide-react";
import type { SidebarAccount } from "./Sidebar.types";
import {
	formatSidebarAccountDate,
	getSidebarAccountInitials,
} from "./sidebar-account";

function AccountMetaItem(props: { label: string; value: string }) {
	return (
		<Box>
			<Text size="xs" c="dimmed" tt="uppercase" lts="0.8px">
				{props.label}
			</Text>
			<Text size="sm" fw={500} mt={4}>
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
	const { colorScheme, setColorScheme } = useMantineColorScheme();
	const [opened, { close, open }] = useDisclosure(false);
	const { hovered, ref } = useHover<HTMLButtonElement>();
	const computedColorScheme = useComputedColorScheme("light", {
		getInitialValueInEffect: false,
	});
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
				size="lg"
				radius="lg"
				title={null}
				opened={opened}
				onClose={close}
			>
				<Stack gap="lg">
					<Group justify="space-between" align="flex-start" wrap="nowrap">
						<Group gap="md" wrap="nowrap">
							<Avatar
								size={56}
								radius="md"
								color="accent"
								variant="light"
								src={props.account.image || undefined}
							>
								{initials}
							</Avatar>
							<Box>
								<Text
									fw={600}
									size="xl"
									ff="var(--mantine-headings-font-family)"
								>
									{props.account.name}
								</Text>
								<Text c={props.textMuted} size="sm" mt={4}>
									{props.account.email}
								</Text>
							</Box>
						</Group>
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
						<Stack gap="sm">
							<Group justify="space-between" align="center">
								<Box>
									<Text
										fw={600}
										size="sm"
										ff="var(--mantine-headings-font-family)"
									>
										Appearance
									</Text>
									<Text c={props.textMuted} size="xs" mt={2}>
										Theme follows your journal preference across the app.
									</Text>
								</Box>
								<Text c={props.textMuted} size="xs">
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

					<Group grow>
						<Box
							p="md"
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
							p="md"
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
					</Group>

					<Box
						p="md"
						style={{
							borderRadius: "14px",
							border: `1px dashed ${props.border}`,
							background: props.isDark
								? "rgba(212, 165, 116, 0.05)"
								: "rgba(212, 165, 116, 0.06)",
						}}
					>
						<Group gap="xs" mb="xs" wrap="nowrap">
							<Sparkles color="var(--mantine-color-accent-5)" size={16} />
							<Text fw={600} size="sm" ff="var(--mantine-headings-font-family)">
								Account Notes
							</Text>
						</Group>
						<Text c={props.textMuted} size="sm" lh={1.6}>
							This panel is already wired to your authenticated route user.
							Security controls, API key management, and export actions can grow
							here later without changing how other protected components access
							account data.
						</Text>
					</Box>
				</Stack>
			</Modal>
		</>
	);
}
