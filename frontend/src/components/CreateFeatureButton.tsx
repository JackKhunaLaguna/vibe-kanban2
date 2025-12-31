import { GitBranch } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

export interface CreateFeatureButtonProps {
  onClick: () => void;
  disabled?: boolean;
}

export function CreateFeatureButton({
  onClick,
  disabled = false,
}: CreateFeatureButtonProps) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 text-violet-500 hover:text-violet-400 hover:bg-violet-500/10"
            onClick={onClick}
            disabled={disabled}
            aria-label="Create Feature"
          >
            <GitBranch className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          Break down a feature into multiple tasks
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
