const text = (value: string) => ({ runs: [{ text: value }] });
const thumbnail = {
	thumbnails: [{ width: 600, height: 600, url: "https://example.com/cover.jpg" }],
};
const browse = (id: string, pageType: string, params?: string) => ({
	navigationEndpoint: {
		browseEndpoint: {
			browseId: id,
			...(params === undefined ? {} : { params }),
			browseEndpointContextSupportedConfigs: { browseEndpointContextMusicConfig: { pageType } },
		},
	},
});

const song = (id: string, title: string, musicVideoType = "MUSIC_VIDEO_TYPE_ATV") => ({
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
											watchEndpointMusicConfig: { musicVideoType },
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

const carousel = (
	title: string,
	contents: readonly unknown[],
	endpoint?: ReturnType<typeof browse>["navigationEndpoint"],
) => ({
	musicCarouselShelfRenderer: {
		contents,
		header: {
			musicCarouselShelfBasicHeaderRenderer: {
				title: text(title),
				...(endpoint === undefined
					? {}
					: { moreContentButton: { buttonRenderer: { navigationEndpoint: endpoint } } }),
			},
		},
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
							...(continuation === "endpoint" ? [continuationItem("page-2")] : []),
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

export const artistInventoryResponse = () => {
	const response = artistResponse("Artist");
	return {
		...response,
		contents: {
			sectionListRenderer: {
				contents: [
					...response.contents.sectionListRenderer.contents,
					carousel(
						"Álbumes",
						[twoRowItem("MPRalbum", "Album", "MUSIC_PAGE_TYPE_ALBUM")],
						browse("MPADartist", "MUSIC_PAGE_TYPE_ARTIST_DISCOGRAPHY", "albums").navigationEndpoint,
					),
					carousel(
						"Singles y EPs",
						[twoRowItem("MPRsingle", "Single", "MUSIC_PAGE_TYPE_ALBUM")],
						browse("MPADartist", "MUSIC_PAGE_TYPE_ARTIST_DISCOGRAPHY", "singles")
							.navigationEndpoint,
					),
					carousel(
						"Vídeos",
						[song("video", "Preview video", "MUSIC_VIDEO_TYPE_OMV")],
						browse("VLartist-videos", "MUSIC_PAGE_TYPE_PLAYLIST").navigationEndpoint,
					),
					carousel(
						"Featured on",
						[twoRowItem("VLfeatured", "Featured playlist", "MUSIC_PAGE_TYPE_PLAYLIST")],
						browse("VLfeatured", "MUSIC_PAGE_TYPE_PLAYLIST").navigationEndpoint,
					),
				],
			},
		},
	};
};

export const artistDiscographyResponse = (continuation: "token" | "endpoint") => ({
	contents: {
		sectionListRenderer: {
			contents: [
				{
					gridRenderer: {
						items: [
							twoRowItem("MPRalbum", "Album", "MUSIC_PAGE_TYPE_ALBUM"),
							twoRowItem("MPRsecond", "Second album", "MUSIC_PAGE_TYPE_ALBUM"),
							...(continuation === "endpoint" ? [continuationItem("albums-page-2")] : []),
						],
						...(continuation === "token"
							? { continuations: [{ nextContinuationData: { continuation: "albums-page-2" } }] }
							: {}),
					},
				},
			],
		},
	},
});

const continuationItem = (token: string) => ({
	continuationItemRenderer: {
		trigger: "CONTINUATION_TRIGGER_ON_ITEM_SHOWN",
		continuationEndpoint: {
			continuationCommand: { token, request: "CONTINUATION_REQUEST_TYPE_BROWSE" },
		},
	},
});

export const artistDiscographyContinuationResponse = (format: "grid" | "action") => {
	const items = [
		twoRowItem("MPRsecond", "Second album", "MUSIC_PAGE_TYPE_ALBUM"),
		twoRowItem("MPRthird", "Third album", "MUSIC_PAGE_TYPE_ALBUM"),
	];
	return format === "grid"
		? { continuationContents: { gridContinuation: { items } } }
		: {
				onResponseReceivedActions: [
					{ appendContinuationItemsAction: { continuationItems: items } },
				],
			};
};

export const artistSinglesResponse = {
	contents: {
		sectionListRenderer: {
			contents: [
				{
					gridRenderer: {
						items: [
							twoRowItem("MPRsingle", "Single", "MUSIC_PAGE_TYPE_ALBUM"),
							twoRowItem("MPRep", "EP beyond preview", "MUSIC_PAGE_TYPE_ALBUM"),
						],
					},
				},
			],
		},
	},
};

export const artistVideosResponse = {
	contents: {
		sectionListRenderer: {
			contents: [
				{
					musicPlaylistShelfRenderer: {
						playlistId: "artist-videos",
						contents: [
							song("video", "Preview video", "MUSIC_VIDEO_TYPE_OMV"),
							song("video-2", "Video beyond preview", "MUSIC_VIDEO_TYPE_OMV"),
							continuationItem("videos-page-2"),
						],
					},
				},
			],
		},
	},
};

export const artistVideosContinuationResponse = {
	continuationContents: {
		musicPlaylistShelfContinuation: {
			contents: [
				song("video-2", "Video beyond preview", "MUSIC_VIDEO_TYPE_OMV"),
				song("video-3", "Video continuation", "MUSIC_VIDEO_TYPE_OMV"),
			],
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
