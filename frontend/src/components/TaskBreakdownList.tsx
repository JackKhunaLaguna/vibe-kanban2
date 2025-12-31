import { useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { Clock, GitBranch, Layers } from 'lucide-react';

// Types for the feature breakdown structure
export type TaskComplexity = 'simple' | 'moderate' | 'complex';

export interface BreakdownTask {
  id: string;
  title: string;
  prompt: string;
  tier: number;
  dependencies: string[];
  complexity: TaskComplexity;
  estimatedMinutes: number;
}

export interface FeatureBreakdown {
  featureName: string;
  tasks: BreakdownTask[];
  totalComplexity: TaskComplexity;
}

export interface TaskBreakdownListProps {
  breakdown: FeatureBreakdown;
  onTaskClick?: (taskId: string) => void;
}

// Color schemes for different tiers
const tierColors: Record<number, { bg: string; border: string; badge: string }> =
  {
    1: {
      bg: 'bg-info/5',
      border: 'border-info/30',
      badge: 'bg-info text-info-foreground',
    },
    2: {
      bg: 'bg-success/5',
      border: 'border-success/30',
      badge: 'bg-success text-success-foreground',
    },
    3: {
      bg: 'bg-warning/5',
      border: 'border-warning/30',
      badge: 'bg-warning text-warning-foreground',
    },
    4: {
      bg: 'bg-accent/10',
      border: 'border-accent/30',
      badge: 'bg-accent text-accent-foreground',
    },
  };

const defaultTierColor = {
  bg: 'bg-muted/50',
  border: 'border-muted',
  badge: 'bg-muted text-muted-foreground',
};

// Complexity badge variants
const complexityConfig: Record<
  TaskComplexity,
  { label: string; variant: 'default' | 'secondary' | 'outline' }
> = {
  simple: { label: 'Simple', variant: 'outline' },
  moderate: { label: 'Moderate', variant: 'secondary' },
  complex: { label: 'Complex', variant: 'default' },
};

function getWaveLabel(tier: number): string {
  if (tier === 1) return 'Wave 1 (Run First)';
  return `Wave ${tier} (Run After Wave ${tier - 1})`;
}

function formatEstimatedTime(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

function getBriefDescription(prompt: string, maxLines = 2): string {
  const lines = prompt.split('\n').filter((line) => line.trim());
  const truncatedLines = lines.slice(0, maxLines);
  const result = truncatedLines.join(' ').trim();
  if (result.length > 150) {
    return result.substring(0, 147) + '...';
  }
  return result;
}

interface TaskCardItemProps {
  task: BreakdownTask;
  taskNumber: number;
  allTasks: BreakdownTask[];
  tierColor: (typeof tierColors)[number];
  onClick?: () => void;
}

function TaskCardItem({
  task,
  taskNumber,
  allTasks,
  tierColor,
  onClick,
}: TaskCardItemProps) {
  const hasDependencies = task.dependencies.length > 0;
  const dependencyLabels = task.dependencies
    .map((depId) => {
      const depIndex = allTasks.findIndex((t) => t.id === depId);
      return depIndex >= 0 ? `Task ${depIndex + 1}` : null;
    })
    .filter(Boolean);

  const complexityInfo = complexityConfig[task.complexity];

  return (
    <div
      className={cn(
        'p-4 rounded-lg border transition-all cursor-pointer',
        'hover:shadow-md hover:border-primary/50',
        'focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2',
        tierColor.bg,
        tierColor.border,
        !hasDependencies && 'ring-1 ring-primary/20'
      )}
      onClick={onClick}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick?.();
        }
      }}
      role="button"
      aria-label={`Task ${taskNumber}: ${task.title}`}
    >
      <div className="flex flex-col gap-2">
        {/* Header row */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <span className="flex-shrink-0 inline-flex items-center justify-center w-6 h-6 rounded-full bg-foreground/10 text-xs font-medium">
              {taskNumber}
            </span>
            <h4 className="font-semibold text-sm truncate">{task.title}</h4>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <Badge variant={complexityInfo.variant} className="text-xs">
              {complexityInfo.label}
            </Badge>
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Clock className="h-3 w-3" />
              <span>{formatEstimatedTime(task.estimatedMinutes)}</span>
            </div>
          </div>
        </div>

        {/* Description */}
        <p className="text-xs text-muted-foreground leading-relaxed pl-8">
          {getBriefDescription(task.prompt)}
        </p>

        {/* Dependencies */}
        {hasDependencies && dependencyLabels.length > 0 && (
          <div className="flex items-center gap-2 pl-8">
            <GitBranch className="h-3 w-3 text-muted-foreground flex-shrink-0" />
            <span className="text-xs text-muted-foreground">Depends on:</span>
            <div className="flex flex-wrap gap-1">
              {dependencyLabels.map((label, idx) => (
                <Badge
                  key={idx}
                  variant="outline"
                  className="text-xs py-0 px-1.5"
                >
                  {label}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* No dependencies indicator */}
        {!hasDependencies && (
          <div className="flex items-center gap-2 pl-8">
            <span className="text-xs text-primary/70 font-medium">
              ✓ No dependencies - can start immediately
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

export function TaskBreakdownList({
  breakdown,
  onTaskClick,
}: TaskBreakdownListProps) {
  // Group tasks by tier
  const tasksByTier = useMemo(() => {
    const grouped = new Map<number, BreakdownTask[]>();

    breakdown.tasks.forEach((task) => {
      const tier = task.tier;
      if (!grouped.has(tier)) {
        grouped.set(tier, []);
      }
      grouped.get(tier)!.push(task);
    });

    // Sort by tier and return as array
    return Array.from(grouped.entries()).sort(([a], [b]) => a - b);
  }, [breakdown.tasks]);

  // Calculate task number for each task (1-indexed across all tasks)
  const taskNumberMap = useMemo(() => {
    const map = new Map<string, number>();
    breakdown.tasks.forEach((task, index) => {
      map.set(task.id, index + 1);
    });
    return map;
  }, [breakdown.tasks]);

  const totalComplexityInfo = complexityConfig[breakdown.totalComplexity];
  const totalEstimatedMinutes = breakdown.tasks.reduce(
    (sum, task) => sum + task.estimatedMinutes,
    0
  );

  return (
    <div className="space-y-6">
      {/* Summary Header */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex-shrink-0 p-2 rounded-lg bg-primary/10">
                <Layers className="h-5 w-5 text-primary" />
              </div>
              <div className="min-w-0">
                <CardTitle className="text-lg truncate">
                  {breakdown.featureName}
                </CardTitle>
                <p className="text-sm text-muted-foreground">
                  Feature Breakdown
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3 flex-shrink-0">
              <Badge variant="secondary" className="text-xs">
                {breakdown.tasks.length}{' '}
                {breakdown.tasks.length === 1 ? 'task' : 'tasks'}
              </Badge>
              <Badge variant={totalComplexityInfo.variant} className="text-xs">
                {totalComplexityInfo.label} complexity
              </Badge>
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <Clock className="h-3 w-3" />
                <span>{formatEstimatedTime(totalEstimatedMinutes)}</span>
              </div>
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* Task tiers */}
      {tasksByTier.map(([tier, tasks]) => {
        const tierColor = tierColors[tier] || defaultTierColor;

        return (
          <div key={tier} className="space-y-3">
            {/* Tier header */}
            <div className="flex items-center gap-3">
              <Badge className={cn('text-xs font-medium', tierColor.badge)}>
                {getWaveLabel(tier)}
              </Badge>
              <div className="h-px flex-1 bg-border" />
              <span className="text-xs text-muted-foreground">
                {tasks.length} {tasks.length === 1 ? 'task' : 'tasks'}
              </span>
            </div>

            {/* Task cards */}
            <div className="grid gap-3 sm:grid-cols-1 lg:grid-cols-2">
              {tasks.map((task) => (
                <TaskCardItem
                  key={task.id}
                  task={task}
                  taskNumber={taskNumberMap.get(task.id) || 0}
                  allTasks={breakdown.tasks}
                  tierColor={tierColor}
                  onClick={() => onTaskClick?.(task.id)}
                />
              ))}
            </div>
          </div>
        );
      })}

      {/* Empty state */}
      {breakdown.tasks.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-lg bg-muted">
              <Layers className="h-6 w-6 text-muted-foreground" />
            </div>
            <h3 className="mt-4 text-lg font-semibold">No tasks yet</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              The feature breakdown will appear here once generated.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
