import { Environment, Paddle } from "@paddle/paddle-node-sdk";

import { getServerVariables } from "~/server/config.server";

export const getPaddleServerClient = () => {
	const config = getServerVariables();
	return new Paddle(config.PADDLE_SERVER_TOKEN, {
		environment: config.PADDLE_SANDBOX ? Environment.sandbox : undefined,
	});
};
