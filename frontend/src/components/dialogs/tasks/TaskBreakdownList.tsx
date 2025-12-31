import { Circle, GripVertical } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface TaskBreakdownItem {
  id: string;
  title: string;
  description?: string;
}

interface TaskBreakdownListProps {
  items: TaskBreakdownItem[];
  className?: string;
}

export function TaskBreakdownList({ items, className }: TaskBreakdownListProps) {
  if (items.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        No tasks in breakdown
      </div>
    );
  }

  return (
    <div className={cn('space-y-2', className)}>
      {items.map((item, index) => (
        <div
          key={item.id}
          className="flex items-start gap-3 p-3 bg-muted/30 rounded-md border border-border hover:bg-muted/50 transition-colors"
        >
          <div className="flex items-center gap-2 text-muted-foreground">
            <GripVertical className="h-4 w-4 opacity-50" />
            <Circle className="h-4 w-4" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground font-mono">
                {index + 1}.
              </span>
              <span className="font-medium text-sm">{item.title}</span>
            </div>
            {item.description && (
              <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                {item.description}
              </p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
