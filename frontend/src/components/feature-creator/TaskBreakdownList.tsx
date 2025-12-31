import { ChevronDown, ChevronUp, ArrowRight } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import type { BreakdownTaskResponse } from 'shared/types';

interface TaskBreakdownListProps {
  tasks: BreakdownTaskResponse[];
}

interface TaskItemProps {
  task: BreakdownTaskResponse;
  index: number;
}

function TaskItem({ task, index }: TaskItemProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className="border rounded-lg bg-card">
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-start gap-3 p-3 text-left hover:bg-muted/50 transition-colors"
      >
        <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary text-sm font-medium flex items-center justify-center">
          {index + 1}
        </span>
        <div className="flex-1 min-w-0">
          <h4 className="font-medium text-sm leading-tight">{task.title}</h4>
          {task.dependencies.length > 0 && (
            <div className="flex items-center gap-1 mt-1 text-xs text-muted-foreground">
              <ArrowRight className="h-3 w-3" />
              <span>
                Depends on: {task.dependencies.join(', ')}
              </span>
            </div>
          )}
        </div>
        <span className="flex-shrink-0 text-muted-foreground">
          {isExpanded ? (
            <ChevronUp className="h-4 w-4" />
          ) : (
            <ChevronDown className="h-4 w-4" />
          )}
        </span>
      </button>
      {isExpanded && (
        <div className="px-3 pb-3 pl-12">
          <p className="text-sm text-muted-foreground whitespace-pre-wrap">
            {task.description}
          </p>
        </div>
      )}
    </div>
  );
}

export function TaskBreakdownList({ tasks }: TaskBreakdownListProps) {
  if (tasks.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        No tasks generated yet
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-muted-foreground">
          {tasks.length} {tasks.length === 1 ? 'task' : 'tasks'} generated
        </h3>
      </div>
      <div className={cn('space-y-2 max-h-[400px] overflow-y-auto pr-1')}>
        {tasks.map((task, index) => (
          <TaskItem key={`${task.title}-${index}`} task={task} index={index} />
        ))}
      </div>
    </div>
  );
}
