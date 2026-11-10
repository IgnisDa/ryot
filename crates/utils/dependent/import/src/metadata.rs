use std::cmp::Ordering;

use media_models::ImportOrExportMetadataItemSeen;
use user_models::UserPreferences;

use super::*;

pub(super) async fn process_metadata(
    is_import: bool,
    user_id: &String,
    ss: &Arc<SupportingService>,
    metadata: ImportOrExportMetadataItem,
    preferences: &UserPreferences,
    failed: &mut Vec<ImportFailedItem>,
) -> usize {
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
        Ok((metadata, success)) => (metadata.id, success),
        Err(e) => {
            failed.push(ImportFailedItem {
                lot: Some(metadata.lot),
                error: Some(e.to_string()),
                step: ImportFailStep::DatabaseCommit,
                identifier: metadata.source_id.to_string(),
            });
            return 0;
        }
    };
    if !was_updated_successfully {
        failed.push(ImportFailedItem {
            lot: Some(metadata.lot),
            identifier: db_metadata_id.clone(),
            step: ImportFailStep::MediaDetailsFromProvider,
            error: Some("Progress update *might* be wrong".to_owned()),
        });
    }

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

    let successful_seen_entries = commit_seen_history(
        sorted_seen_history,
        metadata.lot,
        &metadata.source_id,
        failed,
        |seen| commit_import_seen_item(is_import, user_id, &db_metadata_id, ss, seen),
    )
    .await;
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
    ryot_log!(
        debug,
        "Imported {} history entries for {}",
        successful_seen_entries,
        db_metadata_id
    );
    successful_seen_entries
}

async fn commit_seen_history<F: Future<Output = Result<()>>>(
    history: Vec<ImportOrExportMetadataItemSeen>,
    lot: MediaLot,
    identifier: &str,
    failed: &mut Vec<ImportFailedItem>,
    commit: impl Fn(ImportOrExportMetadataItemSeen) -> F,
) -> usize {
    let mut successful = 0;
    for seen in history {
        match commit(seen).await {
            Ok(()) => successful += 1,
            Err(error) => failed.push(ImportFailedItem {
                lot: Some(lot),
                error: Some(error.to_string()),
                identifier: identifier.to_owned(),
                step: ImportFailStep::DatabaseCommit,
            }),
        }
    }
    successful
}

#[cfg(test)]
mod tests {
    use super::*;

    fn chapters() -> Vec<ImportOrExportMetadataItemSeen> {
        (1..=3)
            .map(|chapter| ImportOrExportMetadataItemSeen {
                manga_chapter_number: Some(Decimal::from(chapter)),
                ..Default::default()
            })
            .collect()
    }

    #[tokio::test]
    async fn counts_successful_chapters_even_when_another_chapter_fails() {
        let mut failures = vec![];
        let successful = commit_seen_history(
            chapters(),
            MediaLot::Manga,
            "manga",
            &mut failures,
            |seen| async move {
                if seen.manga_chapter_number == Some(dec!(2)) {
                    anyhow::bail!("Chapter could not be saved");
                }
                Ok(())
            },
        )
        .await;
        assert_eq!(successful, 2);
        assert_eq!(failures.len(), 1);
        assert_eq!(failures[0].identifier, "manga");
        assert_eq!(
            failures[0].error.as_deref(),
            Some("Chapter could not be saved")
        );
    }

    #[tokio::test]
    async fn fully_failed_and_empty_history_do_not_report_success() {
        let mut failures = vec![];
        for history in [chapters(), vec![]] {
            let successful = commit_seen_history(
                history,
                MediaLot::Manga,
                "manga",
                &mut failures,
                |_| async { anyhow::bail!("Chapter could not be saved") },
            )
            .await;
            assert_eq!(successful, 0);
        }
        assert_eq!(failures.len(), 3);
    }
}
