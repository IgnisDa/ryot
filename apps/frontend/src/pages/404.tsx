import { APP_ROUTES } from "@/lib/constants";
import { Box, Button, Container, Group, Text, Title } from "@mantine/core";
import Head from "next/head";
import classes from "./404.module.css";

export default function Page() {
	return (
		<>
			<Head>
				<title>Not Found | Ryot</title>
			</Head>
			<Container className={classes.root}>
				<Box className={classes.inner}>
					<Box className={classes.content}>
						<Title className={classes.title}>Nothing to see here</Title>
						<Text
							c="dimmed"
							size="lg"
							ta="center"
							className={classes.description}
						>
							Page you are trying to open does not exist. You may have mistyped
							the address, or the page has been moved to another URL.
						</Text>
						<Group justify="center">
							<Button component="a" href={APP_ROUTES.dashboard}>
								Take me back to home page
							</Button>
						</Group>
					</Box>
				</Box>
			</Container>
		</>
	);
}
