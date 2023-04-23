import { graphql } from "@trackona/generated/graphql/backend";

export const BOOKS_SEARCH = graphql(`
	query BooksSearch($input: BookSearchInput!) {
  	booksSearch(input: $input) {
			total
			items {
    		identifier
    		title
    		images
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
	      images
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

export const BOOK_DETAILS = graphql(`
	query BookDetails($metadataId: Int!) {
  	bookDetails(metadataId: $metadataId) {
    	title
    	description
    	creators
    	images
    	publishYear
    	specifics {
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
