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

export const VERSION = graphql(`
	query Version {
		version
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
