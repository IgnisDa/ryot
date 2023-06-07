use std::sync::Arc;

use async_graphql::{Context, Error, Object, Result};
use sea_orm::{
    ActiveModelTrait, ActiveValue, ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter,
};

use crate::{
    entities::{
        metadata, movie,
        prelude::{Metadata},
    },
    graphql::IdObject,
    media::{
        resolver::{MediaDetails, MediaSearchResults, MediaService, SearchInput},
        MediaSpecifics,
    },
    migrator::{MetadataLot, MetadataSource, MovieSource},
    traits::MediaProvider,
};

use super::{tmdb::TmdbService};

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
    /// Fetch details about a movie and create a media item in the database.
    async fn commit_movie(&self, gql_ctx: &Context<'_>, identifier: String) -> Result<IdObject> {
        gql_ctx
            .data_unchecked::<MoviesService>()
            .commit_movie(&identifier)
            .await
    }
}

#[derive(Debug, Clone)]
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
        let movies = self.tmdb_service.search(query, page).await?;
        Ok(movies)
    }

    pub async fn details_from_provider(&self, metadata_id: i32) -> Result<MediaDetails> {
        let metadata = Metadata::find_by_id(metadata_id)
            .one(&self.db)
            .await
            .unwrap()
            .unwrap();
        let details = match metadata.source {
            MetadataSource::Tmdb => self.tmdb_service.details(&metadata.identifier).await?,
            MetadataSource::Custom => {
                return Err(Error::new(
                    "Getting details for custom provider is not supported".to_owned(),
                ))
            }
            _ => unreachable!(),
        };
        Ok(details)
    }

    pub async fn commit_movie(&self, identifier: &str) -> Result<IdObject> {
        let meta = Metadata::find()
            .filter(metadata::Column::Identifier.eq(identifier))
            .one(&self.db)
            .await
            .unwrap();
        if let Some(m) = meta {
            Ok(IdObject { id: m.id.into() })
        } else {
            let details = self.tmdb_service.details(identifier).await?;
            self.save_to_db(details).await
        }
    }

    pub async fn save_to_db(&self, details: MediaDetails) -> Result<IdObject> {
        let metadata_id = self
            .media_service
            .commit_media(
                details.identifier.clone(),
                MetadataLot::Movie,
                details.source,
                details.title,
                details.description,
                details.publish_year,
                details.publish_date,
                details.images,
                details.creators,
                details.genres,
                details.specifics.clone(),
            )
            .await?;
        match details.specifics {
            MediaSpecifics::Movie(s) => {
                let movie = movie::ActiveModel {
                    metadata_id: ActiveValue::Set(metadata_id),
                    runtime: ActiveValue::Set(s.runtime),
                    source: ActiveValue::Set(MovieSource::Custom),
                };
                movie.insert(&self.db).await.unwrap();
                Ok(IdObject {
                    id: metadata_id.into(),
                })
            }
            _ => unreachable!(),
        }
    }
}
