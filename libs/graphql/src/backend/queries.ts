import { graphql } from "@trackona/generated/graphql/backend";

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
	          name
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
