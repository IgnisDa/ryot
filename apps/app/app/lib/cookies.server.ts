import { createCookie } from "@remix-run/node";
import { COOKIES_KEYS } from "~/lib/constants";

export const authCookie = createCookie(COOKIES_KEYS.auth, {});
export const colorSchemeCookie = createCookie(COOKIES_KEYS.colorScheme, {});
