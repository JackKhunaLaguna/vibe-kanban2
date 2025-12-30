import { Eye } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

export interface ReviewButtonProps {
  /** Number of tasks in review */
  taskCount: number;
  /** Click handler to open the review modal */
  onClick: () => void;
  /** Whether the button is disabled */
  disabled?: boolean;
  /** Additional className */
  className?: string;
}

/**
 * ReviewButton component for triggering code review of tasks in the "In Review" status.
 * Shows a badge with the count of tasks ready for review.
 */
export function ReviewButton({
  taskCount,
  onClick,
  disabled = false,
  className,
}: ReviewButtonProps) {
  const isDisabled = disabled || taskCount === 0;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="xs"
            className={cn(
              'gap-1.5 text-muted-foreground hover:text-foreground',
              !isDisabled && 'hover:bg-warning/10',
              className
            )}
            onClick={onClick}
            disabled={isDisabled}
            aria-label={`Review ${taskCount} task${taskCount !== 1 ? 's' : ''}`}
          >
            <Eye className="h-4 w-4" />
            <span className="text-xs font-medium">Review</span>
            {taskCount > 0 && (
              <span
                className={cn(
                  'ml-0.5 inline-flex items-center justify-center rounded-full px-1.5 py-0.5 text-xs font-medium',
                  'bg-warning/20 text-warning-foreground'
                )}
              >
                {taskCount}
              </span>
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          {taskCount === 0
            ? 'No tasks in review'
            : `Review ${taskCount} task${taskCount !== 1 ? 's' : ''} with AI`}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export default ReviewButton;
