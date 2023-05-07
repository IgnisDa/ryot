use std::sync::Arc;

use async_graphql::{Context, InputObject, Object, Result};
use sea_orm::{
    ActiveModelTrait, ActiveValue, ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter,
};
use serde::{Deserialize, Serialize};

use crate::{
    entities::{book, prelude::Book},
    graphql::IdObject,
    media::resolver::{MediaSearchResults, MediaService},
    migrator::{BookSource, MetadataLot},
};

use super::openlibrary::OpenlibraryService;

#[derive(Serialize, Deserialize, Debug, InputObject)]
pub struct BookSearchInput {
    query: String,
    offset: Option<i32>,
}

#[derive(Default)]
pub struct BooksQuery;

#[Object]
impl BooksQuery {
    /// Search for a list of books by a particular search query and an offset.
    async fn books_search(
        &self,
        gql_ctx: &Context<'_>,
        input: BookSearchInput,
    ) -> Result<MediaSearchResults> {
        gql_ctx
            .data_unchecked::<BooksService>()
            .books_search(&input.query, input.offset)
            .await
    }
}

#[derive(Default)]
pub struct BooksMutation;

#[Object]
impl BooksMutation {
    /// Fetch details about a book and create a media item in the database
    async fn commit_book(
        &self,
        gql_ctx: &Context<'_>,
        identifier: String,
        index: i32,
        input: BookSearchInput,
    ) -> Result<IdObject> {
        gql_ctx
            .data_unchecked::<BooksService>()
            .commit_book(&identifier, &input.query, input.offset, index)
            .await
    }
}

#[derive(Debug)]
pub struct BooksService {
    db: DatabaseConnection,
    openlibrary_service: Arc<OpenlibraryService>,
    media_service: Arc<MediaService>,
}

impl BooksService {
    pub fn new(
        db: &DatabaseConnection,
        openlibrary_service: &OpenlibraryService,
        media_service: &MediaService,
    ) -> Self {
        Self {
            openlibrary_service: Arc::new(openlibrary_service.clone()),
            db: db.clone(),
            media_service: Arc::new(media_service.clone()),
        }
    }
}

impl BooksService {
    // Get book details from all sources
    async fn books_search(&self, query: &str, offset: Option<i32>) -> Result<MediaSearchResults> {
        let books = self
            .openlibrary_service
            .search(query, offset)
            .await
            .unwrap();
        Ok(books)
    }

    async fn commit_book(
        &self,
        identifier: &str,
        query: &str,
        offset: Option<i32>,
        index: i32,
    ) -> Result<IdObject> {
        let meta = Book::find()
            .filter(book::Column::Identifier.eq(identifier))
            .one(&self.db)
            .await
            .unwrap();
        if let Some(m) = meta {
            Ok(IdObject { id: m.metadata_id })
        } else {
            let book_details = self
                .openlibrary_service
                .details(identifier, query, offset, index)
                .await
                .unwrap();
            let metadata_id = self
                .media_service
                .commit_media(
                    MetadataLot::Book,
                    book_details.title,
                    book_details.description,
                    book_details.publish_year,
                    None,
                    book_details.poster_images,
                    book_details.backdrop_images,
                    book_details.creators,
                    vec![],
                )
                .await?;
            let book = book::ActiveModel {
                metadata_id: ActiveValue::Set(metadata_id),
                identifier: ActiveValue::Set(book_details.identifier),
                num_pages: ActiveValue::Set(book_details.specifics.pages),
                source: ActiveValue::Set(BookSource::OpenLibrary),
            };
            book.insert(&self.db).await.unwrap();
            Ok(IdObject { id: metadata_id })
        }
    }
}
