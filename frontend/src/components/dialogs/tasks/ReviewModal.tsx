import { useState, useCallback } from 'react';
import { Check, AlertCircle, Loader2, FileCode, MessageSquare } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Loader } from '@/components/ui/loader';
import { cn } from '@/lib/utils';
import NiceModal, { useModal } from '@ebay/nice-modal-react';
import { defineModal } from '@/lib/modals';
import { reviewApi } from '@/lib/api';
import type { TaskWithAttemptStatus } from 'shared/types';
import type {
  CompleteReview,
  ReviewComment,
  Fix,
} from '@/types/review';

export interface ReviewModalProps {
  /** Tasks that are in review status */
  tasks: TaskWithAttemptStatus[];
  /** Project ID for context */
  projectId: string;
}

type ReviewState = 'idle' | 'analyzing' | 'complete' | 'error';

interface ReviewContentProps {
  tasks: TaskWithAttemptStatus[];
  review: CompleteReview | null;
  state: ReviewState;
  error: string | null;
  onStartReview: () => void;
  onApplyFix: (fix: Fix) => Promise<void>;
  appliedFixes: Set<string>;
  applyingFixes: Set<string>;
}

function ReviewContent({
  tasks,
  review,
  state,
  error,
  onStartReview,
  onApplyFix,
  appliedFixes,
  applyingFixes,
}: ReviewContentProps) {
  if (state === 'idle') {
    return (
      <div className="py-8 text-center space-y-4">
        <div className="text-muted-foreground">
          <FileCode className="h-12 w-12 mx-auto mb-4 opacity-50" />
          <p className="text-sm">
            {tasks.length === 1
              ? 'Ready to analyze 1 task in review'
              : `Ready to analyze ${tasks.length} tasks in review`}
          </p>
        </div>
        <ul className="text-left max-w-md mx-auto space-y-2">
          {tasks.map((task) => (
            <li
              key={task.id}
              className="text-sm p-2 rounded border bg-muted/30 truncate"
              title={task.title}
            >
              {task.title}
            </li>
          ))}
        </ul>
        <Button onClick={onStartReview} className="mt-4">
          Start AI Review
        </Button>
      </div>
    );
  }

  if (state === 'analyzing') {
    return (
      <div className="py-12 text-center space-y-4">
        <Loader size={32} />
        <p className="text-sm text-muted-foreground">
          Analyzing code changes...
        </p>
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div className="py-8 text-center space-y-4">
        <AlertCircle className="h-12 w-12 mx-auto text-destructive" />
        <p className="text-sm text-destructive">{error}</p>
        <Button variant="outline" onClick={onStartReview}>
          Retry
        </Button>
      </div>
    );
  }

  if (state === 'complete' && review) {
    return (
      <div className="space-y-6">
        {/* Summary */}
        <div className="p-4 border rounded-lg bg-muted/30">
          <h4 className="font-medium mb-2 flex items-center gap-2">
            <MessageSquare className="h-4 w-4" />
            Summary
          </h4>
          <p className="text-sm text-muted-foreground">{review.result.summary}</p>
        </div>

        {/* Comments */}
        {review.result.comments.length > 0 && (
          <div className="space-y-3">
            <h4 className="font-medium">Review Comments</h4>
            <div className="max-h-64 overflow-auto">
              <div className="space-y-3 pr-4">
                {review.result.comments.map((comment, idx) => (
                  <ReviewCommentCard key={idx} comment={comment} />
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Fixes */}
        {review.result.fixes.length > 0 && (
          <div className="space-y-3">
            <h4 className="font-medium">Suggested Fixes</h4>
            <div className="max-h-64 overflow-auto">
              <div className="space-y-3 pr-4">
                {review.result.fixes.map((fix) => (
                  <FixCard
                    key={fix.id}
                    fix={fix}
                    isApplied={appliedFixes.has(fix.id)}
                    isApplying={applyingFixes.has(fix.id)}
                    onApply={() => onApplyFix(fix)}
                  />
                ))}
              </div>
            </div>
          </div>
        )}

        {review.result.comments.length === 0 && review.result.fixes.length === 0 && (
          <div className="py-8 text-center text-muted-foreground">
            <Check className="h-12 w-12 mx-auto mb-4 text-success" />
            <p className="text-sm">No issues found. Code looks good!</p>
          </div>
        )}
      </div>
    );
  }

  return null;
}

function ReviewCommentCard({ comment }: { comment: ReviewComment }) {
  return (
    <div className="p-3 border rounded-lg bg-background">
      <p className="text-sm">{comment.comment}</p>
      {comment.fragments.length > 0 && (
        <div className="mt-2 space-y-1">
          {comment.fragments.map((fragment, idx) => (
            <div
              key={idx}
              className="text-xs text-muted-foreground font-mono bg-muted/50 px-2 py-1 rounded"
            >
              {fragment.file}:{fragment.start_line}
              {fragment.end_line !== fragment.start_line && `-${fragment.end_line}`}
              {fragment.message && (
                <span className="ml-2 italic">{fragment.message}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface FixCardProps {
  fix: Fix;
  isApplied: boolean;
  isApplying: boolean;
  onApply: () => void;
}

function FixCard({ fix, isApplied, isApplying, onApply }: FixCardProps) {
  return (
    <div
      className={cn(
        'p-3 border rounded-lg bg-background',
        isApplied && 'border-success/50 bg-success/5'
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{fix.file}</p>
          <p className="text-xs text-muted-foreground mt-1">{fix.description}</p>
        </div>
        <Button
          size="xs"
          variant={isApplied ? 'ghost' : 'outline'}
          onClick={onApply}
          disabled={isApplied || isApplying}
          className="shrink-0"
        >
          {isApplying ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : isApplied ? (
            <>
              <Check className="h-3 w-3 mr-1" />
              Applied
            </>
          ) : (
            'Apply'
          )}
        </Button>
      </div>
      {fix.old_code && fix.new_code && (
        <div className="mt-2 text-xs font-mono">
          <div className="bg-destructive/10 text-destructive px-2 py-1 rounded-t">
            - {fix.old_code.substring(0, 100)}
            {fix.old_code.length > 100 && '...'}
          </div>
          <div className="bg-success/10 text-success px-2 py-1 rounded-b">
            + {fix.new_code.substring(0, 100)}
            {fix.new_code.length > 100 && '...'}
          </div>
        </div>
      )}
    </div>
  );
}

const ReviewModalImpl = NiceModal.create<ReviewModalProps>(
  ({ tasks }) => {
    const modal = useModal();

    const [state, setState] = useState<ReviewState>('idle');
    const [review, setReview] = useState<CompleteReview | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [appliedFixes, setAppliedFixes] = useState<Set<string>>(new Set());
    const [applyingFixes, setApplyingFixes] = useState<Set<string>>(new Set());

    const handleStartReview = useCallback(async () => {
      setState('analyzing');
      setError(null);

      try {
        const taskIds = tasks.map((t) => t.id);
        const result = await reviewApi.analyzeTasks(taskIds);
        setReview(result);
        setState('complete');
      } catch (err) {
        console.error('Review analysis failed:', err);
        setError(
          err instanceof Error
            ? err.message
            : 'Failed to analyze tasks. Please try again.'
        );
        setState('error');
      }
    }, [tasks]);

    const handleApplyFix = useCallback(
      async (fix: Fix) => {
        setApplyingFixes((prev) => new Set(prev).add(fix.id));

        try {
          const results = await reviewApi.applyFixes([fix]);
          const result = results[0];

          if (result?.success) {
            setAppliedFixes((prev) => new Set(prev).add(fix.id));
          } else {
            console.error('Failed to apply fix:', result?.error);
          }
        } catch (err) {
          console.error('Failed to apply fix:', err);
        } finally {
          setApplyingFixes((prev) => {
            const next = new Set(prev);
            next.delete(fix.id);
            return next;
          });
        }
      },
      []
    );

    const handleOpenChange = (open: boolean) => {
      if (!open) {
        modal.hide();
      }
    };

    const handleClose = () => {
      modal.hide();
    };

    return (
      <Dialog open={modal.visible} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>AI Code Review</DialogTitle>
            <DialogDescription>
              Review code changes with AI-powered analysis
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-auto">
            <ReviewContent
              tasks={tasks}
              review={review}
              state={state}
              error={error}
              onStartReview={handleStartReview}
              onApplyFix={handleApplyFix}
              appliedFixes={appliedFixes}
              applyingFixes={applyingFixes}
            />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={handleClose}>
              {state === 'complete' ? 'Done' : 'Cancel'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }
);

export const ReviewModal = defineModal<ReviewModalProps, void>(ReviewModalImpl);
