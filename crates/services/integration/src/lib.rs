use std::sync::Arc;

use supporting_service::SupportingService;

mod data_operations;
mod event_handlers;
mod integration_management;
mod push;
mod sink;
mod utils;
mod webhook_handler;
mod yank;

pub struct IntegrationService(pub Arc<SupportingService>);
