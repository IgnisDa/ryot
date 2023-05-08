use std::sync::Arc;

use async_graphql::{Context, Object, Result};
use sea_orm::{
    ActiveModelTrait, ActiveValue, ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter,
};

use crate::{
    entities::{audio_book, prelude::AudioBook},
    graphql::IdObject,
    media::resolver::{MediaSearchResults, MediaService, SearchInput},
    migrator::{AudioBookSource, MetadataLot},
    providers::MediaProvider,
};

use super::audible::AudibleService;

#[derive(Default)]
pub struct AudioBooksQuery;

#[Object]
impl AudioBooksQuery {
    /// Search for a list of audio books by a particular search query and a given page.
    async fn audio_books_search(
        &self,
        gql_ctx: &Context<'_>,
        input: SearchInput,
    ) -> Result<MediaSearchResults> {
        gql_ctx
            .data_unchecked::<AudioBooksService>()
            .audio_books_search(&input.query, input.page)
            .await
    }
}

#[derive(Default)]
pub struct AudioBooksMutation;

#[Object]
impl AudioBooksMutation {
    /// Fetch details about a audio book and create a media item in the database
    async fn commit_audio_book(
        &self,
        gql_ctx: &Context<'_>,
        identifier: String,
    ) -> Result<IdObject> {
        gql_ctx
            .data_unchecked::<AudioBooksService>()
            .commit_audio_book(&identifier)
            .await
    }
}

#[derive(Debug)]
pub struct AudioBooksService {
    db: DatabaseConnection,
    audible_service: Arc<AudibleService>,
    media_service: Arc<MediaService>,
}

impl AudioBooksService {
    pub fn new(
        db: &DatabaseConnection,
        audible_service: &AudibleService,
        media_service: &MediaService,
    ) -> Self {
        Self {
            audible_service: Arc::new(audible_service.clone()),
            db: db.clone(),
            media_service: Arc::new(media_service.clone()),
        }
    }
}

impl AudioBooksService {
    // Get movie details from all sources
    async fn audio_books_search(
        &self,
        query: &str,
        page: Option<i32>,
    ) -> Result<MediaSearchResults> {
        let audio_books = self.audible_service.search(query, page).await.unwrap();
        Ok(audio_books)
    }

    async fn commit_audio_book(&self, identifier: &str) -> Result<IdObject> {
        let meta = AudioBook::find()
            .filter(audio_book::Column::Identifier.eq(identifier))
            .one(&self.db)
            .await
            .unwrap();
        if let Some(m) = meta {
            Ok(IdObject { id: m.metadata_id })
        } else {
            let audio_books_details = self.audible_service.details(identifier).await.unwrap();
            let metadata_id = self
                .media_service
                .commit_media(
                    MetadataLot::AudioBook,
                    audio_books_details.title,
                    audio_books_details.description,
                    audio_books_details.publish_year,
                    audio_books_details.publish_date,
                    audio_books_details.poster_images,
                    audio_books_details.backdrop_images,
                    audio_books_details.creators,
                    audio_books_details.genres,
                )
                .await?;
            let movie = audio_book::ActiveModel {
                metadata_id: ActiveValue::Set(metadata_id),
                identifier: ActiveValue::Set(audio_books_details.identifier),
                runtime: ActiveValue::Set(audio_books_details.specifics.runtime),
                source: ActiveValue::Set(AudioBookSource::Audible),
            };
            movie.insert(&self.db).await.unwrap();
            Ok(IdObject { id: metadata_id })
        }
    }
}
