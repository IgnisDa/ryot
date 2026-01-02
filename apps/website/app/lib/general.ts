import { initializePaddle } from "@paddle/paddle-js";
import { $path } from "safe-routes";
import { withFragment } from "ufo";

export const startUrl = withFragment($path("/"), "start-here");

export const logoUrl =
	"https://raw.githubusercontent.com/IgnisDa/ryot/main/libs/assets/icon-512x512.png";

export const contactEmail = "ignisda2001@gmail.com";

export const initializePaddleForApplication = (
	clientToken: string,
	isSandbox: boolean,
	paddleCustomerId?: string | null,
) =>
	initializePaddle({
		token: clientToken,
		environment: isSandbox ? "sandbox" : undefined,
		pwCustomer: { id: paddleCustomerId || undefined },
	});
