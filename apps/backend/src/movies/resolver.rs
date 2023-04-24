use std::sync::Arc;

use async_graphql::{Context, InputObject, Object, Result};
use sea_orm::{
    ActiveModelTrait, ActiveValue, DatabaseConnection, EntityTrait, QueryFilter,
};
use serde::{Deserialize, Serialize};

use crate::{
    entities::{
        movie,
    },
    graphql::IdObject,
    media::resolver::{MediaService, SearchResults},
    migrator::{MetadataLot},
};

use super::tmdb::TmdbService;

#[derive(Serialize, Deserialize, Debug, InputObject)]
pub struct MoviesSearchInput {
    query: String,
    page: Option<i32>,
}

#[derive(Default)]
pub struct MoviesQuery;

#[Object]
impl MoviesQuery {
    /// Search for a list of movies by a particular search query and an offset.
    async fn movies_search(
        &self,
        gql_ctx: &Context<'_>,
        input: MoviesSearchInput,
    ) -> Result<SearchResults> {
        gql_ctx
            .data_unchecked::<MoviesService>()
            .movies_search(&input.query, input.page)
            .await
    }
}

#[derive(Default)]
pub struct MoviesMutation;

#[Object]
impl MoviesMutation {
    /// Fetch details about a movie and create a media item in the database
    async fn commit_movie(&self, gql_ctx: &Context<'_>, identifier: String) -> Result<IdObject> {
        gql_ctx
            .data_unchecked::<MoviesService>()
            .commit_movie(&identifier)
            .await
    }
}

#[derive(Debug)]
pub struct MoviesService {
    db: DatabaseConnection,
    tmdb_service: Arc<TmdbService>,
    media_service: Arc<MediaService>,
}

impl MoviesService {
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

impl MoviesService {
    // Get movie details from all sources
    async fn movies_search(&self, query: &str, page: Option<i32>) -> Result<SearchResults> {
        let movies = self.tmdb_service.search(query, page).await.unwrap();
        Ok(movies)
    }

    async fn commit_movie(&self, identifier: &str) -> Result<IdObject> {
        let movie_details = self.tmdb_service.details(identifier).await.unwrap();
        let metadata_id = self
            .media_service
            .commit_media(identifier, MetadataLot::Movie, &movie_details)
            .await?;
        let movie = movie::ActiveModel {
            metadata_id: ActiveValue::Set(metadata_id),
            tmdb_id: ActiveValue::Set(movie_details.identifier),
            runtime: ActiveValue::Set(movie_details.movie_specifics.unwrap().runtime),
        };
        let movie = movie.insert(&self.db).await.unwrap();
        Ok(IdObject {
            id: movie.metadata_id,
        })
    }
}
