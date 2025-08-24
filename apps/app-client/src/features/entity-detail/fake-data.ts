import type { EntityDetail, EntityImage } from "./types";

const img = (url: string): EntityImage => ({ kind: "remote", url });

// Image sources:
//   book, comic-book, audiobook → Open Library / Apple Books
//   movie, show                 → TMDB (media.themoviedb.org)
//   anime, manga, visual-novel  → MyAnimeList (via Jikan)
//   music                       → Cover Art Archive (MusicBrainz)
//   podcast                     → Apple Podcasts
//   video-game                  → Steam CDN

export const FAKE_ENTITY_DATA: Partial<Record<string, EntityDetail>> = {
	book: {
		id: "fake-book-1",
		name: "The Name of the Wind",
		entitySchemaSlug: "book",
		images: [img("https://covers.openlibrary.org/b/id/8259445-L.jpg")],
		genres: ["Fantasy", "Epic Fantasy", "Magic", "Coming-of-Age"],
		publishYear: 2007,
		providerRating: 9.1,
		productionStatus: "Published",
		isNsfw: false,
		sourceUrl: null,
		pages: 662,
		isCompilation: false,
		description:
			"Told in Kvothe's own voice, this is the tale of the magically gifted young man who grows to be the most notorious wizard his world has ever seen. From his childhood in a troupe of traveling players, to years spent as a near-feral orphan in a crime-ridden city, to his daringly brazen theft at the University, this first-person narrative is a richly detailed portrait of a boy called Kvothe—now turned legend.",
		freeCreators: [
			{
				name: "Patrick Rothfuss",
				role: "Author",
				image: "https://picsum.photos/seed/patrick-rothfuss/160/160",
			},
		],
		collections: ["Fantasy Essentials"],
	},

	movie: {
		id: "fake-movie-1",
		name: "Dune: Part Two",
		entitySchemaSlug: "movie",
		images: [img("https://media.themoviedb.org/t/p/w500/1pdfLvkbY9ohJlCjQH2CZjjYVvJ.jpg")],
		genres: ["Science Fiction", "Adventure", "Drama"],
		publishYear: 2024,
		providerRating: 8.7,
		productionStatus: "Released",
		isNsfw: false,
		sourceUrl: null,
		runtime: 167,
		description:
			"Paul Atreides unites with Chani and the Fremen while on a warpath of revenge against the conspirators who destroyed his family. Facing a choice between the love of his life and the fate of the known universe, he endeavors to prevent a terrible future only he can foresee.",
		freeCreators: [
			{
				name: "Denis Villeneuve",
				role: "Director",
				image: "https://picsum.photos/seed/denis-villeneuve/160/160",
			},
			{
				name: "Timothée Chalamet",
				role: "Actor",
				image: "https://picsum.photos/seed/timothee-chalamet/160/160",
			},
			{
				name: "Zendaya",
				role: "Actor",
				image: "https://picsum.photos/seed/zendaya/160/160",
			},
			{
				name: "Rebecca Ferguson",
				role: "Actor",
				image: "https://picsum.photos/seed/rebecca-ferguson/160/160",
			},
		],
		collections: ["Sci-Fi Favorites", "Villeneuve Marathon"],
	},

	show: {
		id: "fake-show-1",
		name: "Breaking Bad",
		entitySchemaSlug: "show",
		images: [img("https://media.themoviedb.org/t/p/w500/ztkUQFLlC19CCMYHW9o1zWhJRNq.jpg")],
		genres: ["Crime", "Drama", "Thriller"],
		publishYear: 2008,
		providerRating: 9.5,
		productionStatus: "Ended",
		isNsfw: false,
		sourceUrl: null,
		description:
			"A high school chemistry teacher diagnosed with inoperable lung cancer turns to manufacturing and selling methamphetamine in order to secure his family's future.",
		showSeasons: [
			{
				id: 1,
				name: "Season 1",
				seasonNumber: 1,
				publishDate: "2008-01-20",
				episodes: [
					{
						id: 1,
						name: "Pilot",
						episodeNumber: 1,
						runtime: 58,
						overview:
							"Walter White, a struggling chemistry teacher, discovers he has terminal cancer.",
					},
					{ id: 2, name: "Cat's in the Bag", episodeNumber: 2, runtime: 48, overview: null },
					{
						id: 3,
						name: "...And the Bag's in the River",
						episodeNumber: 3,
						runtime: 48,
						overview: null,
					},
					{ id: 4, name: "Cancer Man", episodeNumber: 4, runtime: 48, overview: null },
					{ id: 5, name: "Gray Matter", episodeNumber: 5, runtime: 48, overview: null },
					{
						id: 6,
						name: "Crazy Handful of Nothin'",
						episodeNumber: 6,
						runtime: 48,
						overview: null,
					},
					{
						id: 7,
						name: "A No-Rough-Stuff-Type Deal",
						episodeNumber: 7,
						runtime: 48,
						overview: null,
					},
				],
			},
			{
				id: 2,
				name: "Season 2",
				seasonNumber: 2,
				publishDate: "2009-03-08",
				episodes: [
					{ id: 8, name: "Seven Thirty-Seven", episodeNumber: 1, runtime: 47, overview: null },
					{ id: 9, name: "Grilled", episodeNumber: 2, runtime: 47, overview: null },
					{ id: 10, name: "Bit by a Dead Bee", episodeNumber: 3, runtime: 47, overview: null },
					{ id: 11, name: "Down", episodeNumber: 4, runtime: 47, overview: null },
					{ id: 12, name: "Breakage", episodeNumber: 5, runtime: 47, overview: null },
					{ id: 13, name: "Peekaboo", episodeNumber: 6, runtime: 47, overview: null },
					{ id: 14, name: "Negro y Azul", episodeNumber: 7, runtime: 47, overview: null },
					{ id: 15, name: "Better Call Saul", episodeNumber: 8, runtime: 47, overview: null },
					{ id: 16, name: "4 Days Out", episodeNumber: 9, runtime: 47, overview: null },
					{ id: 17, name: "Over", episodeNumber: 10, runtime: 47, overview: null },
					{ id: 18, name: "Mandala", episodeNumber: 11, runtime: 47, overview: null },
					{ id: 19, name: "Phoenix", episodeNumber: 12, runtime: 47, overview: null },
					{ id: 20, name: "ABQ", episodeNumber: 13, runtime: 47, overview: null },
				],
			},
			{
				id: 3,
				name: "Season 3",
				seasonNumber: 3,
				publishDate: "2010-03-21",
				episodes: Array.from({ length: 13 }, (_, i) => ({
					id: 30 + i,
					name: `Episode ${i + 1}`,
					episodeNumber: i + 1,
					runtime: 47,
					overview: null,
				})),
			},
			{
				id: 4,
				name: "Season 4",
				seasonNumber: 4,
				publishDate: "2011-07-17",
				episodes: Array.from({ length: 13 }, (_, i) => ({
					id: 50 + i,
					name: `Episode ${i + 1}`,
					episodeNumber: i + 1,
					runtime: 47,
					overview: null,
				})),
			},
			{
				id: 5,
				name: "Season 5",
				seasonNumber: 5,
				publishDate: "2012-07-15",
				episodes: Array.from({ length: 16 }, (_, i) => ({
					id: 70 + i,
					name: `Episode ${i + 1}`,
					episodeNumber: i + 1,
					runtime: 47,
					overview: null,
				})),
			},
		],
		freeCreators: [
			{
				name: "Vince Gilligan",
				role: "Creator",
				image: "https://picsum.photos/seed/vince-gilligan/160/160",
			},
			{
				name: "Bryan Cranston",
				role: "Actor",
				image: "https://picsum.photos/seed/bryan-cranston/160/160",
			},
			{
				name: "Aaron Paul",
				role: "Actor",
				image: "https://picsum.photos/seed/aaron-paul/160/160",
			},
			{
				name: "Anna Gunn",
				role: "Actor",
				image: "https://picsum.photos/seed/anna-gunn/160/160",
			},
			{
				name: "Dean Norris",
				role: "Actor",
				image: "https://picsum.photos/seed/dean-norris/160/160",
			},
			{
				name: "Betsy Brandt",
				role: "Actor",
				image: "https://picsum.photos/seed/betsy-brandt/160/160",
			},
			{
				name: "RJ Mitte",
				role: "Actor",
				image: "https://picsum.photos/seed/rj-mitte/160/160",
			},
			{
				name: "Bob Odenkirk",
				role: "Actor",
				image: "https://picsum.photos/seed/bob-odenkirk/160/160",
			},
			{
				name: "Giancarlo Esposito",
				role: "Actor",
				image: "https://picsum.photos/seed/giancarlo-esposito/160/160",
			},
			{
				name: "Jonathan Banks",
				role: "Actor",
				image: "https://picsum.photos/seed/jonathan-banks/160/160",
			},
			{
				name: "Jesse Plemons",
				role: "Actor",
				image: "https://picsum.photos/seed/jesse-plemons/160/160",
			},
			{
				name: "Krysten Ritter",
				role: "Actor",
				image: "https://picsum.photos/seed/krysten-ritter/160/160",
			},
			{
				name: "Mark Johnson",
				role: "Executive Producer",
				image: "https://picsum.photos/seed/mark-johnson/160/160",
			},
		],
		collections: ["Crime Dramas", "TV Classics"],
	},

	anime: {
		id: "fake-anime-1",
		name: "Frieren: Beyond Journey's End",
		entitySchemaSlug: "anime",
		images: [img("https://myanimelist.net/images/anime/1015/138006l.jpg")],
		genres: ["Fantasy", "Adventure", "Slice of Life", "Drama"],
		publishYear: 2023,
		providerRating: 9.3,
		productionStatus: "Ended",
		isNsfw: false,
		sourceUrl: null,
		episodes: 28,
		description:
			"The adventure is over but life goes on for an elf mage just beginning to learn what living is all about. Elf mage Frieren and her courageous fellow adventurers have defeated the Demon King and brought peace to the land. But Frieren will long outlive the rest of her party. How does she come to terms with the mortality of her friends?",
		airingSchedule: null,
		collections: null,
	},

	manga: {
		id: "fake-manga-1",
		name: "Berserk",
		entitySchemaSlug: "manga",
		images: [img("https://myanimelist.net/images/manga/1/157897l.jpg")],
		genres: ["Dark Fantasy", "Action", "Horror", "Psychological"],
		publishYear: 1989,
		providerRating: 9.4,
		productionStatus: "Continuing",
		isNsfw: true,
		sourceUrl: null,
		volumes: 41,
		chapters: 374,
		description:
			"Guts is a lone mercenary swordsman. His giant sword is as tall as he is and almost too heavy to lift—but he carries it with ease. He wanders a world of dark fantasy, slaying beasts and bounty targets alike with equal parts finesse and brutality.",
		collections: null,
	},

	"comic-book": {
		id: "fake-comic-1",
		name: "Watchmen",
		entitySchemaSlug: "comic-book",
		images: [img("https://covers.openlibrary.org/b/id/710360-L.jpg")],
		genres: ["Superhero", "Political Fiction", "Mystery", "Drama"],
		publishYear: 1986,
		providerRating: 9.2,
		productionStatus: "Completed",
		isNsfw: false,
		sourceUrl: null,
		pages: 416,
		description:
			"Set in an alternate 1985 America in which costumed superheroes are part of the fabric of everyday society, and the Doomsday Clock—which charts the tension between the USA and the USSR—stands at five minutes to midnight, a murder mystery sets off a chain of events with global consequences.",
		collections: ["Graphic Novels"],
	},

	audiobook: {
		id: "fake-audiobook-1",
		name: "Atomic Habits",
		entitySchemaSlug: "audiobook",
		images: [
			img(
				"https://is1-ssl.mzstatic.com/image/thumb/Music123/v4/c2/33/3e/c2333e4e-05ee-492f-cc86-2fe15fa70a4f/9781524779269.d.jpg/600x600bb.jpg",
			),
		],
		genres: ["Self-Help", "Productivity", "Psychology", "Business"],
		publishYear: 2018,
		providerRating: 8.8,
		productionStatus: "Published",
		isNsfw: false,
		sourceUrl: null,
		runtime: 491,
		description:
			"No matter your goals, Atomic Habits offers a proven framework for improving—every day. James Clear, one of the world's leading experts on habit formation, reveals practical strategies that will teach you exactly how to form good habits, break bad ones, and master the tiny behaviors that lead to remarkable results.",
		freeCreators: [
			{
				name: "James Clear",
				role: "Author",
				image: "https://picsum.photos/seed/james-clear/160/160",
			},
			{
				name: "James Clear",
				role: "Narrator",
				image: "https://picsum.photos/seed/james-clear/160/160",
			},
		],
		collections: ["Self-Help Shelf"],
	},

	podcast: {
		id: "fake-podcast-1",
		name: "Lex Fridman Podcast",
		entitySchemaSlug: "podcast",
		images: [
			img(
				"https://is1-ssl.mzstatic.com/image/thumb/Podcasts115/v4/3e/e3/9c/3ee39c89-de08-47a6-7f3d-3849cef6d255/mza_16657851278549137484.png/600x600bb.jpg",
			),
		],
		genres: ["Technology", "Science", "Philosophy", "Interview"],
		publishYear: 2018,
		providerRating: 8.5,
		productionStatus: "Continuing",
		isNsfw: false,
		sourceUrl: null,
		totalEpisodes: 400,
		description:
			"Conversations about science, technology, history, philosophy and the nature of intelligence, consciousness, love, and power. Lex Fridman is a research scientist at MIT and beyond.",
		episodes: [
			{
				id: "e400",
				title: "Elon Musk: War, AI, Aliens, Politics, Physics, Video Games, and Humanity",
				number: 400,
				publishDate: "2023-12-17",
				runtime: 410,
				overview: null,
			},
			{
				id: "e399",
				title: "Marc Andreessen: Trump, Power, Tech, AI, Immigration, and the Future of America",
				number: 399,
				publishDate: "2023-12-07",
				runtime: 318,
				overview: null,
			},
			{
				id: "e398",
				title: "Ben Shapiro vs Destiny Debate: Politics, Jan 6, Israel, Ukraine & Wokeism",
				number: 398,
				publishDate: "2023-11-14",
				runtime: 338,
				overview: null,
			},
			{
				id: "e397",
				title: "Sam Altman: OpenAI, GPT-5, Sora, Board Saga, Elon Musk, Ilya, Power & AGI",
				number: 397,
				publishDate: "2024-03-19",
				runtime: 218,
				overview: null,
			},
			{
				id: "e396",
				title: "George Hotz vs Eliezer Yudkowsky: AI Safety Debate",
				number: 396,
				publishDate: "2023-10-20",
				runtime: 285,
				overview: null,
			},
		],
		freeCreators: [
			{
				name: "Lex Fridman",
				role: "Host",
				image: "https://picsum.photos/seed/lex-fridman/160/160",
			},
		],
		collections: ["Long Form Interviews"],
	},

	music: {
		id: "fake-music-1",
		name: "OK Computer",
		entitySchemaSlug: "music",
		images: [
			img(
				"https://coverartarchive.org/release/30702389-5c67-4438-9ea0-2351c8de0f1d/43287476628.png",
			),
		],
		genres: ["Alternative Rock", "Art Rock", "Electronic"],
		publishYear: 1997,
		providerRating: 9.6,
		productionStatus: "Released",
		isNsfw: false,
		sourceUrl: null,
		duration: 3134,
		byVariousArtists: false,
		description:
			"OK Computer is the third studio album by English rock band Radiohead, released on 16 May 1997. It marked a departure from the more conventional guitar-based sound of their previous releases, incorporating elements of art rock, ambient music, and jazz.",
		collections: ["90s Classics"],
	},

	"video-game": {
		id: "fake-vg-1",
		name: "Elden Ring",
		entitySchemaSlug: "video-game",
		images: [
			img("https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/1245620/header.jpg"),
		],
		genres: ["Action RPG", "Open World", "Fantasy", "Souls-like"],
		publishYear: 2022,
		providerRating: 9.5,
		productionStatus: "Released",
		isNsfw: false,
		sourceUrl: null,
		description:
			"A new fantasy action-RPG adventure set in a world created by Hidetaka Miyazaki, creator of the Dark Souls series, and George R. R. Martin. Rise, Tarnished, and be guided by grace to brandish the power of the Elden Ring and become an Elden Lord in the Lands Between.",
		collections: ["Souls-likes", "Open World"],
		timeToBeat: { hastily: 44 * 60, normally: 58 * 60, completely: 133 * 60 },
		platformReleases: [
			{ name: "PlayStation 5", releaseDate: "2022-02-25" },
			{ name: "Xbox Series X/S", releaseDate: "2022-02-25" },
			{ name: "PC (Steam)", releaseDate: "2022-02-25" },
		],
	},

	"visual-novel": {
		id: "fake-vn-1",
		name: "Fate/stay night",
		entitySchemaSlug: "visual-novel",
		images: [img("https://myanimelist.net/images/anime/4/30327l.jpg")],
		genres: ["Fantasy", "Action", "Romance", "Supernatural"],
		publishYear: 2004,
		providerRating: 9.0,
		productionStatus: "Completed",
		isNsfw: false,
		sourceUrl: null,
		lengthMinutes: 7200,
		description:
			"The Holy Grail War is a battle royale among seven magi who serve as Masters. Masters summon Servants—Heroic Spirits who are legendary heroes of old—to fight for the Holy Grail, a magical artifact that can grant any wish. Shirou Emiya becomes drawn into the Fifth Holy Grail War after encountering two Servants fighting in his school.",
		collections: null,
	},
};
