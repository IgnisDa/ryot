use std::sync::Arc;

use async_graphql::{Context, Object, Result};
use sea_orm::{
    ActiveModelTrait, ActiveValue, ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter,
};

use crate::{
    entities::{book, prelude::Book},
    graphql::IdObject,
    media::resolver::{MediaDetails, MediaSearchResults, MediaService, SearchInput},
    migrator::MetadataLot,
    traits::MediaProvider,
};

use super::{openlibrary::OpenlibraryService, BookSpecifics};

#[derive(Default)]
pub struct BooksQuery;

#[Object]
impl BooksQuery {
    /// Search for a list of books by a particular search query and an offset.
    async fn books_search(
        &self,
        gql_ctx: &Context<'_>,
        input: SearchInput,
    ) -> Result<MediaSearchResults> {
        gql_ctx
            .data_unchecked::<BooksService>()
            .books_search(&input.query, input.page)
            .await
    }
}

#[derive(Default)]
pub struct BooksMutation;

#[Object]
impl BooksMutation {
    /// Fetch details about a book and create a media item in the database
    async fn commit_book(&self, gql_ctx: &Context<'_>, identifier: String) -> Result<IdObject> {
        gql_ctx
            .data_unchecked::<BooksService>()
            .commit_book(&identifier)
            .await
    }
}

#[derive(Debug, Clone)]
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
    async fn books_search(&self, query: &str, page: Option<i32>) -> Result<MediaSearchResults> {
        let books = self.openlibrary_service.search(query, page).await?;
        Ok(books)
    }

    pub async fn commit_book(&self, identifier: &str) -> Result<IdObject> {
        let meta = Book::find()
            .filter(book::Column::Identifier.eq(identifier))
            .one(&self.db)
            .await
            .unwrap();
        if let Some(m) = meta {
            Ok(IdObject { id: m.metadata_id })
        } else {
            let details = self.openlibrary_service.details(identifier).await?;
            self.save_to_db(details).await
        }
    }

    pub async fn save_to_db(&self, details: MediaDetails<BookSpecifics>) -> Result<IdObject> {
        let metadata_id = self
            .media_service
            .commit_media(
                MetadataLot::Book,
                details.title,
                details.description,
                details.publish_year,
                None,
                details.poster_images,
                details.backdrop_images,
                details.creators,
                details.genres,
            )
            .await?;
        let book = book::ActiveModel {
            metadata_id: ActiveValue::Set(metadata_id),
            identifier: ActiveValue::Set(details.identifier),
            num_pages: ActiveValue::Set(details.specifics.pages),
            source: ActiveValue::Set(details.specifics.source),
        };
        book.insert(&self.db).await.unwrap();
        Ok(IdObject { id: metadata_id })
    }
}
