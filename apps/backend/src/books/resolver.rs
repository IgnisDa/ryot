use std::sync::Arc;

use async_graphql::{Context, Error, Object, Result};
use sea_orm::{
    ActiveModelTrait, ActiveValue, ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter,
};

use crate::{
    entities::{
        book, metadata,
        prelude::{Book, Metadata},
    },
    graphql::IdObject,
    media::{
        resolver::{MediaDetails, MediaSearchResults, MediaService, SearchInput},
        MediaSpecifics,
    },
    migrator::{MetadataLot, MetadataSource},
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
    /// Fetch details about a book and create a media item in the database.
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

    // Given a metadata id, this fetches the latest details from it's provider
    pub async fn details_from_provider(&self, metadata_id: i32) -> Result<MediaDetails> {
        let (metadata, additional_details) = Metadata::find_by_id(metadata_id)
            .find_also_related(Book)
            .one(&self.db)
            .await
            .unwrap()
            .unwrap();
        let additional_details = additional_details.unwrap();
        let details = match metadata.source {
            MetadataSource::Openlibrary => {
                self.openlibrary_service
                    .details(&metadata.identifier)
                    .await?
            }
            MetadataSource::Goodreads => {
                return Err(Error::new(
                    "Getting details from Goodreads is not supported".to_owned(),
                ))
            }
            MetadataSource::Custom => {
                return Err(Error::new(
                    "Getting details for custom provider is not supported".to_owned(),
                ))
            }
            _ => unreachable!(),
        };
        Ok(details)
    }

    pub async fn commit_book(&self, identifier: &str) -> Result<IdObject> {
        let meta = Metadata::find()
            .filter(metadata::Column::Identifier.eq(identifier))
            .one(&self.db)
            .await
            .unwrap();
        if let Some(m) = meta {
            Ok(IdObject { id: m.id.into() })
        } else {
            let details = self.openlibrary_service.details(identifier).await?;
            self.save_to_db(details).await
        }
    }

    pub async fn save_to_db(&self, details: MediaDetails) -> Result<IdObject> {
        let metadata_id = self
            .media_service
            .commit_media(
                details.identifier.clone(),
                MetadataLot::Book,
                details.title,
                details.description,
                details.publish_year,
                None,
                details.images,
                details.creators,
                details.genres,
            )
            .await?;
        match details.specifics {
            MediaSpecifics::Book(s) => {
                let book = book::ActiveModel {
                    metadata_id: ActiveValue::Set(metadata_id),
                    num_pages: ActiveValue::Set(s.pages),
                    ..Default::default()
                };
                book.insert(&self.db).await.unwrap();
                Ok(IdObject {
                    id: metadata_id.into(),
                })
            }
            _ => unreachable!(),
        }
    }

    pub async fn update_details(&self, media_id: i32, _details: BookSpecifics) -> Result<()> {
        let media = Book::find_by_id(media_id)
            .one(&self.db)
            .await
            .unwrap()
            .unwrap();
        let mut _media: book::ActiveModel = media.into();
        Ok(())
    }
}
