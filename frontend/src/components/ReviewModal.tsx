import * as React from 'react';
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
import { Loader } from '@/components/ui/loader';
import {
  CheckCircle,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  AlertCircle,
  Info,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Task } from 'shared/types';

// Review state machine
type ReviewState =
  | 'confirmation'
  | 'reviewing'
  | 'results'
  | 'applying'
  | 'complete';

// Severity types for issues
export type IssueSeverity = 'critical' | 'major' | 'minor';

// Issue type returned by review
export interface ReviewIssue {
  id: string;
  severity: IssueSeverity;
  description: string;
  affectedTasks: string[];
  affectedFiles: string[];
  proposedFix: {
    description: string;
    codeDiff: string;
  };
}

// Results returned from the review process
export interface ReviewResults {
  tasksAnalyzed: number;
  issuesFound: number;
  issues: ReviewIssue[];
}

// Props for the ReviewModal component
export interface ReviewModalProps {
  isOpen: boolean;
  tasks: Task[];
  onClose: () => void;
  onStartReview: (taskIds: string[]) => Promise<ReviewResults>;
  onAcceptFixes: (results: ReviewResults) => Promise<void>;
}

// Severity badge component
function SeverityBadge({ severity }: { severity: IssueSeverity }) {
  const config = {
    critical: {
      icon: AlertTriangle,
      className: 'bg-destructive/10 text-destructive border-destructive',
      label: 'Critical',
    },
    major: {
      icon: AlertCircle,
      className: 'bg-yellow-500/10 text-yellow-600 border-yellow-500',
      label: 'Major',
    },
    minor: {
      icon: Info,
      className: 'bg-blue-500/10 text-blue-600 border-blue-500',
      label: 'Minor',
    },
  };

  const { icon: Icon, className, label } = config[severity];

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded border',
        className
      )}
    >
      <Icon className="h-3 w-3" />
      {label}
    </span>
  );
}

// Expandable issue item component
function IssueItem({ issue }: { issue: ReviewIssue }) {
  const [isExpanded, setIsExpanded] = React.useState(false);

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <button
        type="button"
        className="w-full flex items-start gap-3 p-3 text-left hover:bg-accent/50 transition-colors"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <span className="mt-0.5">
          {isExpanded ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <SeverityBadge severity={issue.severity} />
          </div>
          <p className="text-sm">{issue.description}</p>
        </div>
      </button>

      {isExpanded && (
        <div className="px-3 pb-3 pt-0 ml-7 space-y-3">
          {issue.affectedTasks.length > 0 && (
            <div>
              <h4 className="text-xs font-medium text-muted-foreground mb-1">
                Affected Tasks
              </h4>
              <ul className="text-sm space-y-0.5">
                {issue.affectedTasks.map((task) => (
                  <li key={task} className="text-muted-foreground">
                    {task}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {issue.affectedFiles.length > 0 && (
            <div>
              <h4 className="text-xs font-medium text-muted-foreground mb-1">
                Affected Files
              </h4>
              <ul className="text-sm space-y-0.5">
                {issue.affectedFiles.map((file) => (
                  <li key={file} className="font-mono text-xs text-muted-foreground">
                    {file}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div>
            <h4 className="text-xs font-medium text-muted-foreground mb-1">
              Proposed Fix
            </h4>
            <p className="text-sm mb-2">{issue.proposedFix.description}</p>
            <pre className="bg-secondary/50 p-2 rounded text-xs font-mono overflow-x-auto">
              <code>{issue.proposedFix.codeDiff}</code>
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}

export function ReviewModal({
  isOpen,
  tasks,
  onClose,
  onStartReview,
  onAcceptFixes,
}: ReviewModalProps) {
  const dialogRef = React.useRef<HTMLDivElement>(null);

  // State management
  const [state, setState] = React.useState<ReviewState>('confirmation');
  const [selectedTaskIds, setSelectedTaskIds] = React.useState<Set<string>>(
    new Set()
  );
  const [reviewResults, setReviewResults] = React.useState<ReviewResults | null>(
    null
  );
  const [currentFixIndex, setCurrentFixIndex] = React.useState(0);
  const [appliedFixesCount, setAppliedFixesCount] = React.useState(0);

  // Initialize selected tasks when modal opens
  React.useEffect(() => {
    if (isOpen) {
      setSelectedTaskIds(new Set(tasks.map((t) => t.id)));
      setState('confirmation');
      setReviewResults(null);
      setCurrentFixIndex(0);
      setAppliedFixesCount(0);
    }
  }, [isOpen, tasks]);

  // Toggle task selection
  const toggleTaskSelection = (taskId: string) => {
    setSelectedTaskIds((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) {
        next.delete(taskId);
      } else {
        next.add(taskId);
      }
      return next;
    });
  };

  // Handle starting the review
  const handleStartReview = async () => {
    setState('reviewing');
    try {
      const results = await onStartReview(Array.from(selectedTaskIds));
      setReviewResults(results);
      setState('results');
    } catch {
      // On error, go back to confirmation state
      setState('confirmation');
    }
  };

  // Handle accepting all fixes
  const handleAcceptFixes = async () => {
    if (!reviewResults) return;

    setState('applying');
    const totalFixes = reviewResults.issues.length;

    try {
      // Simulate progress through fixes
      for (let i = 0; i < totalFixes; i++) {
        setCurrentFixIndex(i + 1);
        // Small delay to show progress
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      await onAcceptFixes(reviewResults);
      setAppliedFixesCount(totalFixes);
      setState('complete');
    } catch {
      // On error, go back to results
      setState('results');
    }
  };

  // Handle rejecting fixes
  const handleReject = () => {
    onClose();
  };

  // Determine if dialog can be closed
  const isUncloseable = state === 'reviewing' || state === 'applying';

  // Get title based on state
  const getTitle = (): string => {
    switch (state) {
      case 'confirmation':
        return 'Review Tasks';
      case 'reviewing':
        return 'Reviewing Tasks';
      case 'results':
        return 'Review Complete';
      case 'applying':
        return 'Applying Fixes';
      case 'complete':
        return 'Fixes Applied';
    }
  };

  // Render content based on state
  const renderContent = () => {
    switch (state) {
      case 'confirmation':
        return (
          <>
            <DialogDescription className="text-left">
              Select the tasks you want to review.
            </DialogDescription>
            <div className="flex-1 overflow-y-auto overscroll-contain max-h-[300px] space-y-2">
              {tasks.map((task) => (
                <label
                  key={task.id}
                  className="flex items-center gap-3 p-2 rounded hover:bg-accent/50 cursor-pointer"
                >
                  <Checkbox
                    checked={selectedTaskIds.has(task.id)}
                    onCheckedChange={() => toggleTaskSelection(task.id)}
                  />
                  <span className="text-sm truncate">{task.title}</span>
                </label>
              ))}
            </div>
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button
                onClick={handleStartReview}
                disabled={selectedTaskIds.size === 0}
              >
                Start Review
              </Button>
            </DialogFooter>
          </>
        );

      case 'reviewing':
        return (
          <div className="flex flex-col items-center justify-center py-8">
            <Loader
              message={`Claude Code is analyzing ${selectedTaskIds.size} task${selectedTaskIds.size !== 1 ? 's' : ''}...`}
              size={48}
            />
          </div>
        );

      case 'results':
        return (
          <>
            <div className="flex gap-4 text-sm text-muted-foreground">
              <span>
                <strong className="text-foreground">
                  {reviewResults?.tasksAnalyzed}
                </strong>{' '}
                tasks analyzed
              </span>
              <span>
                <strong className="text-foreground">
                  {reviewResults?.issuesFound}
                </strong>{' '}
                issues found
              </span>
            </div>

            {reviewResults && reviewResults.issues.length > 0 ? (
              <div className="flex-1 overflow-y-auto overscroll-contain max-h-[400px] space-y-2">
                {reviewResults.issues.map((issue) => (
                  <IssueItem key={issue.id} issue={issue} />
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <CheckCircle className="h-12 w-12 text-green-500 mb-2" />
                <p className="text-sm text-muted-foreground">
                  No issues found in the selected tasks.
                </p>
              </div>
            )}

            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={handleReject}>
                Reject
              </Button>
              {reviewResults && reviewResults.issues.length > 0 && (
                <Button onClick={handleAcceptFixes}>Accept All Fixes</Button>
              )}
              {reviewResults && reviewResults.issues.length === 0 && (
                <Button onClick={onClose}>Close</Button>
              )}
            </DialogFooter>
          </>
        );

      case 'applying':
        return (
          <div className="flex flex-col items-center justify-center py-8">
            <Loader
              message={`Applying fix ${currentFixIndex} of ${reviewResults?.issues.length ?? 0}...`}
              size={48}
            />
          </div>
        );

      case 'complete':
        return (
          <>
            <div className="flex flex-col items-center justify-center py-6 text-center">
              <CheckCircle className="h-12 w-12 text-green-500 mb-3" />
              <p className="text-lg font-medium mb-1">
                Applied {appliedFixesCount} fix
                {appliedFixesCount !== 1 ? 'es' : ''} across{' '}
                {selectedTaskIds.size} task{selectedTaskIds.size !== 1 ? 's' : ''}
              </p>
              <p className="text-sm text-muted-foreground">
                All issues have been resolved.
              </p>
            </div>

            {reviewResults && reviewResults.issues.length > 0 && (
              <div className="space-y-1 text-sm">
                <h4 className="font-medium">Fixed issues:</h4>
                <ul className="list-disc list-inside text-muted-foreground">
                  {reviewResults.issues.map((issue) => (
                    <li key={issue.id}>{issue.description}</li>
                  ))}
                </ul>
              </div>
            )}

            <DialogFooter>
              <Button onClick={onClose}>Close</Button>
            </DialogFooter>
          </>
        );
    }
  };

  return (
    <Dialog
      ref={dialogRef}
      open={isOpen}
      onOpenChange={isUncloseable ? undefined : onClose}
      uncloseable={isUncloseable}
    >
      <DialogHeader>
        <DialogTitle>{getTitle()}</DialogTitle>
      </DialogHeader>
      <DialogContent>{renderContent()}</DialogContent>
    </Dialog>
  );
}
