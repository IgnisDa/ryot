import type { IconSelectSpec } from "@expo/ui";

export type AndroidMaterialSymbolPath = `@expo/material-symbols/${string}.xml`;

export type NativeTabIcon = {
	ios: IconSelectSpec["ios"];
	android: AndroidMaterialSymbolPath;
};

const fallbackNativeTabIcon = {
	ios: "circle",
	android: "@expo/material-symbols/circle.xml",
} as const satisfies NativeTabIcon;

const nativeTabIcons: Record<string, NativeTabIcon> = {
	tv: { ios: "tv", android: "@expo/material-symbols/tv.xml" },
	mic: { ios: "mic", android: "@expo/material-symbols/mic.xml" },
	x: { ios: "xmark", android: "@expo/material-symbols/close.xml" },
	zap: { ios: "bolt", android: "@expo/material-symbols/bolt.xml" },
	tags: { ios: "tag", android: "@expo/material-symbols/sell.xml" },
	plus: { ios: "plus", android: "@expo/material-symbols/add.xml" },
	star: { ios: "star", android: "@expo/material-symbols/star.xml" },
	book: { ios: "book", android: "@expo/material-symbols/book.xml" },
	film: { ios: "film", android: "@expo/material-symbols/movie.xml" },
	home: { ios: "house", android: "@expo/material-symbols/home.xml" },
	house: { ios: "house", android: "@expo/material-symbols/home.xml" },
	inbox: { ios: "tray", android: "@expo/material-symbols/inbox.xml" },
	radio: { ios: "radio", android: "@expo/material-symbols/radio.xml" },
	moon: { ios: "moon", android: "@expo/material-symbols/dark_mode.xml" },
	heart: { ios: "heart", android: "@expo/material-symbols/favorite.xml" },
	users: { ios: "person.2", android: "@expo/material-symbols/group.xml" },
	folders: { ios: "folder", android: "@expo/material-symbols/folder.xml" },
	check: { ios: "checkmark", android: "@expo/material-symbols/check.xml" },
	sun: { ios: "sun.max", android: "@expo/material-symbols/light_mode.xml" },
	ruler: { ios: "ruler", android: "@expo/material-symbols/straighten.xml" },
	bookmark: { ios: "bookmark", android: "@expo/material-symbols/bookmark.xml" },
	"disc-3": { ios: "opticaldisc", android: "@expo/material-symbols/album.xml" },
	menu: { ios: "line.3.horizontal", android: "@expo/material-symbols/menu.xml" },
	settings: { ios: "gearshape", android: "@expo/material-symbols/settings.xml" },
	music: { ios: "music.note", android: "@expo/material-symbols/music_note.xml" },
	sparkles: { ios: "sparkles", android: "@expo/material-symbols/star_shine.xml" },
	search: { ios: "magnifyingglass", android: "@expo/material-symbols/search.xml" },
	"music-2": { ios: "music.note", android: "@expo/material-symbols/music_note.xml" },
	monitor: { ios: "display", android: "@expo/material-symbols/desktop_windows.xml" },
	clapperboard: { ios: "movieclapper", android: "@expo/material-symbols/movie.xml" },
	"book-open": { ios: "book.pages", android: "@expo/material-symbols/menu_book.xml" },
	dumbbell: { ios: "dumbbell", android: "@expo/material-symbols/fitness_center.xml" },
	headphones: { ios: "headphones", android: "@expo/material-symbols/headphones.xml" },
	"building-2": { ios: "building.2", android: "@expo/material-symbols/apartment.xml" },
	user: { ios: "person.circle", android: "@expo/material-symbols/account_circle.xml" },
	"book-heart": { ios: "heart.text.square", android: "@expo/material-symbols/book.xml" },
	library: { ios: "books.vertical", android: "@expo/material-symbols/local_library.xml" },
	"layers-3": { ios: "square.3.layers.3d", android: "@expo/material-symbols/layers.xml" },
	"more-horizontal": { ios: "ellipsis", android: "@expo/material-symbols/more_horiz.xml" },
	joystick: { ios: "gamecontroller", android: "@expo/material-symbols/sports_esports.xml" },
	"play-square": { ios: "play.square", android: "@expo/material-symbols/smart_display.xml" },
	"square-play": { ios: "play.square", android: "@expo/material-symbols/smart_display.xml" },
	"book-copy": { ios: "books.vertical", android: "@expo/material-symbols/content_copy.xml" },
	"book-marked": { ios: "bookmark.square", android: "@expo/material-symbols/bookmarks.xml" },
	"monitor-play": { ios: "play.display", android: "@expo/material-symbols/play_circle.xml" },
	"panel-left": { ios: "sidebar.left", android: "@expo/material-symbols/side_navigation.xml" },
	"gamepad-2": { ios: "gamecontroller", android: "@expo/material-symbols/sports_esports.xml" },
	"clipboard-list": { ios: "list.clipboard", android: "@expo/material-symbols/checklist.xml" },
	"heart-pulse": { ios: "heart.text.square", android: "@expo/material-symbols/cardiology.xml" },
	"chevron-right": { ios: "chevron.right", android: "@expo/material-symbols/chevron_right.xml" },
	"rotate-ccw": { ios: "arrow.counterclockwise", android: "@expo/material-symbols/refresh.xml" },
	"arrow-up-down": { ios: "arrow.up.arrow.down", android: "@expo/material-symbols/swap_vert.xml" },
	"folder-kanban": { ios: "rectangle.3.group", android: "@expo/material-symbols/view_kanban.xml" },
	"book-image": { ios: "photo.on.rectangle", android: "@expo/material-symbols/photo_library.xml" },
	podcast: { ios: "dot.radiowaves.left.and.right", android: "@expo/material-symbols/podcasts.xml" },
	"list-video": {
		ios: "play.rectangle.on.rectangle",
		android: "@expo/material-symbols/video_library.xml",
	},
	"grip-vertical": {
		ios: "line.3.horizontal",
		android: "@expo/material-symbols/drag_indicator.xml",
	},
	"chevron-down": {
		ios: "chevron.down",
		android: "@expo/material-symbols/keyboard_arrow_down.xml",
	},
};

export function getNativeTabIcon(name: string) {
	return nativeTabIcons[name] ?? fallbackNativeTabIcon;
}

export function getIosNativeTabIcon(name: string) {
	return getNativeTabIcon(name).ios;
}

export function getAndroidNativeTabIconPath(name: string) {
	return getNativeTabIcon(name).android;
}
