use std::sync::Arc;

use async_graphql::{Context, Object, Result};
use sea_orm::{
    ActiveModelTrait, ActiveValue, ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter,
};

use crate::{
    entities::{
        metadata, podcast,
        prelude::{Metadata, Podcast},
    },
    graphql::{IdObject, Identifier},
    media::{
        resolver::{MediaDetails, MediaSearchResults, MediaService, SearchInput},
        MediaSpecifics,
    },
    migrator::MetadataLot,
    traits::MediaProvider,
};

use super::{listennotes::ListennotesService, PodcastSpecifics};

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
        let meta = Metadata::find()
            .filter(metadata::Column::Identifier.eq(identifier))
            .one(&self.db)
            .await
            .unwrap();
        if let Some(m) = meta {
            Ok(IdObject { id: m.id.into() })
        } else {
            let details = self.listennotes_service.details(identifier).await?;
            self.save_to_db(details).await
        }
    }

    pub async fn commit_next_10_podcast_episodes(&self, podcast_id: i32) -> Result<bool> {
        let (podcast, meta) = Podcast::find_by_id(podcast_id)
            .find_also_related(Metadata)
            .one(&self.db)
            .await
            .unwrap()
            .unwrap();
        let meta = meta.unwrap();
        if podcast.total_episodes == podcast.details.episodes.len() as i32 {
            return Ok(false);
        }
        let last_episode = podcast.details.episodes.last().unwrap();
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
                let mut meta: podcast::ActiveModel = podcast.into();
                let mut details_small = meta.details.unwrap();
                details_small.episodes.extend(ed.episodes.into_iter());
                meta.details = ActiveValue::Set(details_small);
                meta.save(&self.db).await.unwrap();
            }
            _ => unreachable!(),
        }
        Ok(true)
    }

    pub async fn details_from_provider(&self, metadata_id: i32) -> Result<MediaDetails> {
        let identifier = Metadata::find_by_id(metadata_id)
            .one(&self.db)
            .await
            .unwrap()
            .unwrap()
            .identifier;
        let details = self.listennotes_service.details(&identifier).await?;
        Ok(details)
    }

    pub async fn save_to_db(&self, details: MediaDetails) -> Result<IdObject> {
        let metadata_id = self
            .media_service
            .commit_media(
                details.identifier.clone(),
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

    pub async fn update_details(&self, media_id: i32, details: PodcastSpecifics) -> Result<()> {
        let media = Podcast::find_by_id(media_id)
            .one(&self.db)
            .await
            .unwrap()
            .unwrap();
        let mut media: podcast::ActiveModel = media.into();
        media.total_episodes = ActiveValue::Set(details.total_episodes);
        media.details = ActiveValue::Set(details);
        media.save(&self.db).await.ok();
        Ok(())
    }
}
