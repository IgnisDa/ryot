import type { NextPageWithLayout } from "./_app";
import useUser from "@/lib/hooks/useUser";
import LoggedIn from "@/lib/layouts/LoggedIn";
import { Box, Container, Stack, Tabs, } from "@mantine/core";
import { IconUser } from "@tabler/icons-react";
import type { ReactElement } from "react";

const Page: NextPageWithLayout = () => {
	const user = useUser()
	return (
		<Container>
			<Stack>
				<Tabs defaultValue="profile" orientation="vertical">
					<Tabs.List>
						<Tabs.Tab value="profile" icon={<IconUser size="1rem" />} >Profile</Tabs.Tab>
					</Tabs.List>
					<Tabs.Panel value="profile" ml={'sm'}>
						<Box>
							This is the profile tab
							{JSON.stringify(user)}
						</Box>
					</Tabs.Panel>
				</Tabs>
			</Stack>
		</Container>
	);
};

Page.getLayout = (page: ReactElement) => {
	return <LoggedIn>{page}</LoggedIn>;
};

export default Page;
