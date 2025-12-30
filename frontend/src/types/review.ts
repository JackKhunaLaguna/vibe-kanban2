/**
 * Types for the code review feature
 */

/** A code fragment that is part of a review comment */
export interface CodeFragment {
  file: string;
  start_line: number;
  end_line: number;
  message: string;
}

/** A review comment with associated code fragments */
export interface ReviewComment {
  comment: string;
  fragments: CodeFragment[];
}

/** A suggested fix for a review issue */
export interface Fix {
  id: string;
  file: string;
  description: string;
  old_code: string;
  new_code: string;
  applied: boolean;
}

/** The result of a code review analysis */
export interface ReviewResult {
  summary: string;
  comments: ReviewComment[];
  fixes: Fix[];
}

/** Request body for analyzing tasks */
export interface ReviewAnalyzeRequest {
  task_ids: string[];
}

/** The complete review response from the API */
export interface CompleteReview {
  id: string;
  task_ids: string[];
  result: ReviewResult;
  created_at: string;
}

/** Result of applying a fix */
export interface FixResult {
  fix_id: string;
  success: boolean;
  error?: string;
}

/** Request to apply fixes */
export interface ApplyFixesRequest {
  fixes: Fix[];
}
