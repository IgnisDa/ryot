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
pub struct PodcastsMutation;

#[Object]
impl PodcastsMutation {
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
}
