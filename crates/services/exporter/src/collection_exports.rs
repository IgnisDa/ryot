use std::{fs::File as StdFile, sync::Arc};

use async_graphql::Result;
use common_utils::ryot_log;
use dependent_utils::user_collections_list;
use struson::writer::{JsonStreamWriter, JsonWriter};
use supporting_service::SupportingService;

pub struct CollectionExports {
    pub service: Arc<SupportingService>,
}

impl CollectionExports {
    pub fn new(service: Arc<SupportingService>) -> Self {
        Self { service }
    }

    pub async fn export_collections(
        &self,
        user_id: &String,
        writer: &mut JsonStreamWriter<StdFile>,
    ) -> Result<()> {
        ryot_log!(
            debug,
            "Getting user collections list for user_id = {}",
            user_id
        );
        let collections_resp = user_collections_list(user_id, &self.service).await?;
        let collections = collections_resp.response;

        ryot_log!(debug, "Exporting {} collections", collections.len());
        for collection in collections {
            writer.serialize_value(&collection).unwrap();
        }
        Ok(())
    }
}
