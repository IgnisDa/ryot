use std::sync::Arc;

use async_graphql::{Context, Object, Result, SimpleObject};
use sea_orm::DatabaseConnection;
use serde::{Deserialize, Serialize};

use super::openlibrary::OpenlibraryService;

#[derive(Serialize, Deserialize, Debug, SimpleObject)]
pub struct BookSearch {
    pub total: i32,
    pub books: Vec<PartialBook>,
    pub limit: i32,
}

#[derive(Debug, Serialize, Deserialize, SimpleObject)]
pub struct PartialBook {
    pub identifier: String,
    pub title: String,
    pub author_names: Vec<String>,
    pub image: Option<String>,
    pub publish_year: Option<i32>,
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
    ) -> Result<BookSearch> {
        gql_ctx
            .data_unchecked::<BooksService>()
            .books_search(&query, offset)
            .await
    }
}

#[derive(Debug)]
pub struct BooksService {
    db: DatabaseConnection,
    openlibrary_service: Arc<OpenlibraryService>,
}

impl BooksService {
    pub fn new(db: &DatabaseConnection, openlibrary_service: &OpenlibraryService) -> Self {
        Self {
            openlibrary_service: Arc::new(openlibrary_service.clone()),
            db: db.clone(),
        }
    }
}

impl BooksService {
    // Get book details from all sources
    async fn books_search(&self, query: &str, offset: Option<i32>) -> Result<BookSearch> {
        let books = self
            .openlibrary_service
            .search(query, offset)
            .await
            .unwrap();
        Ok(books)
    }
}
