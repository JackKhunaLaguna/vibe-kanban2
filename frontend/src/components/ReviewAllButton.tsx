import { Loader2, CheckCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

interface ReviewAllButtonProps {
  taskCount: number;
  onReviewClick: () => void;
  isReviewing: boolean;
}

export const ReviewAllButton: React.FC<ReviewAllButtonProps> = ({
  taskCount,
  onReviewClick,
  isReviewing,
}) => {
  const isDisabled = taskCount === 0 || isReviewing;

  const buttonLabel = isReviewing
    ? 'Reviewing...'
    : taskCount === 0
      ? 'No tasks to review'
      : `Review All (${taskCount})`;

  const tooltipText =
    taskCount === 0
      ? 'No tasks in review'
      : 'Review all tasks for conflicts and issues';

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            onClick={onReviewClick}
            disabled={isDisabled}
            className="gap-1.5 border-info text-info hover:bg-info"
            aria-label={tooltipText}
          >
            {isReviewing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <CheckCircle className="h-4 w-4" />
            )}
            {buttonLabel}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">{tooltipText}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};
