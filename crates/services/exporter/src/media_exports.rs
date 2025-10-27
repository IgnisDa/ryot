use std::{fs::File as StdFile, sync::Arc};

use anyhow::Result;
use common_models::SearchInput;
use common_utils::ryot_log;
use database_models::{prelude::Seen, seen};
use database_utils::{entity_in_collections_with_details, item_reviews};
use dependent_details_utils::{metadata_details, metadata_group_details, person_details};
use dependent_entity_list_utils::{
    user_metadata_groups_list, user_metadata_list, user_people_list,
};
use dependent_models::{
    ImportOrExportMetadataGroupItem, ImportOrExportMetadataItem, ImportOrExportPersonItem,
    UserMetadataGroupsListInput, UserMetadataListInput, UserPeopleListInput,
};
use enum_models::EntityLot;
use media_models::ImportOrExportMetadataItemSeen;
use sea_orm::{ColumnTrait, EntityTrait, QueryFilter, QueryOrder};
use struson::writer::{JsonStreamWriter, JsonWriter};
use supporting_service::SupportingService;

use crate::export_utilities::get_review_export_item;

pub async fn export_media(
    ss: &Arc<SupportingService>,
    user_id: &String,
    writer: &mut JsonStreamWriter<StdFile>,
) -> Result<()> {
    let mut current_page = 1;
    loop {
        let related_metadata = user_metadata_list(
            user_id,
            UserMetadataListInput {
                search: Some(SearchInput {
                    take: Some(1000),
                    page: Some(current_page),
                    ..Default::default()
                }),
                ..Default::default()
            },
            ss,
        )
        .await?;
        ryot_log!(debug, "Exporting metadata list page: {current_page}");
        for rm in related_metadata.response.items.iter() {
            let m = metadata_details(ss, rm).await?.response;
            let seen_history = Seen::find()
                .filter(seen::Column::UserId.eq(user_id))
                .filter(seen::Column::MetadataId.eq(&m.id))
                .order_by_desc(seen::Column::LastUpdatedOn)
                .all(&ss.db)
                .await?;
            let seen_history = seen_history
                .into_iter()
                .map(|s| {
                    let (show_season_number, show_episode_number) = match s.show_extra_information {
                        Some(d) => (Some(d.season), Some(d.episode)),
                        None => (None, None),
                    };
                    let podcast_episode_number = s.podcast_extra_information.map(|d| d.episode);
                    let anime_episode_number = s.anime_extra_information.and_then(|d| d.episode);
                    let manga_chapter_number =
                        s.manga_extra_information.clone().and_then(|d| d.chapter);
                    let manga_volume_number = s.manga_extra_information.and_then(|d| d.volume);
                    ImportOrExportMetadataItemSeen {
                        state: s.state,
                        show_season_number,
                        show_episode_number,
                        manga_volume_number,
                        anime_episode_number,
                        manga_chapter_number,
                        podcast_episode_number,
                        ended_on: s.finished_on,
                        started_on: s.started_on,
                        progress: Some(s.progress),
                        manual_time_spent: s.manual_time_spent,
                        providers_consumed_on: Some(s.providers_consumed_on),
                    }
                })
                .collect();
            let reviews = item_reviews(user_id, &m.id, EntityLot::Metadata, false, ss)
                .await?
                .into_iter()
                .map(get_review_export_item)
                .collect();
            let collections =
                entity_in_collections_with_details(user_id, &m.id, EntityLot::Metadata, ss)
                    .await?
                    .into_iter()
                    .map(|c| c.details)
                    .collect();
            let exp = ImportOrExportMetadataItem {
                reviews,
                lot: m.lot,
                collections,
                seen_history,
                source: m.source,
                source_id: m.title,
                identifier: m.identifier.clone(),
            };
            writer.serialize_value(&exp)?;
        }
        if let Some(next_page) = related_metadata.response.details.next_page {
            current_page = next_page;
        } else {
            break;
        }
    }
    Ok(())
}

pub async fn export_media_group(
    ss: &Arc<SupportingService>,
    user_id: &String,
    writer: &mut JsonStreamWriter<StdFile>,
) -> Result<()> {
    let mut current_page = 1;
    loop {
        let related_metadata = user_metadata_groups_list(
            user_id,
            ss,
            UserMetadataGroupsListInput {
                search: Some(SearchInput {
                    take: Some(1000),
                    page: Some(current_page),
                    ..Default::default()
                }),
                ..Default::default()
            },
        )
        .await?;
        ryot_log!(debug, "Exporting metadata groups list page: {current_page}");
        for rm in related_metadata.response.items.iter() {
            let m = metadata_group_details(ss, rm).await?.response.details;
            let reviews = item_reviews(user_id, &m.id, EntityLot::MetadataGroup, false, ss)
                .await?
                .into_iter()
                .map(get_review_export_item)
                .collect();
            let collections =
                entity_in_collections_with_details(user_id, &m.id, EntityLot::MetadataGroup, ss)
                    .await?
                    .into_iter()
                    .map(|c| c.details)
                    .collect();
            let exp = ImportOrExportMetadataGroupItem {
                reviews,
                lot: m.lot,
                collections,
                title: m.title,
                source: m.source,
                identifier: m.identifier.clone(),
            };
            writer.serialize_value(&exp)?;
        }
        if let Some(next_page) = related_metadata.response.details.next_page {
            current_page = next_page;
        } else {
            break;
        }
    }
    Ok(())
}

pub async fn export_people(
    ss: &Arc<SupportingService>,
    user_id: &String,
    writer: &mut JsonStreamWriter<StdFile>,
) -> Result<()> {
    let mut current_page = 1;
    loop {
        let related_people = user_people_list(
            user_id,
            UserPeopleListInput {
                search: Some(SearchInput {
                    take: Some(1000),
                    page: Some(current_page),
                    ..Default::default()
                }),
                ..Default::default()
            },
            ss,
        )
        .await?;
        ryot_log!(debug, "Exporting people list page: {current_page}");
        for rm in related_people.response.items.iter() {
            let p = person_details(rm, ss).await?.response.details;
            let reviews = item_reviews(user_id, &p.id, EntityLot::Person, false, ss)
                .await?
                .into_iter()
                .map(get_review_export_item)
                .collect();
            let collections =
                entity_in_collections_with_details(user_id, &p.id, EntityLot::Person, ss)
                    .await?
                    .into_iter()
                    .map(|c| c.details)
                    .collect();
            let exp = ImportOrExportPersonItem {
                reviews,
                collections,
                name: p.name,
                source: p.source,
                identifier: p.identifier,
                source_specifics: p.source_specifics,
            };
            writer.serialize_value(&exp)?;
        }
        if let Some(next_page) = related_people.response.details.next_page {
            current_page = next_page;
        } else {
            break;
        }
    }
    Ok(())
}
