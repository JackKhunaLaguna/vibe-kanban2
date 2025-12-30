import { useState, useCallback, useRef } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Alert, AlertDescription } from '@/components/ui/alert';
import NiceModal, { useModal } from '@ebay/nice-modal-react';
import {
  Loader2,
  Search,
  GitCompare,
  Shield,
  FileText,
  AlertTriangle,
  CheckCircle,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { defineModal, getErrorMessage } from '@/lib/modals';
import type { Task } from 'shared/types';
import { cn } from '@/lib/utils';

// Types for the review process
export interface Fix {
  id: string;
  taskId: string;
  filePath: string;
  description: string;
  diff?: string;
}

export interface ReviewIssue {
  id: string;
  taskId: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
  filePath?: string;
  line?: number;
  fix?: Fix;
}

export interface TaskReviewResult {
  taskId: string;
  taskTitle: string;
  status: 'passed' | 'failed' | 'warning';
  issues: ReviewIssue[];
  fixes: Fix[];
}

export interface CompleteReview {
  results: TaskReviewResult[];
  summary: {
    totalTasks: number;
    passed: number;
    failed: number;
    warnings: number;
    totalIssues: number;
    availableFixes: number;
  };
}

type ReviewState = 'confirmation' | 'progress' | 'results';

type ProgressStep =
  | 'analyzing-diffs'
  | 'detecting-conflicts'
  | 'quality-checks'
  | 'generating-report';

const PROGRESS_STEPS: { key: ProgressStep; label: string }[] = [
  { key: 'analyzing-diffs', label: 'Analyzing diffs' },
  { key: 'detecting-conflicts', label: 'Detecting conflicts' },
  { key: 'quality-checks', label: 'Running quality checks' },
  { key: 'generating-report', label: 'Generating report' },
];

export interface ReviewModalProps {
  isOpen: boolean;
  tasks: Task[];
  onClose: () => void;
  onStartReview: (taskIds: string[]) => Promise<CompleteReview>;
  onApplyFixes: (fixes: Fix[]) => Promise<void>;
}

export type ReviewModalResult = 'closed' | 'applied';

// ReviewResults sub-component
interface ReviewResultsProps {
  review: CompleteReview;
  onViewDiff: (issue: ReviewIssue) => void;
}

function ReviewResults({ review, onViewDiff }: ReviewResultsProps) {
  const [expandedTasks, setExpandedTasks] = useState<Set<string>>(new Set());

  const toggleTask = (taskId: string) => {
    setExpandedTasks((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) {
        next.delete(taskId);
      } else {
        next.add(taskId);
      }
      return next;
    });
  };

  const getStatusIcon = (status: TaskReviewResult['status']) => {
    switch (status) {
      case 'passed':
        return <CheckCircle className="h-5 w-5 text-green-500" />;
      case 'failed':
        return <AlertTriangle className="h-5 w-5 text-destructive" />;
      case 'warning':
        return <AlertTriangle className="h-5 w-5 text-yellow-500" />;
    }
  };

  const getSeverityColor = (severity: ReviewIssue['severity']) => {
    switch (severity) {
      case 'error':
        return 'text-destructive';
      case 'warning':
        return 'text-yellow-500';
      case 'info':
        return 'text-blue-500';
    }
  };

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="grid grid-cols-4 gap-2 text-sm">
        <div className="bg-secondary rounded p-2 text-center">
          <div className="font-semibold">{review.summary.totalTasks}</div>
          <div className="text-muted-foreground text-xs">Tasks</div>
        </div>
        <div className="bg-green-500/10 rounded p-2 text-center">
          <div className="font-semibold text-green-500">
            {review.summary.passed}
          </div>
          <div className="text-muted-foreground text-xs">Passed</div>
        </div>
        <div className="bg-destructive/10 rounded p-2 text-center">
          <div className="font-semibold text-destructive">
            {review.summary.failed}
          </div>
          <div className="text-muted-foreground text-xs">Failed</div>
        </div>
        <div className="bg-yellow-500/10 rounded p-2 text-center">
          <div className="font-semibold text-yellow-500">
            {review.summary.warnings}
          </div>
          <div className="text-muted-foreground text-xs">Warnings</div>
        </div>
      </div>

      {/* Task Results */}
      <div className="space-y-2 max-h-64 overflow-y-auto">
        {review.results.map((result) => {
          const isExpanded = expandedTasks.has(result.taskId);
          const hasIssues = result.issues.length > 0;

          return (
            <div
              key={result.taskId}
              className="border border-border rounded-md overflow-hidden"
            >
              <button
                type="button"
                className="w-full flex items-center gap-3 p-3 hover:bg-secondary/50 transition-colors text-left"
                onClick={() => hasIssues && toggleTask(result.taskId)}
                disabled={!hasIssues}
              >
                {hasIssues ? (
                  isExpanded ? (
                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  )
                ) : (
                  <div className="w-4" />
                )}
                {getStatusIcon(result.status)}
                <span className="flex-1 truncate">{result.taskTitle}</span>
                {hasIssues && (
                  <span className="text-xs text-muted-foreground">
                    {result.issues.length} issue
                    {result.issues.length !== 1 ? 's' : ''}
                  </span>
                )}
              </button>

              {isExpanded && hasIssues && (
                <div className="border-t border-border bg-secondary/30 p-2 space-y-2">
                  {result.issues.map((issue) => (
                    <div
                      key={issue.id}
                      className="flex items-start gap-2 text-sm"
                    >
                      <span className={cn('mt-0.5', getSeverityColor(issue.severity))}>
                        {issue.severity === 'error' ? '!' : issue.severity === 'warning' ? '?' : 'i'}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-foreground">{issue.message}</p>
                        {issue.filePath && (
                          <p className="text-xs text-muted-foreground truncate">
                            {issue.filePath}
                            {issue.line && `:${issue.line}`}
                          </p>
                        )}
                      </div>
                      {issue.fix && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-xs h-6 px-2"
                          onClick={() => onViewDiff(issue)}
                        >
                          View Diff
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {review.summary.availableFixes > 0 && (
        <p className="text-sm text-muted-foreground">
          {review.summary.availableFixes} automatic fix
          {review.summary.availableFixes !== 1 ? 'es' : ''} available
        </p>
      )}
    </div>
  );
}

const ReviewModalImpl = NiceModal.create<ReviewModalProps>((props) => {
  const modal = useModal();
  const { tasks, onStartReview, onApplyFixes } = props;
  const dialogRef = useRef<HTMLDivElement>(null);

  // Internal state
  const [state, setState] = useState<ReviewState>('confirmation');
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(
    () => new Set(tasks.map((t) => t.id))
  );
  const [progressStep, setProgressStep] = useState<ProgressStep>('analyzing-diffs');
  const [progressTaskIndex, setProgressTaskIndex] = useState(0);
  const [reviewResult, setReviewResult] = useState<CompleteReview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [applyingFixes, setApplyingFixes] = useState(false);

  const selectedTasks = tasks.filter((t) => selectedTaskIds.has(t.id));

  const handleClose = useCallback(() => {
    if (state === 'progress') {
      return; // Cannot close during review
    }
    modal.resolve('closed' as ReviewModalResult);
    modal.hide();
  }, [state, modal]);

  const toggleTask = useCallback((taskId: string) => {
    setSelectedTaskIds((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) {
        next.delete(taskId);
      } else {
        next.add(taskId);
      }
      return next;
    });
  }, []);

  const toggleAllTasks = useCallback(() => {
    if (selectedTaskIds.size === tasks.length) {
      setSelectedTaskIds(new Set());
    } else {
      setSelectedTaskIds(new Set(tasks.map((t) => t.id)));
    }
  }, [selectedTaskIds.size, tasks]);

  const startReview = useCallback(async () => {
    if (selectedTaskIds.size === 0) return;

    setState('progress');
    setError(null);
    setProgressStep('analyzing-diffs');
    setProgressTaskIndex(0);

    try {
      // Simulate progress steps
      const taskIds = Array.from(selectedTaskIds);
      const totalTasks = taskIds.length;

      // Progress simulation
      const simulateProgress = async () => {
        for (let i = 0; i < totalTasks; i++) {
          setProgressTaskIndex(i + 1);
          await new Promise((resolve) => setTimeout(resolve, 200));
        }
        setProgressStep('detecting-conflicts');
        await new Promise((resolve) => setTimeout(resolve, 500));
        setProgressStep('quality-checks');
        await new Promise((resolve) => setTimeout(resolve, 500));
        setProgressStep('generating-report');
      };

      // Run progress simulation alongside actual review
      const [result] = await Promise.all([
        onStartReview(taskIds),
        simulateProgress(),
      ]);

      setReviewResult(result);
      setState('results');
    } catch (err) {
      setError(getErrorMessage(err));
      setState('confirmation');
    }
  }, [selectedTaskIds, onStartReview]);

  const handleApplyFixes = useCallback(async () => {
    if (!reviewResult) return;

    const allFixes = reviewResult.results.flatMap((r) => r.fixes);
    if (allFixes.length === 0) return;

    setApplyingFixes(true);
    try {
      await onApplyFixes(allFixes);
      modal.resolve('applied' as ReviewModalResult);
      modal.hide();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setApplyingFixes(false);
    }
  }, [reviewResult, onApplyFixes, modal]);

  const handleViewDiff = useCallback((issue: ReviewIssue) => {
    // This could open a diff viewer modal or expand inline
    console.log('View diff for issue:', issue);
  }, []);

  const getProgressIcon = (step: ProgressStep) => {
    switch (step) {
      case 'analyzing-diffs':
        return <GitCompare className="h-4 w-4" />;
      case 'detecting-conflicts':
        return <Search className="h-4 w-4" />;
      case 'quality-checks':
        return <Shield className="h-4 w-4" />;
      case 'generating-report':
        return <FileText className="h-4 w-4" />;
    }
  };

  const currentStepIndex = PROGRESS_STEPS.findIndex(
    (s) => s.key === progressStep
  );

  // Render based on state
  const renderContent = () => {
    switch (state) {
      case 'confirmation':
        return (
          <>
            <DialogHeader>
              <DialogTitle>Review Tasks</DialogTitle>
              <DialogDescription>
                Select the tasks you want to review for conflicts and issues.
              </DialogDescription>
            </DialogHeader>

            <DialogContent>
              {/* Select all checkbox */}
              <div className="flex items-center gap-2 pb-2 border-b border-border">
                <Checkbox
                  id="select-all"
                  checked={selectedTaskIds.size === tasks.length}
                  onCheckedChange={toggleAllTasks}
                />
                <label
                  htmlFor="select-all"
                  className="text-sm font-medium cursor-pointer"
                >
                  Select all ({tasks.length} tasks)
                </label>
              </div>

              {/* Task list */}
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {tasks.map((task) => (
                  <div
                    key={task.id}
                    className="flex items-center gap-3 p-2 rounded hover:bg-secondary/50 transition-colors"
                  >
                    <Checkbox
                      id={`task-${task.id}`}
                      checked={selectedTaskIds.has(task.id)}
                      onCheckedChange={() => toggleTask(task.id)}
                    />
                    <label
                      htmlFor={`task-${task.id}`}
                      className="flex-1 text-sm cursor-pointer truncate"
                    >
                      {task.title}
                    </label>
                  </div>
                ))}
              </div>

              {error && (
                <Alert variant="destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
            </DialogContent>

            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={handleClose}>
                Cancel
              </Button>
              <Button
                onClick={startReview}
                disabled={selectedTaskIds.size === 0}
              >
                Start Review
              </Button>
            </DialogFooter>
          </>
        );

      case 'progress':
        return (
          <>
            <DialogHeader>
              <DialogTitle>Reviewing Tasks</DialogTitle>
              <DialogDescription>
                Analyzing {selectedTasks.length} task
                {selectedTasks.length !== 1 ? 's' : ''}...
              </DialogDescription>
            </DialogHeader>

            <DialogContent>
              <div className="flex flex-col items-center py-8 space-y-6">
                <Loader2 className="h-10 w-10 animate-spin text-primary" />

                <p className="text-sm text-muted-foreground">
                  Analyzing {progressTaskIndex} of {selectedTasks.length} tasks...
                </p>

                {/* Progress steps */}
                <div className="w-full space-y-2">
                  {PROGRESS_STEPS.map((step, index) => {
                    const isComplete = index < currentStepIndex;
                    const isCurrent = index === currentStepIndex;

                    return (
                      <div
                        key={step.key}
                        className={cn(
                          'flex items-center gap-3 p-2 rounded text-sm transition-colors',
                          isComplete && 'text-green-500',
                          isCurrent && 'bg-secondary text-foreground',
                          !isComplete && !isCurrent && 'text-muted-foreground'
                        )}
                      >
                        {isComplete ? (
                          <CheckCircle className="h-4 w-4" />
                        ) : isCurrent ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          getProgressIcon(step.key)
                        )}
                        <span>{step.label}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </DialogContent>
          </>
        );

      case 'results':
        if (!reviewResult) return null;

        const totalFixes = reviewResult.results.reduce(
          (acc, r) => acc + r.fixes.length,
          0
        );

        return (
          <>
            <DialogHeader>
              <DialogTitle>Review Results</DialogTitle>
              <DialogDescription>
                Review completed for {reviewResult.summary.totalTasks} task
                {reviewResult.summary.totalTasks !== 1 ? 's' : ''}.
              </DialogDescription>
            </DialogHeader>

            <DialogContent>
              <ReviewResults review={reviewResult} onViewDiff={handleViewDiff} />

              {error && (
                <Alert variant="destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
            </DialogContent>

            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={handleClose}>
                Close
              </Button>
              {totalFixes > 0 && (
                <Button onClick={handleApplyFixes} disabled={applyingFixes}>
                  {applyingFixes ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Applying...
                    </>
                  ) : (
                    `Apply All Fixes (${totalFixes})`
                  )}
                </Button>
              )}
            </DialogFooter>
          </>
        );
    }
  };

  return (
    <Dialog
      ref={dialogRef}
      open={modal.visible}
      onOpenChange={handleClose}
      uncloseable={state === 'progress'}
    >
      {renderContent()}
    </Dialog>
  );
});

export const ReviewModal = defineModal<ReviewModalProps, ReviewModalResult>(
  ReviewModalImpl
);
