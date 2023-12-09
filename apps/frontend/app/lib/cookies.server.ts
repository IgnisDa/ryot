import { createCookie } from "@remix-run/node";
import { COOKIES_KEYS } from "~/lib/utilities";

export const authCookie = createCookie(COOKIES_KEYS.auth, {});
export const colorSchemeCookie = createCookie(COOKIES_KEYS.colorScheme, {
	maxAge: 60 * 60 * 24 * 365,
});
