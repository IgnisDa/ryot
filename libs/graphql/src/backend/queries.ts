import { graphql } from "@ryot/generated/graphql/backend";

export const BOOKS_SEARCH = graphql(`
	query BooksSearch($input: BookSearchInput!) {
  	booksSearch(input: $input) {
			total
			items {
    		identifier
    		title
    		posterImages
				publishYear
			}
  	}
	}
`);

export const MOVIES_SEARCH = graphql(`
	query MoviesSearch($input: MoviesSearchInput!) {
	  moviesSearch(input: $input) {
	    total
	    items {
	      identifier
	      title
	      posterImages
	      publishYear
	    }
	  }
	}
`);

export const SHOWS_SEARCH = graphql(`
	query ShowsSearch($input: ShowSearchInput!) {
	  showSearch(input: $input) {
	    total
	    items {
	      identifier
	      title
	      posterImages
	      publishYear
	    }
	  }
	}
`);

export const VIDEO_GAMES_SEARCH = graphql(`
	query VideoGamesSearch($input: VideoGamesSearchInput!) {
	  videoGamesSearch(input: $input) {
	    total
	    items {
	      identifier
	      title
	      posterImages
	      publishYear
	    }
	  }
	}
`);

export const AUDIO_BOOKS_SEARCH = graphql(`
	query AudioBooksSearch($input: AudioBookSearchInput!) {
	  audioBooksSearch(input: $input) {
	    total
	    items {
	      identifier
	      title
	      posterImages
	      publishYear
	    }
	  }
	}
`);

export const CORE_DETAILS = graphql(`
	query CoreDetails {
	  coreDetails {
	    version
	    authorName
	  }
	}
`);

export const MEDIA_DETAILS = graphql(`
	query MediaDetails($metadataId: Int!) {
	  mediaDetails(metadataId: $metadataId) {
	    title
	    description
	    type
	    creators
	    type
	    posterImages
	    backdropImages
	    publishYear
	    publishDate
			genres
	    movieSpecifics {
	      runtime
	    }
	    bookSpecifics {
	      pages
	    }
	    showSpecifics {
	      seasons {
	        seasonNumber
	        name
	        overview
	        backdropImages
	        posterImages
	        episodes {
						id
	          name
						posterImages
	          episodeNumber
	          publishDate
	          name
	          overview
	        }
	      }
	    }
	  }
	}
`);

export const SEEN_HISTORY = graphql(`
	query SeenHistory($metadataId: Int!) {
	  seenHistory(metadataId: $metadataId) {
	    id
	    progress
	    startedOn
	    finishedOn
	    lastUpdatedOn
			showInformation {
				episode
				season
			}
	  }
	}
`);

export const MEDIA_CONSUMED = graphql(`
	query MediaConsumed($input: MediaConsumedInput!) {
	  mediaConsumed(input: $input) {
	    seen
	  }
	}
`);

export const MEDIA_LIST = graphql(`
	query MediaList($input: MediaListInput!) {
	  mediaList(input: $input) {
	    total
	    items {
	      identifier
	      title
	      posterImages
				backdropImages
	      publishYear
	    }
	  }
	}
`);

export const CORE_ENABLED_FEATURES = graphql(`
	query CoreEnabledFeatures {
	  coreEnabledFeatures {
	    name
	    enabled
	  }
	}
`);

export const USER_DETAILS = graphql(`
	query UserDetails {
	  userDetails {
	    __typename
	  }
	}
`);

export const USER_SUMMARY = graphql(`
	query UserSummary {
	  userSummary {
	    books {
	      pages
	      read
	    }
	    movies {
	      runtime
	      watched
	    }
	    videoGames {
	      played
	    }
	    shows {
	      runtime
	      watchedEpisodes
				watchedShows
	    }
	    audioBooks {
	      runtime
	      played
	    }
	  }
	}
`);

export const MEDIA_ITEM_REVIEWS = graphql(`
	query MediaItemReviews($metadataId: Int!) {
	  mediaItemReviews(metadataId: $metadataId) {
	    id
	    rating
	    text
	    visibility
	    seasonNumber
	    episodeNumber
	    postedBy {
	      id
	      name
	    }
	  }
	}
`);
