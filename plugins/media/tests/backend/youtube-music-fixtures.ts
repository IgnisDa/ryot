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

const twoRowItem = (id: string, title: string, pageType: string) => ({
	musicTwoRowItemRenderer: {
		...browse(id, pageType),
		title: text(title),
		subtitle: text("2024"),
		thumbnailRenderer: { musicThumbnailRenderer: { thumbnail } },
	},
});

const carousel = (title: string, contents: readonly unknown[]) => ({
	musicCarouselShelfRenderer: {
		contents,
		header: { musicCarouselShelfBasicHeaderRenderer: { title: text(title) } },
	},
});

export const searchResponse = (kind: "song" | "album" | "artist") => ({
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

export const artistResponse = (name: string, songsTitle?: string) => ({
	header: {
		musicImmersiveHeaderRenderer: {
			title: text(name),
			description: text("Artist biography"),
			thumbnail: { musicThumbnailRenderer: { thumbnail } },
		},
	},
	contents: {
		sectionListRenderer: {
			contents: [
				{
					musicShelfRenderer: {
						...shelf(songsTitle ?? "Songs", [song("track", "Track")]).musicShelfRenderer,
						...(songsTitle === undefined
							? {}
							: {
									bottomEndpoint: browse("VLartist-songs", "MUSIC_PAGE_TYPE_PLAYLIST")
										.navigationEndpoint,
								}),
					},
				},
				carousel("Latest release", [twoRowItem("MPRalbum", "Album", "MUSIC_PAGE_TYPE_ALBUM")]),
				carousel("Albums", [twoRowItem("MPRalbum", "Album", "MUSIC_PAGE_TYPE_ALBUM")]),
				carousel("Singles & EPs", [twoRowItem("MPRsingle", "Single", "MUSIC_PAGE_TYPE_ALBUM")]),
				carousel("Fans might also like", [
					twoRowItem("UCneighbor", "Another Artist", "MUSIC_PAGE_TYPE_ARTIST"),
				]),
				carousel("Featured on", [twoRowItem("VLplaylist", "Playlist", "MUSIC_PAGE_TYPE_PLAYLIST")]),
			],
		},
	},
});

export const artistSongsResponse = (continuation?: "token" | "endpoint") => ({
	contents: {
		sectionListRenderer: {
			contents: [
				{
					musicPlaylistShelfRenderer: {
						playlistId: "artist-songs",
						contents: [
							song("track", "Track"),
							song("second", "Second Track"),
							...(continuation === "endpoint"
								? [
										{
											continuationItemRenderer: {
												trigger: "CONTINUATION_TRIGGER_ON_ITEM_SHOWN",
												continuationEndpoint: {
													continuationCommand: {
														token: "page-2",
														request: "CONTINUATION_REQUEST_TYPE_BROWSE",
													},
												},
											},
										},
									]
								: []),
						],
						...(continuation === "token"
							? { continuations: [{ nextContinuationData: { continuation: "page-2" } }] }
							: {}),
					},
				},
			],
		},
	},
});

export const artistSongsContinuationResponse = {
	continuationContents: {
		musicPlaylistShelfContinuation: {
			contents: [song("second", "Second Track"), song("third", "Third Track")],
		},
	},
};

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
