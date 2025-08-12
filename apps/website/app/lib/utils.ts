import { $path } from "safe-routes";
import { withFragment } from "ufo";

export const startUrl = withFragment($path("/"), "start-here");

export const logoUrl =
	"https://raw.githubusercontent.com/IgnisDa/ryot/main/libs/assets/icon-512x512.png";

export const contactEmail = "ignisda2001@gmail.com";

export const getClientIp = (request: Request): string | undefined => {
	const cfConnectingIp = request.headers.get("cf-connecting-ip");
	if (cfConnectingIp) return cfConnectingIp.trim();

	const xForwardedFor = request.headers.get("x-forwarded-for");
	if (xForwardedFor) {
		const firstIp = xForwardedFor.split(",")[0];
		return firstIp?.trim();
	}

	return undefined;
};
