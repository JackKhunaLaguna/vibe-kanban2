//! Code review API endpoint
//!
//! This module provides an endpoint for triggering code reviews on tasks.
//! Reviews may take 30-60 seconds, so the endpoint includes timeout handling
//! and comprehensive error responses.

use axum::{
    Json, Router,
    extract::State,
    response::Json as ResponseJson,
    routing::post,
};
use db::models::task::Task;
use deployment::Deployment;
use serde::{Deserialize, Serialize};
use ts_rs::TS;
use utils::response::ApiResponse;
use uuid::Uuid;

use crate::{DeploymentImpl, error::ApiError};

/// Default timeout for code reviews in seconds
const DEFAULT_REVIEW_TIMEOUT_SECS: u64 = 120;

/// Request body for the code review endpoint
#[derive(Debug, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct AnalyzeReviewRequest {
    /// List of task IDs to include in the code review
    pub task_ids: Vec<Uuid>,
}

/// Individual file review finding
#[derive(Debug, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ReviewFinding {
    /// File path relative to repository root
    pub file_path: String,
    /// Line number where the finding applies (if applicable)
    pub line_number: Option<u32>,
    /// Severity level: "error", "warning", "info", "suggestion"
    pub severity: String,
    /// Category of the finding (e.g., "security", "performance", "style", "bug")
    pub category: String,
    /// Short description of the issue
    pub title: String,
    /// Detailed explanation of the finding
    pub description: String,
    /// Suggested fix or improvement (if applicable)
    pub suggestion: Option<String>,
}

/// Review summary for a single task
#[derive(Debug, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct TaskReview {
    /// The task ID that was reviewed
    pub task_id: Uuid,
    /// Task title for reference
    pub task_title: String,
    /// Overall status of the review: "passed", "failed", "warnings"
    pub status: String,
    /// List of findings from the review
    pub findings: Vec<ReviewFinding>,
    /// Summary statistics
    pub summary: ReviewSummary,
}

/// Summary statistics for a review
#[derive(Debug, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ReviewSummary {
    /// Total number of files reviewed
    pub files_reviewed: u32,
    /// Number of error-level findings
    pub error_count: u32,
    /// Number of warning-level findings
    pub warning_count: u32,
    /// Number of info/suggestion findings
    pub info_count: u32,
}

/// Complete review result containing all task reviews
#[derive(Debug, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct CompleteReview {
    /// Individual reviews for each task
    pub task_reviews: Vec<TaskReview>,
    /// Overall status across all tasks: "passed", "failed", "warnings"
    pub overall_status: String,
    /// Aggregate summary across all tasks
    pub aggregate_summary: ReviewSummary,
    /// Duration of the review in milliseconds
    pub duration_ms: u64,
    /// Timestamp when the review completed (ISO 8601)
    pub completed_at: String,
}

/// Response for the code review endpoint
#[derive(Debug, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct AnalyzeReviewResponse {
    /// Whether the review completed successfully
    pub success: bool,
    /// The complete review results (present when success is true)
    pub review: Option<CompleteReview>,
    /// Error message (present when success is false)
    pub error: Option<String>,
}

/// Conduct a code review for the specified tasks
///
/// This endpoint orchestrates a comprehensive code review across the given tasks.
/// Reviews may take 30-60 seconds depending on the scope.
///
/// # Request
/// POST /api/review/analyze
/// ```json
/// {
///   "taskIds": ["uuid-1", "uuid-2"]
/// }
/// ```
///
/// # Response
/// ```json
/// {
///   "success": true,
///   "data": {
///     "success": true,
///     "review": { ... },
///     "error": null
///   }
/// }
/// ```
pub async fn analyze_review(
    State(deployment): State<DeploymentImpl>,
    Json(payload): Json<AnalyzeReviewRequest>,
) -> Result<ResponseJson<ApiResponse<AnalyzeReviewResponse>>, ApiError> {
    // Validate request
    if payload.task_ids.is_empty() {
        tracing::warn!("Code review requested with empty task_ids");
        return Err(ApiError::BadRequest(
            "taskIds is required and cannot be empty".to_string(),
        ));
    }

    tracing::info!(
        "Starting code review for {} tasks: {:?}",
        payload.task_ids.len(),
        payload.task_ids
    );

    let start_time = std::time::Instant::now();
    let pool = &deployment.db().pool;

    // Validate all task IDs exist
    let mut validated_tasks: Vec<Task> = Vec::new();
    for task_id in &payload.task_ids {
        match Task::find_by_id(pool, *task_id).await? {
            Some(task) => validated_tasks.push(task),
            None => {
                tracing::warn!("Task not found: {}", task_id);
                return Err(ApiError::BadRequest(format!(
                    "Task not found: {}",
                    task_id
                )));
            }
        }
    }

    // Conduct the review with timeout handling
    let review_result = tokio::time::timeout(
        std::time::Duration::from_secs(DEFAULT_REVIEW_TIMEOUT_SECS),
        conduct_review(&deployment, &validated_tasks),
    )
    .await;

    match review_result {
        Ok(Ok(review)) => {
            let duration_ms = start_time.elapsed().as_millis() as u64;
            tracing::info!(
                "Code review completed successfully in {}ms for {} tasks",
                duration_ms,
                payload.task_ids.len()
            );

            let response = AnalyzeReviewResponse {
                success: true,
                review: Some(CompleteReview {
                    duration_ms,
                    completed_at: chrono::Utc::now().to_rfc3339(),
                    ..review
                }),
                error: None,
            };

            Ok(ResponseJson(ApiResponse::success(response)))
        }
        Ok(Err(e)) => {
            tracing::error!("Code review failed: {}", e);
            let response = AnalyzeReviewResponse {
                success: false,
                review: None,
                error: Some(e.to_string()),
            };
            Ok(ResponseJson(ApiResponse::success(response)))
        }
        Err(_) => {
            tracing::error!(
                "Code review timed out after {}s for tasks: {:?}",
                DEFAULT_REVIEW_TIMEOUT_SECS,
                payload.task_ids
            );
            Err(ApiError::ReviewTimeout {
                task_count: payload.task_ids.len(),
                timeout_secs: DEFAULT_REVIEW_TIMEOUT_SECS,
            })
        }
    }
}

/// Internal function to conduct the actual code review
async fn conduct_review(
    deployment: &DeploymentImpl,
    tasks: &[Task],
) -> Result<CompleteReview, ReviewError> {
    let client = super::anthropic::AnthropicClient::from_env()
        .map_err(|e| ReviewError::ServiceUnavailable(e.to_string()))?;

    let mut task_reviews = Vec::new();
    let mut total_errors = 0u32;
    let mut total_warnings = 0u32;
    let mut total_info = 0u32;
    let mut total_files = 0u32;

    for task in tasks {
        let task_review = review_task(&client, deployment, task).await?;
        total_errors += task_review.summary.error_count;
        total_warnings += task_review.summary.warning_count;
        total_info += task_review.summary.info_count;
        total_files += task_review.summary.files_reviewed;
        task_reviews.push(task_review);
    }

    // Determine overall status
    let overall_status = if total_errors > 0 {
        "failed".to_string()
    } else if total_warnings > 0 {
        "warnings".to_string()
    } else {
        "passed".to_string()
    };

    Ok(CompleteReview {
        task_reviews,
        overall_status,
        aggregate_summary: ReviewSummary {
            files_reviewed: total_files,
            error_count: total_errors,
            warning_count: total_warnings,
            info_count: total_info,
        },
        duration_ms: 0, // Will be set by caller
        completed_at: String::new(), // Will be set by caller
    })
}

/// Review a single task using the Anthropic API
async fn review_task(
    client: &super::anthropic::AnthropicClient,
    _deployment: &DeploymentImpl,
    task: &Task,
) -> Result<TaskReview, ReviewError> {
    // Build context for the review from task description
    let task_context = format!(
        "Task: {}\nDescription: {}",
        task.title,
        task.description.as_deref().unwrap_or("No description provided")
    );

    // Use the Anthropic client to conduct the review
    let review_result = client.conduct_code_review(&task_context).await
        .map_err(|e| ReviewError::ApiError(e.to_string()))?;

    Ok(TaskReview {
        task_id: task.id,
        task_title: task.title.clone(),
        status: review_result.status,
        findings: review_result.findings,
        summary: review_result.summary,
    })
}

/// Errors that can occur during code review
#[derive(Debug, thiserror::Error)]
pub enum ReviewError {
    #[error("Review service unavailable: {0}")]
    ServiceUnavailable(String),
    #[error("API error during review: {0}")]
    ApiError(String),
    #[error("Failed to fetch task data: {0}")]
    TaskFetchError(String),
}

/// Router for review endpoints
pub fn router(_deployment: &DeploymentImpl) -> Router<DeploymentImpl> {
    Router::new().nest(
        "/review",
        Router::new().route("/analyze", post(analyze_review)),
    )
}
