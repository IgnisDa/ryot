export const toastKey = "Toast";
export const reviewYellow = "#EBE600FF";
export const FRONTEND_AUTH_COOKIE_NAME = "Auth";
export const redirectToQueryParam = "redirectTo";
export const CURRENT_WORKOUT_KEY = "CurrentWorkout";
export const PRO_REQUIRED_MESSAGE = "Ryot pro is required to use this feature";
export const LOGO_IMAGE_URL =
	"https://raw.githubusercontent.com/IgnisDa/ryot/main/libs/assets/icon-512x512.png";

export const MEDIA_DETAILS_HEIGHT = { base: "45vh", "2xl": "55vh" };

export const applicationBaseUrl =
	typeof window !== "undefined" ? window.location.origin : "";

declare global {
	interface Window {
		umami?: { track: (eventName: string, eventData: unknown) => void };
	}
}
