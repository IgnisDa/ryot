use std::sync::atomic::{AtomicU64, Ordering as AtomicOrdering};

use user_models::UserPreferences;
use uuid::Uuid;

use super::*;

static SEEN_PROCESSING_COUNTER: AtomicU64 = AtomicU64::new(0);

pub(super) async fn process_metadata(
    is_import: bool,
    user_id: &String,
    ss: &Arc<SupportingService>,
    metadata: ImportOrExportMetadataItem,
    preferences: &UserPreferences,
    failed: &mut Vec<ImportFailedItem>,
) {
    let execution_id = Uuid::new_v4();
    let metadata_ptr = format!("{:p}", &metadata as *const _);
    ryot_log!(
        debug,
        "[1611 TRACE {}] Starting metadata processing, ptr={}",
        execution_id,
        metadata_ptr
    );
    let (db_metadata_id, was_updated_successfully) = match commit_metadata(
        PartialMetadataWithoutId {
            lot: metadata.lot,
            source: metadata.source,
            title: metadata.source_id.clone(),
            identifier: metadata.identifier.clone(),
            ..Default::default()
        },
        ss,
        Some(true),
    )
    .await
    {
        Ok((metadata, success)) => {
            ryot_log!(
                debug,
                "[1611 TRACE {}] commit_metadata succeeded: id={}, updated={}",
                execution_id,
                metadata.id,
                success
            );
            (metadata.id, success)
        }
        Err(e) => {
            ryot_log!(
                debug,
                "[1611 TRACE {}] commit_metadata failed for source_id={}, lot={}: {}",
                execution_id,
                metadata.source_id,
                metadata.lot,
                e
            );
            failed.push(ImportFailedItem {
                lot: Some(metadata.lot),
                error: Some(e.to_string()),
                step: ImportFailStep::DatabaseCommit,
                identifier: metadata.source_id.to_string(),
            });
            return;
        }
    };
    if !was_updated_successfully {
        ryot_log!(
            debug,
            "[1611 TRACE {}] commit_metadata marked as not updated for {}",
            execution_id,
            db_metadata_id
        );
        failed.push(ImportFailedItem {
            lot: Some(metadata.lot),
            identifier: db_metadata_id.clone(),
            step: ImportFailStep::MediaDetailsFromProvider,
            error: Some("Progress update *might* be wrong".to_owned()),
        });
    }
    let counter_value = SEEN_PROCESSING_COUNTER.fetch_add(1, AtomicOrdering::SeqCst);
    ryot_log!(
        debug,
        "[1611 TRACE {}] [1611 COUNTER {}] Before seen_history processing, metadata.seen_history.len={}, ptr={}",
        execution_id,
        counter_value,
        metadata.seen_history.len(),
        metadata_ptr
    );
    ryot_log!(
        debug,
        "[1611 TRACE {}] Processing {} seen_history items for metadata: {}",
        execution_id,
        metadata.seen_history.len(),
        db_metadata_id
    );
    let seen_history_len = metadata.seen_history.len();
    ryot_log!(
        debug,
        "[1611 TRACE {}] After seen_history log, about to enter loop with {} items",
        execution_id,
        seen_history_len
    );

    let mut sorted_seen_history = metadata.seen_history;
    sorted_seen_history.sort_by(|a, b| {
        let end_date_cmp = a.ended_on.cmp(&b.ended_on);
        if end_date_cmp != Ordering::Equal {
            return end_date_cmp;
        }

        if let (Some(a_season), Some(a_episode), Some(b_season), Some(b_episode)) = (
            a.show_season_number,
            a.show_episode_number,
            b.show_season_number,
            b.show_episode_number,
        ) {
            a_season.cmp(&b_season).then(a_episode.cmp(&b_episode))
        } else if let (Some(a_episode), Some(b_episode)) =
            (a.anime_episode_number, b.anime_episode_number)
        {
            a_episode.cmp(&b_episode)
        } else if let (Some(a_volume), Some(a_chapter), Some(b_volume), Some(b_chapter)) = (
            a.manga_volume_number,
            a.manga_chapter_number,
            b.manga_volume_number,
            b.manga_chapter_number,
        ) {
            a_volume.cmp(&b_volume).then(a_chapter.cmp(&b_chapter))
        } else if let (Some(a_episode), Some(b_episode)) =
            (a.podcast_episode_number, b.podcast_episode_number)
        {
            a_episode.cmp(&b_episode)
        } else {
            Ordering::Equal
        }
    });

    for (seen_idx, seen) in sorted_seen_history.into_iter().enumerate() {
        ryot_log!(
            debug,
            "[1611 TRACE {}] Processing seen item {}/{} for metadata: {}",
            execution_id,
            seen_idx + 1,
            seen_history_len,
            db_metadata_id
        );
        if let Err(e) = commit_import_seen_item(is_import, user_id, &db_metadata_id, ss, seen).await
        {
            ryot_log!(
                debug,
                "[1611 TRACE {}] Failed to commit seen item {}/{} for {}: {}",
                execution_id,
                seen_idx + 1,
                seen_history_len,
                db_metadata_id,
                e
            );
            failed.push(ImportFailedItem {
                lot: Some(metadata.lot),
                error: Some(e.to_string()),
                step: ImportFailStep::DatabaseCommit,
                identifier: metadata.source_id.to_owned(),
            });
        };
    }
    ryot_log!(
        debug,
        "[1611 TRACE {}] Completed seen_history processing for metadata: {}",
        execution_id,
        db_metadata_id
    );
    for review in metadata.reviews.iter() {
        if let Some(input) = convert_review_into_input(
            review,
            preferences,
            db_metadata_id.clone(),
            EntityLot::Metadata,
        ) && let Err(e) = create_or_update_review(user_id, input, ss).await
        {
            failed.push(ImportFailedItem {
                lot: Some(metadata.lot),
                error: Some(e.to_string()),
                step: ImportFailStep::DatabaseCommit,
                identifier: metadata.source_id.to_owned(),
            });
        };
    }
    for col in metadata.collections.into_iter() {
        create_collection_and_add_entity_to_it(
            user_id,
            db_metadata_id.clone(),
            EntityLot::Metadata,
            col.collection_name,
            ss,
            col.information,
            failed,
        )
        .await;
    }
}
