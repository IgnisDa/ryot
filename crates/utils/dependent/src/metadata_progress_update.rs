use std::sync::Arc;

use async_graphql::{Error, Result};
use database_models::{metadata::Model, prelude::Metadata, seen};
use enum_models::{EntityLot, MediaLot, SeenState};
use media_models::{
    MetadataProgressUpdateChange, MetadataProgressUpdateChangeCreateNewInput,
    MetadataProgressUpdateCommonInput, MetadataProgressUpdateInput, SeenAnimeExtraInformation,
    SeenMangaExtraInformation, SeenPodcastExtraInformation, SeenShowExtraInformation,
};
use rust_decimal_macros::dec;
use sea_orm::{ActiveModelTrait, ActiveValue, EntityTrait};
use supporting_service::SupportingService;

use crate::mark_entity_as_recently_consumed;

fn extra_information_from_metadata(
    meta: &Model,
    input: &MetadataProgressUpdateCommonInput,
) -> Result<(
    Option<SeenShowExtraInformation>,
    Option<SeenAnimeExtraInformation>,
    Option<SeenMangaExtraInformation>,
    Option<SeenPodcastExtraInformation>,
)> {
    let show_ei = if matches!(meta.lot, MediaLot::Show) {
        let season = input
            .show_season_number
            .ok_or_else(|| Error::new("Season number is required for show progress update"))?;
        let episode = input
            .show_episode_number
            .ok_or_else(|| Error::new("Episode number is required for show progress update"))?;
        Some(SeenShowExtraInformation { season, episode })
    } else {
        None
    };
    let podcast_ei = if matches!(meta.lot, MediaLot::Podcast) {
        let episode = input
            .podcast_episode_number
            .ok_or_else(|| Error::new("Episode number is required for podcast progress update"))?;
        Some(SeenPodcastExtraInformation { episode })
    } else {
        None
    };
    let anime_ei = if matches!(meta.lot, MediaLot::Anime) {
        Some(SeenAnimeExtraInformation {
            episode: input.anime_episode_number,
        })
    } else {
        None
    };
    let manga_ei = if matches!(meta.lot, MediaLot::Manga) {
        Some(SeenMangaExtraInformation {
            chapter: input.manga_chapter_number,
            volume: input.manga_volume_number,
        })
    } else {
        None
    };
    Ok((show_ei, anime_ei, manga_ei, podcast_ei))
}

async fn create_new_without_dates(
    meta: &Model,
    user_id: &String,
    ss: &Arc<SupportingService>,
    input: MetadataProgressUpdateCommonInput,
) -> Result<()> {
    let (show_ei, anime_ei, manga_ei, podcast_ei) = extra_information_from_metadata(meta, &input)?;
    let seen_insert = seen::ActiveModel {
        progress: ActiveValue::Set(dec!(100)),
        user_id: ActiveValue::Set(user_id.to_owned()),
        state: ActiveValue::Set(SeenState::Completed),
        metadata_id: ActiveValue::Set(meta.id.clone()),
        show_extra_information: ActiveValue::Set(show_ei),
        anime_extra_information: ActiveValue::Set(anime_ei),
        manga_extra_information: ActiveValue::Set(manga_ei),
        podcast_extra_information: ActiveValue::Set(podcast_ei),
        provider_watched_on: ActiveValue::Set(input.provider_watched_on),
        ..Default::default()
    };
    seen_insert.insert(&ss.db).await?;
    Ok(())
}

pub async fn metadata_progress_update(
    user_id: &String,
    ss: &Arc<SupportingService>,
    input: MetadataProgressUpdateInput,
) -> Result<()> {
    let meta = Metadata::find_by_id(&input.metadata_id)
        .one(&ss.db)
        .await?
        .ok_or_else(|| Error::new("Metadata not found"))?;
    match input.change {
        MetadataProgressUpdateChange::CreateNew(create_new_input) => match create_new_input {
            MetadataProgressUpdateChangeCreateNewInput::WithoutDates(inner_input) => {
                create_new_without_dates(&meta, user_id, ss, inner_input).await?;
            }
            _ => todo!(),
        },
        _ => todo!(),
    }
    mark_entity_as_recently_consumed(user_id, &input.metadata_id, EntityLot::Metadata, ss).await?;
    Ok(())
}
