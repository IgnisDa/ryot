import { useAutoAnimate } from "@formkit/auto-animate/react";
import {
	Anchor,
	Badge,
	Box,
	Button,
	Code,
	Group,
	Loader,
	Stack,
	Text,
	TextInput,
} from "@mantine/core";
import { modals } from "@mantine/modals";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, KeyRound, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";

import { useIsMobileScreen } from "~/hooks/screen";
import { useThemeTokens } from "~/hooks/theme";
import { authClient } from "~/lib/auth";
import { getErrorMessage } from "~/lib/errors";

import {
	getSidebarApiKeyDetails,
	getSidebarApiKeyDisplayName,
	type SidebarCreatedApiKey,
} from "./sidebar-api-keys";

const accountApiKeysQueryKey = ["account", "api-keys"] as const;

export function SidebarApiKeysSection(props: { opened: boolean }) {
	const isMobile = useIsMobileScreen();
	const { isDark, border, textMuted } = useThemeTokens();
	const queryClient = useQueryClient();
	const [draftName, setDraftName] = useState("");
	const [animatedContentRef] = useAutoAnimate<HTMLDivElement>();
	const [copiedKey, setCopiedKey] = useState(false);
	const [createdApiKey, setCreatedApiKey] = useState<SidebarCreatedApiKey | null>(null);
	const trimmedName = draftName.trim();

	const apiKeysQuery = useQuery({
		enabled: props.opened,
		queryKey: accountApiKeysQueryKey,
		queryFn: async () => {
			const response = await authClient.apiKey.list({
				query: { sortBy: "createdAt", sortDirection: "desc" },
			});
			if (response.error) {
				throw new Error(response.error.message || "Failed to load API keys.");
			}
			return response.data;
		},
	});

	const createApiKeyMutation = useMutation({
		mutationFn: async (name: string) => {
			const response = await authClient.apiKey.create({ name });
			if (response.error) {
				throw new Error(response.error.message || "Failed to create API key.");
			}
			return response.data;
		},
		onSuccess: async (data) => {
			setCopiedKey(false);
			setDraftName("");
			setCreatedApiKey(data);
			await queryClient.invalidateQueries({ queryKey: accountApiKeysQueryKey });
		},
	});

	const deleteApiKeyMutation = useMutation({
		mutationFn: async (keyId: string) => {
			const response = await authClient.apiKey.delete({ keyId });
			if (response.error) {
				throw new Error(response.error.message || "Failed to delete API key.");
			}
			return keyId;
		},
		onSuccess: async (keyId) => {
			if (createdApiKey?.id === keyId) {
				setCreatedApiKey(null);
			}
			await queryClient.invalidateQueries({ queryKey: accountApiKeysQueryKey });
		},
	});

	const apiKeys = useMemo(() => apiKeysQuery.data?.apiKeys ?? [], [apiKeysQuery.data?.apiKeys]);

	const handleCreateApiKey = () => {
		if (!trimmedName) {
			return;
		}
		createApiKeyMutation.mutate(trimmedName);
	};

	const handleCopyCreatedKey = async () => {
		if (!createdApiKey?.key) {
			return;
		}
		if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
			return;
		}

		await navigator.clipboard.writeText(createdApiKey.key);
		setCopiedKey(true);
	};

	const handleDeleteApiKey = (keyId: string, name: string) => {
		modals.openConfirmModal({
			title: "Remove API key",
			confirmProps: { color: "red" },
			labels: { confirm: "Remove", cancel: "Cancel" },
			onConfirm: () => deleteApiKeyMutation.mutate(keyId),
			children: <Text size="sm">Remove {name || "this API key"}? This cannot be undone.</Text>,
		});
	};

	return (
		<Stack gap="lg">
			<Box>
				<Group justify="space-between" align="center" mb="xs">
					<Text fw={600} size="lg" ff="var(--mantine-headings-font-family)">
						API Keys
					</Text>
					<Text c={textMuted} size="xs">
						{apiKeys.length} key{apiKeys.length === 1 ? "" : "s"}
					</Text>
				</Group>
				<Text c={textMuted} size="sm">
					Create and revoke personal keys for scripts, automations, and local tooling.
				</Text>
				<Anchor
					mt={6}
					size="sm"
					target="_blank"
					rel="noreferrer"
					href="/api/docs"
					display="inline-block"
				>
					Open API docs
				</Anchor>
			</Box>

			{isMobile ? (
				<Stack gap="sm">
					<TextInput
						label="Key name"
						value={draftName}
						placeholder="Deploy script"
						onChange={(event) => setDraftName(event.currentTarget.value)}
					/>
					<Button
						fullWidth
						disabled={!trimmedName}
						onClick={handleCreateApiKey}
						leftSection={<KeyRound size={14} />}
						loading={createApiKeyMutation.isPending}
					>
						Create key
					</Button>
				</Stack>
			) : (
				<Group align="flex-end" wrap="nowrap">
					<TextInput
						label="Key name"
						value={draftName}
						style={{ flex: 1 }}
						placeholder="Deploy script"
						onChange={(event) => setDraftName(event.currentTarget.value)}
					/>
					<Button
						disabled={!trimmedName}
						onClick={handleCreateApiKey}
						leftSection={<KeyRound size={14} />}
						loading={createApiKeyMutation.isPending}
					>
						Create key
					</Button>
				</Group>
			)}

			<Stack gap="md" ref={animatedContentRef}>
				{createApiKeyMutation.isError && (
					<Text c="red" size="sm">
						{getErrorMessage(createApiKeyMutation.error, "Failed to create API key.")}
					</Text>
				)}

				{createdApiKey?.key && (
					<Box
						p="md"
						style={{
							borderRadius: "12px",
							border: `1px dashed ${border}`,
							background: isDark ? "rgba(212, 165, 116, 0.05)" : "rgba(212, 165, 116, 0.06)",
						}}
					>
						<Stack gap="md">
							{isMobile ? (
								<>
									<Box>
										<Text fw={600} size="sm" ff="var(--mantine-headings-font-family)">
											Copy this key now
										</Text>
										<Text c={textMuted} size="xs" mt={4}>
											For security, this secret is only shown once.
										</Text>
									</Box>
									<Code block>{createdApiKey.key}</Code>
									<Button
										fullWidth
										size="sm"
										variant="light"
										onClick={() => void handleCopyCreatedKey()}
										leftSection={copiedKey ? <Check size={16} /> : <Copy size={16} />}
									>
										{copiedKey ? "Copied" : "Copy"}
									</Button>
								</>
							) : (
								<>
									<Group justify="space-between" align="flex-start" wrap="nowrap">
										<Box>
											<Text fw={600} size="sm" ff="var(--mantine-headings-font-family)">
												Copy this key now
											</Text>
											<Text c={textMuted} size="xs" mt={4}>
												For security, this secret is only shown once.
											</Text>
										</Box>
										<Button
											size="xs"
											variant="light"
											onClick={() => void handleCopyCreatedKey()}
											leftSection={copiedKey ? <Check size={14} /> : <Copy size={14} />}
										>
											{copiedKey ? "Copied" : "Copy"}
										</Button>
									</Group>
									<Code block>{createdApiKey.key}</Code>
								</>
							)}
						</Stack>
					</Box>
				)}

				{apiKeysQuery.isPending && (
					<Group justify="center" py="xs">
						<Loader size="sm" />
					</Group>
				)}

				{apiKeysQuery.isError && (
					<Group justify="space-between" align="center">
						<Text c="red" size="sm">
							{getErrorMessage(apiKeysQuery.error, "Failed to load API keys.")}
						</Text>
						<Button size="xs" variant="subtle" onClick={() => void apiKeysQuery.refetch()}>
							Retry
						</Button>
					</Group>
				)}

				{!apiKeysQuery.isPending && !apiKeysQuery.isError && apiKeys.length === 0 && (
					<Text c={textMuted} size="sm" lh={1.6}>
						No API keys yet. Create one here when you need Ryot access from a script or integration.
					</Text>
				)}

				{apiKeys.map((key) => {
					const details = getSidebarApiKeyDetails(key);
					const status = { color: "teal", label: "Active" };
					const keyName = getSidebarApiKeyDisplayName(key);
					const isDeleting =
						deleteApiKeyMutation.isPending && deleteApiKeyMutation.variables === key.id;

					return (
						<Box
							p="md"
							key={key.id}
							style={{ borderRadius: "12px", border: `1px solid ${border}` }}
						>
							{isMobile ? (
								<Stack gap="md">
									<Box>
										<Group gap="xs" wrap="wrap" mb="xs">
											<Text fw={500} size="sm">
												{keyName}
											</Text>
											<Badge color={status.color} variant="light" size="sm">
												{status.label}
											</Badge>
										</Group>
										<Text c={textMuted} size="xs">
											{details.map((item, index) => (
												<Text component="span" key={`${item.label}-${item.value}`}>
													{index > 0 ? " - " : ""}
													{item.label ? `${item.label}: ` : ""}
													<Text component="span" fw={600} inherit>
														{item.value}
													</Text>
												</Text>
											))}
										</Text>
									</Box>
									<Button
										fullWidth
										size="xs"
										color="red"
										variant="subtle"
										loading={isDeleting}
										leftSection={<Trash2 size={14} />}
										onClick={() => handleDeleteApiKey(key.id, keyName)}
									>
										Remove
									</Button>
								</Stack>
							) : (
								<Group justify="space-between" align="flex-start" wrap="nowrap">
									<Box miw={0} style={{ flex: 1 }}>
										<Group gap="xs" wrap="wrap" mb="xs">
											<Text fw={500} size="sm" truncate="end">
												{keyName}
											</Text>
											<Badge color={status.color} variant="light" size="sm">
												{status.label}
											</Badge>
										</Group>
										<Text c={textMuted} size="xs">
											{details.map((item, index) => (
												<Text component="span" key={`${item.label}-${item.value}`}>
													{index > 0 ? " - " : ""}
													{item.label ? `${item.label}: ` : ""}
													<Text component="span" fw={600} inherit>
														{item.value}
													</Text>
												</Text>
											))}
										</Text>
									</Box>
									<Button
										size="xs"
										color="red"
										variant="subtle"
										loading={isDeleting}
										leftSection={<Trash2 size={14} />}
										onClick={() => handleDeleteApiKey(key.id, keyName)}
									>
										Remove
									</Button>
								</Group>
							)}
						</Box>
					);
				})}

				{deleteApiKeyMutation.isError && (
					<Text c="red" size="sm">
						{getErrorMessage(deleteApiKeyMutation.error, "Failed to delete API key.")}
					</Text>
				)}
			</Stack>
		</Stack>
	);
}
