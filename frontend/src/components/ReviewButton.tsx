import { Loader2, CheckSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

export interface ReviewButtonProps {
  taskCount: number;
  onReview: () => void;
  isReviewing: boolean;
  disabled?: boolean;
}

export function ReviewButton({
  taskCount,
  onReview,
  isReviewing,
  disabled = false,
}: ReviewButtonProps) {
  const isDisabled = disabled || taskCount === 0;
  const showTooltip = isDisabled && taskCount === 0;

  const buttonContent = (
    <Button
      onClick={onReview}
      disabled={isDisabled || isReviewing}
      className="gap-2"
      aria-label={`Review all ${taskCount} tasks`}
    >
      {isReviewing ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Reviewing...</span>
        </>
      ) : (
        <>
          <CheckSquare className="h-4 w-4" />
          <span>Review All</span>
          {taskCount > 0 && (
            <span className="ml-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary-foreground/20 px-1.5 text-xs font-semibold">
              {taskCount}
            </span>
          )}
        </>
      )}
    </Button>
  );

  if (showTooltip) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span tabIndex={0}>{buttonContent}</span>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            No tasks available for review
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return buttonContent;
}
