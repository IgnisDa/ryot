import { graphql } from "@trackona/generated/graphql/backend";

export const BOOKS_SEARCH = graphql(`
	query BooksSearch($input: BookSearchInput!) {
  	booksSearch(input: $input) {
			total
			limit
			books {
    		identifier
    		title
    		authorNames
    		image
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
