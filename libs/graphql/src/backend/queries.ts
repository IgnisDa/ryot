import { graphql } from "@trackona/generated/graphql/backend";

export const BOOKS_SEARCH = graphql(`
	query BooksSearch($query: String!, $offset: Int) {
  	booksSearch(query: $query, offset: $offset) {
    	identifier
    	title
    	authorNames
    	image
  	}
	}
`);
