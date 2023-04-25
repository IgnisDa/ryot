use std::sync::Arc;

use async_graphql::{Context, InputObject, Object, Result};
use sea_orm::{ActiveModelTrait, ActiveValue, DatabaseConnection};
use serde::{Deserialize, Serialize};

use crate::{
    entities::movie,
    graphql::IdObject,
    media::resolver::{MediaSearchResults, MediaService},
    migrator::MetadataLot,
};

use super::tmdb::TmdbService;

#[derive(Serialize, Deserialize, Debug, InputObject)]
pub struct ShowSearchInput {
    query: String,
    page: Option<i32>,
}

#[derive(Default)]
pub struct ShowsQuery;

#[Object]
impl ShowsQuery {
    /// Search for a list of show by a particular search query and a given page.
    async fn show_search(
        &self,
        gql_ctx: &Context<'_>,
        input: ShowSearchInput,
    ) -> Result<MediaSearchResults> {
        gql_ctx
            .data_unchecked::<ShowsService>()
            .show_search(&input.query, input.page)
            .await
    }
}

#[derive(Default)]
pub struct ShowsMutation;

#[Object]
impl ShowsMutation {
    /// Fetch details about a show and create a media item in the database
    async fn commit_show(&self, gql_ctx: &Context<'_>, identifier: String) -> Result<IdObject> {
        gql_ctx
            .data_unchecked::<ShowsService>()
            .commit_show(&identifier)
            .await
    }
}

#[derive(Debug)]
pub struct ShowsService {
    db: DatabaseConnection,
    tmdb_service: Arc<TmdbService>,
    media_service: Arc<MediaService>,
}

impl ShowsService {
    pub fn new(
        db: &DatabaseConnection,
        tmdb_service: &TmdbService,

        media_service: &MediaService,
    ) -> Self {
        Self {
            tmdb_service: Arc::new(tmdb_service.clone()),
            db: db.clone(),
            media_service: Arc::new(media_service.clone()),
        }
    }
}

impl ShowsService {
    // Get show details from all sources
    async fn show_search(&self, query: &str, page: Option<i32>) -> Result<MediaSearchResults> {
        let movies = self.tmdb_service.search(query, page).await.unwrap();
        Ok(movies)
    }

    async fn commit_show(&self, identifier: &str) -> Result<IdObject> {
        let movie_details = self.tmdb_service.details(identifier).await.unwrap();
        return Ok(IdObject { id: 12 });
        let (metadata_id, did_exist) = self
            .media_service
            .commit_media(identifier, MetadataLot::Movie, &movie_details)
            .await?;
        if !did_exist {
            let movie = movie::ActiveModel {
                metadata_id: ActiveValue::Set(metadata_id),
                tmdb_id: ActiveValue::Set(movie_details.identifier),
                runtime: ActiveValue::Set(movie_details.movie_specifics.unwrap().runtime),
            };
            movie.insert(&self.db).await.unwrap();
        }
        Ok(IdObject { id: metadata_id })
    }
}
