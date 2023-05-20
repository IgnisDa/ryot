use std::sync::Arc;

use async_graphql::{Context, Object, Result};
use sea_orm::{
    ActiveModelTrait, ActiveValue, ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter,
};

use crate::{
    entities::{podcast, prelude::Podcast},
    graphql::{IdObject, Identifier},
    media::{
        resolver::{MediaDetails, MediaSearchResults, MediaService, SearchInput},
        MediaSpecifics,
    },
    migrator::MetadataLot,
    traits::MediaProvider,
};

use super::listennotes::ListennotesService;

#[derive(Default)]
pub struct PodcastsQuery;

#[Object]
impl PodcastsQuery {
    /// Search for a list of games by a particular search query and a given page.
    async fn podcasts_search(
        &self,
        gql_ctx: &Context<'_>,
        input: SearchInput,
    ) -> Result<MediaSearchResults> {
        gql_ctx
            .data_unchecked::<PodcastsService>()
            .podcasts_search(&input.query, input.page)
            .await
    }
}

#[derive(Default)]
pub struct PodcastsMutation;

#[Object]
impl PodcastsMutation {
    /// Fetch details about a podcast and create a media item in the database.
    async fn commit_podcast(&self, gql_ctx: &Context<'_>, identifier: String) -> Result<IdObject> {
        gql_ctx
            .data_unchecked::<PodcastsService>()
            .commit_podcast(&identifier)
            .await
    }

    /// Load next 10 episodes of a podcast if they exist.
    async fn commit_next_10_podcast_episodes(
        &self,
        gql_ctx: &Context<'_>,
        podcast_id: Identifier,
    ) -> Result<bool> {
        gql_ctx
            .data_unchecked::<PodcastsService>()
            .commit_next_10_podcast_episodes(podcast_id.into())
            .await
    }
}

#[derive(Debug, Clone)]
pub struct PodcastsService {
    db: DatabaseConnection,
    listennotes_service: Arc<ListennotesService>,
    media_service: Arc<MediaService>,
}

impl PodcastsService {
    pub fn new(
        db: &DatabaseConnection,
        listennotes_service: &ListennotesService,
        media_service: &MediaService,
    ) -> Self {
        Self {
            listennotes_service: Arc::new(listennotes_service.clone()),
            db: db.clone(),
            media_service: Arc::new(media_service.clone()),
        }
    }
}

impl PodcastsService {
    // Get podcasts details from all sources
    async fn podcasts_search(&self, query: &str, page: Option<i32>) -> Result<MediaSearchResults> {
        let movies = self.listennotes_service.search(query, page).await?;
        Ok(movies)
    }

    pub async fn commit_podcast(&self, identifier: &str) -> Result<IdObject> {
        let meta = Podcast::find()
            .filter(podcast::Column::Identifier.eq(identifier))
            .one(&self.db)
            .await
            .unwrap();
        if let Some(m) = meta {
            Ok(IdObject {
                id: m.metadata_id.into(),
            })
        } else {
            let details = self.listennotes_service.details(identifier).await?;
            self.save_to_db(details).await
        }
    }

    pub async fn commit_next_10_podcast_episodes(&self, podcast_id: i32) -> Result<bool> {
        let meta = Podcast::find_by_id(podcast_id)
            .one(&self.db)
            .await
            .unwrap()
            .unwrap();
        if meta.total_episodes == meta.details.episodes.len() as i32 {
            return Ok(false);
        }
        let last_episode = meta.details.episodes.last().unwrap();
        let next_pub_date = last_episode.publish_date;
        let episode_number = last_episode.number;
        let details = self
            .listennotes_service
            .details_with_paginated_episodes(
                &meta.identifier,
                Some(next_pub_date),
                Some(episode_number),
            )
            .await?;
        match details.specifics {
            MediaSpecifics::Podcast(ed) => {
                let mut meta: podcast::ActiveModel = meta.into();
                let mut details_small = meta.details.unwrap();
                details_small.episodes.extend(ed.episodes.into_iter());
                meta.details = ActiveValue::Set(details_small);
                meta.save(&self.db).await.unwrap();
            }
            _ => unreachable!(),
        }
        Ok(true)
    }

    pub async fn save_to_db(&self, details: MediaDetails) -> Result<IdObject> {
        let metadata_id = self
            .media_service
            .commit_media(
                MetadataLot::Podcast,
                details.title,
                details.description,
                details.publish_year,
                details.publish_date,
                details.poster_images,
                details.backdrop_images,
                details.creators,
                details.genres,
            )
            .await?;
        match details.specifics {
            MediaSpecifics::Podcast(s) => {
                let podcast = podcast::ActiveModel {
                    metadata_id: ActiveValue::Set(metadata_id),
                    identifier: ActiveValue::Set(details.identifier),
                    source: ActiveValue::Set(s.source),
                    total_episodes: ActiveValue::Set(s.total_episodes),
                    details: ActiveValue::Set(s),
                };
                podcast.insert(&self.db).await.unwrap();
                Ok(IdObject {
                    id: metadata_id.into(),
                })
            }
            _ => unreachable!(),
        }
    }
}
