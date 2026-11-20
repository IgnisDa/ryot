import { Button, Code, CopyButton, Stack, Table, Text } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import type { UserIntegrationsQuery } from "@ryot/generated/graphql/backend/graphql";
import { dayjsLib } from "~/lib/shared/date-utils";

type LogEntry =
	UserIntegrationsQuery["userIntegrations"][number]["triggerResult"][number];

export function IntegrationLogs(props: { entries: LogEntry[] }) {
	return (
		<Table>
			<Table.Thead>
				<Table.Tr>
					<Table.Th>Triggered at</Table.Th>
					<Table.Th>Status</Table.Th>
					<Table.Th>Details</Table.Th>
				</Table.Tr>
			</Table.Thead>
			<Table.Tbody>
				{props.entries.map((entry) => (
					<IntegrationLogRow entry={entry} key={entry.finishedAt} />
				))}
			</Table.Tbody>
		</Table>
	);
}

function IntegrationLogRow(props: { entry: LogEntry }) {
	const [opened, { toggle }] = useDisclosure(false);
	const { details, error, finishedAt } = props.entry;
	const triggeredAt = dayjsLib(finishedAt).format("lll");
	const status = error ? "Failed" : "Finished";
	const copyValue = [
		`Triggered at: ${finishedAt}`,
		`Status: ${status}`,
		error && `Error: ${error}`,
		details,
	]
		.filter(Boolean)
		.join("\n\n");

	return (
		<>
			<Table.Tr>
				<Table.Td>{triggeredAt}</Table.Td>
				<Table.Td>
					{error ? (
						<Text size="sm" lineClamp={2}>
							{error}
						</Text>
					) : (
						status
					)}
				</Table.Td>
				<Table.Td>
					{error || details ? (
						<Button
							size="compact-xs"
							variant="subtle"
							onClick={toggle}
							aria-expanded={opened}
							aria-label={`${opened ? "Hide" : "Show"} details for ${triggeredAt}`}
						>
							{opened ? "Hide" : "Show"}
						</Button>
					) : (
						<Text size="xs" c="dimmed">
							None recorded
						</Text>
					)}
				</Table.Td>
			</Table.Tr>
			{opened ? (
				<Table.Tr>
					<Table.Td colSpan={3}>
						<Stack gap="xs" align="flex-start">
							{error ? <Text size="sm">{error}</Text> : null}
							{details ? (
								<Code
									block
									w="100%"
									style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}
								>
									{details}
								</Code>
							) : null}
							<CopyButton value={copyValue}>
								{({ copied, copy }) => (
									<Button size="compact-xs" variant="light" onClick={copy}>
										{copied ? "Copied" : "Copy log entry"}
									</Button>
								)}
							</CopyButton>
						</Stack>
					</Table.Td>
				</Table.Tr>
			) : null}
		</>
	);
}
