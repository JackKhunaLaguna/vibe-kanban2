import { useMemo } from 'react';
import {
  ChevronDown,
  AlertTriangle,
  AlertCircle,
  XCircle,
  CheckCircle,
  Wrench,
  FileCode,
  ListTodo,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useExpandable } from '@/stores/useExpandableStore';
import { cn } from '@/lib/utils';

// Types
export type IssueSeverity = 'critical' | 'major' | 'minor';
export type IssueCategory = 'conflict' | 'code-quality' | 'suggested-fix';
export type OverallAssessment = 'safe' | 'warning' | 'danger';

export interface AffectedItem {
  type: 'file' | 'task';
  name: string;
  path?: string;
}

export interface SuggestedFix {
  id: string;
  description: string;
  canAutoApply: boolean;
}

export interface ReviewIssue {
  id: string;
  category: IssueCategory;
  severity: IssueSeverity;
  title: string;
  description: string;
  affectedItems: AffectedItem[];
  suggestedFix?: SuggestedFix;
}

export interface ReviewResults {
  tasksReviewed: number;
  issuesFound: number;
  overallAssessment: OverallAssessment;
  issues: ReviewIssue[];
}

export interface ReviewResultsProps {
  results: ReviewResults;
  onApplyFix: (fixId: string) => void;
  onReviewManually: (issueId: string) => void;
  className?: string;
}

// Color and styling configurations
const SEVERITY_CONFIG: Record<
  IssueSeverity,
  {
    icon: React.ReactNode;
    badgeClass: string;
    label: string;
  }
> = {
  critical: {
    icon: <XCircle className="h-4 w-4" aria-hidden />,
    badgeClass: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200 border-red-200 dark:border-red-800',
    label: 'Critical',
  },
  major: {
    icon: <AlertTriangle className="h-4 w-4" aria-hidden />,
    badgeClass: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200 border-amber-200 dark:border-amber-800',
    label: 'Major',
  },
  minor: {
    icon: <AlertCircle className="h-4 w-4" aria-hidden />,
    badgeClass: 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200 border-blue-200 dark:border-blue-800',
    label: 'Minor',
  },
};

const CATEGORY_CONFIG: Record<
  IssueCategory,
  {
    icon: React.ReactNode;
    title: string;
    headerClass: string;
    contentClass: string;
    borderClass: string;
  }
> = {
  conflict: {
    icon: <XCircle className="h-4 w-4" aria-hidden />,
    title: 'Conflicts',
    headerClass: 'bg-red-50 dark:bg-red-950/20 text-red-700 dark:text-red-300',
    contentClass: 'bg-red-50/50 dark:bg-red-950/10',
    borderClass: 'border-red-200 dark:border-red-800',
  },
  'code-quality': {
    icon: <AlertTriangle className="h-4 w-4" aria-hidden />,
    title: 'Code Quality Issues',
    headerClass: 'bg-amber-50 dark:bg-amber-950/20 text-amber-700 dark:text-amber-200',
    contentClass: 'bg-amber-50/50 dark:bg-amber-950/10',
    borderClass: 'border-amber-200 dark:border-amber-800',
  },
  'suggested-fix': {
    icon: <Wrench className="h-4 w-4" aria-hidden />,
    title: 'Suggested Fixes',
    headerClass: 'bg-blue-50 dark:bg-blue-950/20 text-blue-700 dark:text-blue-300',
    contentClass: 'bg-blue-50/50 dark:bg-blue-950/10',
    borderClass: 'border-blue-200 dark:border-blue-800',
  },
};

const ASSESSMENT_CONFIG: Record<
  OverallAssessment,
  {
    icon: React.ReactNode;
    label: string;
    containerClass: string;
    textClass: string;
  }
> = {
  safe: {
    icon: <CheckCircle className="h-5 w-5" aria-hidden />,
    label: 'Safe to proceed',
    containerClass: 'bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-800',
    textClass: 'text-green-700 dark:text-green-300',
  },
  warning: {
    icon: <AlertTriangle className="h-5 w-5" aria-hidden />,
    label: 'Proceed with caution',
    containerClass: 'bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800',
    textClass: 'text-amber-700 dark:text-amber-200',
  },
  danger: {
    icon: <XCircle className="h-5 w-5" aria-hidden />,
    label: 'Review required',
    containerClass: 'bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-800',
    textClass: 'text-red-700 dark:text-red-300',
  },
};

// Sub-components
function SummaryStats({
  tasksReviewed,
  issuesFound,
}: {
  tasksReviewed: number;
  issuesFound: number;
}) {
  return (
    <div className="flex gap-4 text-sm text-muted-foreground">
      <div className="flex items-center gap-1.5">
        <ListTodo className="h-4 w-4" aria-hidden />
        <span>{tasksReviewed} tasks reviewed</span>
      </div>
      <div className="flex items-center gap-1.5">
        <AlertCircle className="h-4 w-4" aria-hidden />
        <span>{issuesFound} issues found</span>
      </div>
    </div>
  );
}

function AssessmentBanner({ assessment }: { assessment: OverallAssessment }) {
  const config = ASSESSMENT_CONFIG[assessment];
  return (
    <div
      className={cn(
        'flex items-center gap-2 px-4 py-3 rounded-md border',
        config.containerClass
      )}
    >
      <span className={config.textClass}>{config.icon}</span>
      <span className={cn('font-medium', config.textClass)}>
        {config.label}
      </span>
    </div>
  );
}

function AffectedItemsList({ items }: { items: AffectedItem[] }) {
  return (
    <div className="mt-2 space-y-1">
      <p className="text-xs font-medium text-muted-foreground">Affected:</p>
      <ul className="space-y-1">
        {items.map((item, idx) => (
          <li
            key={`${item.type}-${item.name}-${idx}`}
            className="flex items-center gap-1.5 text-sm"
          >
            {item.type === 'file' ? (
              <FileCode className="h-3 w-3 text-muted-foreground" aria-hidden />
            ) : (
              <ListTodo className="h-3 w-3 text-muted-foreground" aria-hidden />
            )}
            <span className="font-mono text-xs">
              {item.path || item.name}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function IssueItem({
  issue,
  onApplyFix,
  onReviewManually,
}: {
  issue: ReviewIssue;
  onApplyFix: (fixId: string) => void;
  onReviewManually: (issueId: string) => void;
}) {
  const [expanded, toggle] = useExpandable(`review-issue-${issue.id}`, false);
  const severityConfig = SEVERITY_CONFIG[issue.severity];
  const categoryConfig = CATEGORY_CONFIG[issue.category];

  return (
    <div className={cn('border rounded-md overflow-hidden', categoryConfig.borderClass)}>
      <button
        onClick={() => toggle()}
        className={cn(
          'w-full px-3 py-2 flex items-center gap-2 text-left',
          categoryConfig.headerClass
        )}
      >
        <span className="flex-shrink-0">{severityConfig.icon}</span>
        <span className="flex-1 text-sm font-medium truncate">{issue.title}</span>
        <Badge className={cn('flex-shrink-0', severityConfig.badgeClass)}>
          {severityConfig.label}
        </Badge>
        <ChevronDown
          className={cn(
            'h-4 w-4 flex-shrink-0 transition-transform',
            !expanded && '-rotate-90'
          )}
          aria-hidden
        />
      </button>

      {expanded && (
        <div className={cn('px-3 py-3 border-t space-y-3', categoryConfig.contentClass, categoryConfig.borderClass)}>
          <p className="text-sm">{issue.description}</p>

          {issue.affectedItems.length > 0 && (
            <AffectedItemsList items={issue.affectedItems} />
          )}

          {issue.suggestedFix && (
            <div className="mt-3 p-2 bg-background/50 rounded border border-dashed">
              <p className="text-xs font-medium text-muted-foreground mb-1">
                Suggested fix:
              </p>
              <p className="text-sm">{issue.suggestedFix.description}</p>
            </div>
          )}

          <div className="flex gap-2 pt-1">
            {issue.suggestedFix?.canAutoApply && (
              <Button
                variant="outline"
                size="xs"
                onClick={() => onApplyFix(issue.suggestedFix!.id)}
              >
                <Wrench className="h-3 w-3 mr-1" aria-hidden />
                Apply fix
              </Button>
            )}
            <Button
              variant="ghost"
              size="xs"
              onClick={() => onReviewManually(issue.id)}
            >
              Review manually
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function IssueGroup({
  category,
  issues,
  onApplyFix,
  onReviewManually,
}: {
  category: IssueCategory;
  issues: ReviewIssue[];
  onApplyFix: (fixId: string) => void;
  onReviewManually: (issueId: string) => void;
}) {
  const [expanded, toggle] = useExpandable(`review-group-${category}`, true);
  const config = CATEGORY_CONFIG[category];

  return (
    <div className={cn('border rounded-md overflow-hidden', config.borderClass)}>
      <button
        onClick={() => toggle()}
        className={cn(
          'w-full px-3 py-2 flex items-center gap-2 text-left font-medium',
          config.headerClass
        )}
      >
        {config.icon}
        <span className="flex-1">{config.title}</span>
        <Badge variant="outline" className="text-xs">
          {issues.length}
        </Badge>
        <ChevronDown
          className={cn(
            'h-4 w-4 transition-transform',
            !expanded && '-rotate-90'
          )}
          aria-hidden
        />
      </button>

      {expanded && (
        <div className="p-3 space-y-2 bg-background/50">
          {issues.map((issue) => (
            <IssueItem
              key={issue.id}
              issue={issue}
              onApplyFix={onApplyFix}
              onReviewManually={onReviewManually}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// Main component
export function ReviewResults({
  results,
  onApplyFix,
  onReviewManually,
  className,
}: ReviewResultsProps) {
  const groupedIssues = useMemo(() => {
    const groups: Record<IssueCategory, ReviewIssue[]> = {
      conflict: [],
      'code-quality': [],
      'suggested-fix': [],
    };

    for (const issue of results.issues) {
      groups[issue.category].push(issue);
    }

    // Sort each group by severity (critical first)
    const severityOrder: Record<IssueSeverity, number> = {
      critical: 0,
      major: 1,
      minor: 2,
    };

    for (const category of Object.keys(groups) as IssueCategory[]) {
      groups[category].sort(
        (a, b) => severityOrder[a.severity] - severityOrder[b.severity]
      );
    }

    return groups;
  }, [results.issues]);

  const categoryOrder: IssueCategory[] = ['conflict', 'code-quality', 'suggested-fix'];

  return (
    <Card className={className}>
      <CardHeader className="pb-4">
        <CardTitle className="text-lg">Review Results</CardTitle>
        <SummaryStats
          tasksReviewed={results.tasksReviewed}
          issuesFound={results.issuesFound}
        />
      </CardHeader>

      <CardContent className="space-y-4">
        <AssessmentBanner assessment={results.overallAssessment} />

        {categoryOrder.map((category) => {
          const issues = groupedIssues[category];
          if (issues.length === 0) return null;
          return (
            <IssueGroup
              key={category}
              category={category}
              issues={issues}
              onApplyFix={onApplyFix}
              onReviewManually={onReviewManually}
            />
          );
        })}

        {results.issues.length === 0 && (
          <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground">
            <CheckCircle className="h-5 w-5" aria-hidden />
            <span>No issues found</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
