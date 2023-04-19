import { graphql } from "@trackona/generated/graphql/backend";

export const BOOKS_SEARCH = graphql(`
	query BooksSearch($query: String!, $offset: Int) {
  	booksSearch(query: $query, offset: $offset) {
			total
			limit
			books {
    		identifier
    		title
    		authorNames
    		image
			}
  	}
	}
`);

export const VERSION = graphql(`
	query Version {
		version
	}
`);
