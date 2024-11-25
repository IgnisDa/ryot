import {
	Button,
	Container,
	Menu,
	SimpleGrid,
	Stack,
	Text,
} from "@mantine/core";
import { DatePickerInput } from "@mantine/dates";
import type { LoaderFunctionArgs, MetaArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { formatDateToNaiveDate } from "@ryot/ts-utils";
import { IconCalendar } from "@tabler/icons-react";
import { match } from "ts-pattern";
import { z } from "zod";
import { zx } from "zodix";
import { dayjsLib } from "~/lib/generals";
import { useAppSearchParam } from "~/lib/hooks";
import {
	getEnhancedCookieName,
	redirectUsingEnhancedCookieSearchParams,
} from "~/lib/utilities.server";

const TIME_RANGES = [
	"Yesterday",
	"This Week",
	"This Month",
	"This Year",
	"Past 7 Days",
	"Past 30 Days",
	"Past 6 Months",
	"Past 12 Months",
] as const;

const searchParamsSchema = z.object({
	range: z.enum(TIME_RANGES).optional(),
});

export type SearchParams = z.infer<typeof searchParamsSchema>;

export const loader = async ({ request }: LoaderFunctionArgs) => {
	const cookieName = await getEnhancedCookieName("fitness.analytics", request);
	let { range } = zx.parseQuery(request, searchParamsSchema);
	await redirectUsingEnhancedCookieSearchParams(request, cookieName);
	const startDate = formatDateToNaiveDate();
	const endDate = formatDateToNaiveDate(dayjsLib());
	return { range, startDate, endDate, cookieName };
};

export const meta = (_args: MetaArgs<typeof loader>) => {
	return [{ title: "Fitness Analytics | Ryot" }];
};

export default function Page() {
	const loaderData = useLoaderData<typeof loader>();
	const [_, { setP }] = useAppSearchParam(loaderData.cookieName);

	return (
		<Container>
			<Stack>
				<SimpleGrid cols={{ base: 1, md: 2 }} style={{ alignItems: "center" }}>
					<Text fz={{ base: "h2", md: "h1" }} ta="center" fw="bold">
						Fitness Analytics
					</Text>
					<Menu position="bottom-end">
						<Menu.Target>
							<Button
								w={200}
								variant="default"
								ml={{ md: "auto" }}
								leftSection={<IconCalendar />}
							>
								{loaderData.range}
							</Button>
						</Menu.Target>
						<Menu.Dropdown>
							{TIME_RANGES.map((range) => (
								<Menu.Item
									ta="right"
									key={range}
									onClick={() => {
										const startDate = match(range)
											.with("Yesterday", () => dayjsLib().subtract(1, "day"))
											.with("This Week", () => dayjsLib().startOf("week"))
											.with("This Month", () => dayjsLib().startOf("month"))
											.with("This Year", () => dayjsLib().startOf("year"))
											.with("Past 7 Days", () => dayjsLib().subtract(7, "day"))
											.with("Past 30 Days", () =>
												dayjsLib().subtract(30, "day"),
											)
											.with("Past 6 Months", () =>
												dayjsLib().subtract(6, "month"),
											)
											.with("Past 12 Months", () =>
												dayjsLib().subtract(12, "month"),
											)
											.exhaustive();
										setP("range", range);
										if (startDate) {
											setP("startDate", formatDateToNaiveDate(startDate));
											setP("endDate", formatDateToNaiveDate(dayjsLib()));
										}
									}}
								>
									{range}
								</Menu.Item>
							))}
						</Menu.Dropdown>
					</Menu>
				</SimpleGrid>
				<DatePickerInput
					w={300}
					size="xs"
					mx="auto"
					type="range"
					label="Select date range"
					defaultValue={[
						new Date(loaderData.startDate),
						new Date(loaderData.endDate),
					]}
					onChange={([start, end]) => {
						setP(
							"startDate",
							start ? formatDateToNaiveDate(start) : loaderData.startDate,
						);
						setP(
							"endDate",
							end ? formatDateToNaiveDate(end) : loaderData.endDate,
						);
					}}
				/>
			</Stack>
		</Container>
	);
}
