use std::sync::Arc;

use anyhow::{Result, bail};
use common_models::{ChangeCollectionToEntitiesInput, DefaultCollection, EntityToCollectionInput};
use database_models::{
    metadata, metadata_to_genre,
    prelude::{Metadata, MetadataToGenre},
};
use dependent_utils::{add_entities_to_collection, change_metadata_associations};
use enum_models::{EntityLot, MediaLot, MediaSource};
use itertools::Itertools;
use media_models::{CreateCustomMetadataInput, MetadataFreeCreator, UpdateCustomMetadataInput};
use nanoid::nanoid;
use sea_orm::{ActiveModelTrait, ActiveValue, ColumnTrait, EntityTrait, QueryFilter};
use supporting_service::SupportingService;

pub async fn create_custom_metadata(
    ss: &Arc<SupportingService>,
    user_id: String,
    input: CreateCustomMetadataInput,
) -> Result<metadata::Model> {
    let identifier = nanoid!(10);
    let metadata = get_data_for_custom_metadata(input.clone(), identifier, &user_id);
    let metadata = metadata.insert(&ss.db).await?;
    change_metadata_associations(
        &metadata.id,
        input.genres.unwrap_or_default(),
        vec![],
        vec![],
        vec![],
        ss,
    )
    .await?;
    add_entities_to_collection(
        &user_id,
        ChangeCollectionToEntitiesInput {
            entities: vec![EntityToCollectionInput {
                entity_id: metadata.id.clone(),
                entity_lot: EntityLot::Metadata,
                information: None,
            }],
            creator_user_id: user_id.to_owned(),
            collection_name: DefaultCollection::Custom.to_string(),
        },
        ss,
    )
    .await?;
    Ok(metadata)
}

pub async fn update_custom_metadata(
    ss: &Arc<SupportingService>,
    user_id: &str,
    input: UpdateCustomMetadataInput,
) -> Result<bool> {
    let metadata = Metadata::find_by_id(&input.existing_metadata_id)
        .one(&ss.db)
        .await?
        .unwrap();
    if metadata.source != MediaSource::Custom {
        bail!("This metadata is not custom and cannot be updated",);
    }
    if metadata.created_by_user_id != Some(user_id.to_owned()) {
        bail!("You are not authorized to update this metadata");
    }
    MetadataToGenre::delete_many()
        .filter(metadata_to_genre::Column::MetadataId.eq(&input.existing_metadata_id))
        .exec(&ss.db)
        .await?;
    for image in metadata.assets.s3_images.clone() {
        file_storage_service::delete_object(ss, image).await;
    }
    for video in metadata.assets.s3_videos.clone() {
        file_storage_service::delete_object(ss, video).await;
    }
    let mut new_metadata =
        get_data_for_custom_metadata(input.update.clone(), metadata.identifier, user_id);
    new_metadata.id = ActiveValue::Unchanged(input.existing_metadata_id);
    let metadata = new_metadata.update(&ss.db).await?;
    change_metadata_associations(
        &metadata.id,
        input.update.genres.unwrap_or_default(),
        vec![],
        vec![],
        vec![],
        ss,
    )
    .await?;
    Ok(true)
}

pub fn get_data_for_custom_metadata(
    input: CreateCustomMetadataInput,
    identifier: String,
    user_id: &str,
) -> metadata::ActiveModel {
    let free_creators = input
        .creators
        .unwrap_or_default()
        .into_iter()
        .map(|c| MetadataFreeCreator {
            name: c,
            role: "Creator".to_string(),
            ..Default::default()
        })
        .collect_vec();
    let is_partial = match input.lot {
        MediaLot::Show => input.show_specifics.is_none(),
        MediaLot::Book => input.book_specifics.is_none(),
        MediaLot::Music => input.music_specifics.is_none(),
        MediaLot::Anime => input.anime_specifics.is_none(),
        MediaLot::Manga => input.manga_specifics.is_none(),
        MediaLot::Movie => input.movie_specifics.is_none(),
        MediaLot::Podcast => input.podcast_specifics.is_none(),
        MediaLot::AudioBook => input.audio_book_specifics.is_none(),
        MediaLot::VideoGame => input.video_game_specifics.is_none(),
        MediaLot::VisualNovel => input.visual_novel_specifics.is_none(),
    };
    metadata::ActiveModel {
        lot: ActiveValue::Set(input.lot),
        title: ActiveValue::Set(input.title),
        assets: ActiveValue::Set(input.assets),
        identifier: ActiveValue::Set(identifier),
        is_nsfw: ActiveValue::Set(input.is_nsfw),
        source: ActiveValue::Set(MediaSource::Custom),
        is_partial: ActiveValue::Set(Some(is_partial)),
        description: ActiveValue::Set(input.description),
        publish_year: ActiveValue::Set(input.publish_year),
        show_specifics: ActiveValue::Set(input.show_specifics),
        book_specifics: ActiveValue::Set(input.book_specifics),
        manga_specifics: ActiveValue::Set(input.manga_specifics),
        anime_specifics: ActiveValue::Set(input.anime_specifics),
        movie_specifics: ActiveValue::Set(input.movie_specifics),
        music_specifics: ActiveValue::Set(input.music_specifics),
        podcast_specifics: ActiveValue::Set(input.podcast_specifics),
        created_by_user_id: ActiveValue::Set(Some(user_id.to_owned())),
        audio_book_specifics: ActiveValue::Set(input.audio_book_specifics),
        video_game_specifics: ActiveValue::Set(input.video_game_specifics),
        visual_novel_specifics: ActiveValue::Set(input.visual_novel_specifics),
        free_creators: ActiveValue::Set(match free_creators.is_empty() {
            true => None,
            false => Some(free_creators),
        }),
        ..Default::default()
    }
}
