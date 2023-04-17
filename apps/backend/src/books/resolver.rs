use std::sync::Arc;

use async_graphql::{Context, Object, Result, SimpleObject};
use serde::{Deserialize, Serialize};

use super::openlibrary::OpenlibraryService;

#[derive(Debug, Serialize, Deserialize, SimpleObject)]
pub struct BookSearch {
    pub identifier: String,
    pub title: String,
    pub author_names: Vec<String>,
    pub image: Option<String>,
}

#[derive(Default)]
pub struct BooksQuery;

#[Object]
impl BooksQuery {
    /// Search for a list of books by a particular search query and an offset.
    async fn books_search(
        &self,
        gql_ctx: &Context<'_>,
        query: String,
        offset: Option<i32>,
    ) -> Result<Vec<BookSearch>> {
        gql_ctx
            .data_unchecked::<BooksService>()
            .books_search(&query, offset)
            .await
    }
}

#[derive(Debug)]
pub struct BooksService {
    openlibrary_service: Arc<OpenlibraryService>,
}

impl BooksService {
    pub fn new(openlibrary_service: &OpenlibraryService) -> Self {
        Self {
            openlibrary_service: Arc::new(openlibrary_service.clone()),
        }
    }
}

impl BooksService {
    // Get book details from all sources
    async fn books_search(&self, query: &str, offset: Option<i32>) -> Result<Vec<BookSearch>> {
        let mut books = vec![];
        books.extend(
            self.openlibrary_service
                .search(query, offset)
                .await
                .unwrap(),
        );
        Ok(books)
    }
}
