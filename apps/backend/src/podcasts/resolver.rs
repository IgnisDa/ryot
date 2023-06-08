use std::sync::Arc;

use async_graphql::{Context, Error, Object, Result};
use sea_orm::{
    ActiveModelTrait, ActiveValue, ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter,
};

use crate::{
    entities::{metadata, prelude::Metadata},
    graphql::{IdObject, Identifier},
    media::{
        resolver::{MediaDetails, MediaSearchResults, MediaService, SearchInput},
        MediaSpecifics,
    },
    migrator::{MetadataLot, MetadataSource},
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
        let podcast = Metadata::find_by_id(podcast_id)
            .one(&self.db)
            .await
            .unwrap()
            .unwrap();
        match podcast.specifics.clone() {
            MediaSpecifics::Podcast(mut specifics) => {
                if specifics.total_episodes == specifics.episodes.len() as i32 {
                    return Ok(false);
                }
                let last_episode = specifics.episodes.last().unwrap();
                let next_pub_date = last_episode.publish_date;
                let episode_number = last_episode.number;
                let details = match podcast.source {
                    MetadataSource::Listennotes => {
                        self.listennotes_service
                            .details_with_paginated_episodes(
                                &podcast.identifier,
                                Some(next_pub_date),
                                Some(episode_number),
                            )
                            .await?
                    }
                    MetadataSource::Custom => {
                        return Err(Error::new(
                            "Can not fetch next episodes for custom source".to_owned(),
                        ));
                    }
                    _ => unreachable!(),
                };
                match details.specifics {
                    MediaSpecifics::Podcast(ed) => {
                        let mut meta: metadata::ActiveModel = podcast.into();
                        let details_small = meta.specifics.unwrap();
                        specifics.episodes.extend(ed.episodes.into_iter());
                        meta.specifics = ActiveValue::Set(details_small);
                        meta.save(&self.db).await.unwrap();
                    }
                    _ => unreachable!(),
                }
            }
            _ => unreachable!(),
        }
        Ok(true)
    }

    pub async fn details_from_provider(&self, metadata_id: i32) -> Result<MediaDetails> {
        let metadata = Metadata::find_by_id(metadata_id)
            .one(&self.db)
            .await
            .unwrap()
            .unwrap();
        let details = match metadata.source {
            MetadataSource::Listennotes => {
                self.listennotes_service
                    .details(&metadata.identifier)
                    .await?
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

    pub async fn save_to_db(&self, details: MediaDetails) -> Result<IdObject> {
        let metadata_id = self
            .media_service
            .commit_media(
                details.identifier.clone(),
                MetadataLot::Podcast,
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
        Ok(IdObject {
            id: metadata_id.into(),
        })
    }
}
