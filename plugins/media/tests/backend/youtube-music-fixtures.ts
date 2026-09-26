const text = (value: string) => ({ runs: [{ text: value }] });
const thumbnail = {
	thumbnails: [{ width: 600, height: 600, url: "https://example.com/cover.jpg" }],
};
const browse = (id: string, pageType: string) => ({
	navigationEndpoint: {
		browseEndpoint: {
			browseId: id,
			browseEndpointContextSupportedConfigs: { browseEndpointContextMusicConfig: { pageType } },
		},
	},
});

const song = (id: string, title: string) => ({
	musicResponsiveListItemRenderer: {
		playlistItemData: { videoId: id },
		thumbnail: { musicThumbnailRenderer: { thumbnail } },
		flexColumns: [
			{
				musicResponsiveListItemFlexColumnRenderer: {
					text: {
						runs: [
							{
								text: title,
								navigationEndpoint: {
									watchEndpoint: {
										videoId: id,
										watchEndpointMusicSupportedConfigs: {
											watchEndpointMusicConfig: { musicVideoType: "MUSIC_VIDEO_TYPE_ATV" },
										},
									},
								},
							},
						],
					},
				},
			},
			{ musicResponsiveListItemFlexColumnRenderer: { text: text("3:21") } },
		],
	},
});

const album = {
	musicResponsiveListItemRenderer: {
		...browse("MPRalbum", "MUSIC_PAGE_TYPE_ALBUM"),
		thumbnail: { musicThumbnailRenderer: { thumbnail } },
		flexColumns: [{ musicResponsiveListItemFlexColumnRenderer: { text: text("Album") } }],
	},
};
const artist = {
	musicResponsiveListItemRenderer: {
		...browse("UCartist", "MUSIC_PAGE_TYPE_ARTIST"),
		thumbnail: { musicThumbnailRenderer: { thumbnail } },
		flexColumns: [{ musicResponsiveListItemFlexColumnRenderer: { text: text("Artist") } }],
	},
};
const shelf = (title: string, contents: readonly unknown[]) => ({
	musicShelfRenderer: { contents, title: text(title) },
});

export const searchResponse = (kind: "song" | "artist" | "album") => ({
	contents: {
		tabbedSearchResultsRenderer: {
			tabs: [
				{
					tabRenderer: {
						selected: true,
						content: {
							sectionListRenderer: {
								contents: [
									shelf("Results", [{ album, artist, song: song("track", "Track") }[kind]]),
								],
							},
						},
					},
				},
			],
		},
	},
});

export const artistResponse = (name: string) => ({
	contents: {
		sectionListRenderer: {
			contents: [shelf("Songs", [song("track", "Track")]), shelf("Albums", [album])],
		},
	},
	header: {
		musicImmersiveHeaderRenderer: {
			title: text(name),
			description: text("Artist biography"),
			thumbnail: { musicThumbnailRenderer: { thumbnail } },
		},
	},
});

export const albumResponse = (name: string) => ({
	contents: {
		sectionListRenderer: {
			contents: [
				{
					musicDetailHeaderRenderer: {
						title: text(name),
						description: text("Album description"),
						thumbnail: { croppedSquareThumbnailRenderer: { thumbnail } },
					},
				},
				shelf("Tracks", [song("track", "Track"), song("neighbor", "Neighbor")]),
			],
		},
	},
});

const queueSong = (id: string, title: string) => ({
	playlistPanelVideoRenderer: {
		thumbnail,
		videoId: id,
		title: text(title),
		lengthText: text("3:21"),
		navigationEndpoint: { watchEndpoint: { videoId: id } },
		longBylineText: {
			runs: [
				{ text: "Artist", ...browse("UCartist", "MUSIC_PAGE_TYPE_ARTIST") },
				{ text: "Album", ...browse("MPRalbum", "MUSIC_PAGE_TYPE_ALBUM") },
				{ text: "2024" },
			],
		},
	},
});

export const queueResponse = (name: string, automix = false) => ({
	contents: {
		tabRenderer: {
			content: {
				musicQueueRenderer: {
					content: {
						playlistPanelRenderer: automix
							? {
									contents: [
										{
											automixPreviewVideoRenderer: {
												content: {
													automixPlaylistVideoRenderer: {
														navigationEndpoint: {
															watchPlaylistEndpoint: { playlistId: "RDfixture" },
														},
													},
												},
											},
										},
									],
								}
							: {
									playlistId: "RDfixture",
									contents: [queueSong("track", name), queueSong("neighbor", "Neighbor")],
								},
					},
				},
			},
		},
	},
});
