use std::sync::Arc;

use async_graphql::{Context, InputObject, Object, Result};
use sea_orm::{
    ActiveModelTrait, ActiveValue, ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter,
};
use serde::{Deserialize, Serialize};

use crate::{
    entities::{movie, prelude::Movie},
    graphql::IdObject,
    media::resolver::{MediaSearchResults, MediaService, SearchInput},
    migrator::{MetadataLot, MovieSource},
};

use super::tmdb::TmdbService;

#[derive(Default)]
pub struct MoviesQuery;

#[Object]
impl MoviesQuery {
    /// Search for a list of movies by a particular search query and a given page.
    async fn movies_search(
        &self,
        gql_ctx: &Context<'_>,
        input: SearchInput,
    ) -> Result<MediaSearchResults> {
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
    async fn movies_search(&self, query: &str, page: Option<i32>) -> Result<MediaSearchResults> {
        let movies = self.tmdb_service.search(query, page).await.unwrap();
        Ok(movies)
    }

    async fn commit_movie(&self, identifier: &str) -> Result<IdObject> {
        let meta = Movie::find()
            .filter(movie::Column::Identifier.eq(identifier))
            .one(&self.db)
            .await
            .unwrap();
        if let Some(m) = meta {
            Ok(IdObject { id: m.metadata_id })
        } else {
            let movie_details = self.tmdb_service.details(identifier).await.unwrap();
            let metadata_id = self
                .media_service
                .commit_media(
                    MetadataLot::Movie,
                    movie_details.title,
                    movie_details.description,
                    movie_details.publish_year,
                    movie_details.publish_date,
                    movie_details.poster_images,
                    movie_details.backdrop_images,
                    movie_details.creators,
                    movie_details.genres,
                )
                .await?;
            let movie = movie::ActiveModel {
                metadata_id: ActiveValue::Set(metadata_id),
                identifier: ActiveValue::Set(movie_details.identifier),
                runtime: ActiveValue::Set(movie_details.specifics.runtime),
                source: ActiveValue::Set(MovieSource::Tmdb),
            };
            movie.insert(&self.db).await.unwrap();
            Ok(IdObject { id: metadata_id })
        }
    }
}
