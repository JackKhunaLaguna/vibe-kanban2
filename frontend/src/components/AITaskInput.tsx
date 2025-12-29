import React, { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface AITaskInputProps {
  /** Callback when user clicks Generate Task */
  onGenerate: (input: string) => Promise<void>;
  /** Whether the generation is in progress */
  isLoading: boolean;
  /** Error message to display */
  error?: string;
  /** Maximum character limit for input */
  maxLength?: number;
  /** Additional class names for the container */
  className?: string;
}

const DEFAULT_MAX_LENGTH = 2000;

const AITaskInput: React.FC<AITaskInputProps> = ({
  onGenerate,
  isLoading,
  error,
  maxLength = DEFAULT_MAX_LENGTH,
  className,
}) => {
  const [input, setInput] = useState('');

  const trimmedInput = input.trim();
  const isEmpty = trimmedInput.length === 0;
  const characterCount = input.length;
  const isOverLimit = characterCount > maxLength;
  const isDisabled = isLoading || isEmpty || isOverLimit;

  const handleGenerate = useCallback(async () => {
    if (isDisabled) return;
    await onGenerate(trimmedInput);
  }, [isDisabled, onGenerate, trimmedInput]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Submit on Cmd/Ctrl + Enter
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleGenerate();
      }
    },
    [handleGenerate]
  );

  return (
    <div className={cn('flex flex-col gap-4', className)}>
      <div className="space-y-2">
        <Label htmlFor="ai-task-input">Describe your task</Label>
        <Textarea
          id="ai-task-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Describe the task you want to create in natural language. For example: 'Create a user authentication system with login, logout, and password reset functionality' or 'Fix the bug where the submit button doesn't work on mobile devices'"
          disabled={isLoading}
          className={cn(
            'min-h-[120px] resize-y',
            isOverLimit && 'border-destructive focus-visible:ring-destructive'
          )}
          aria-describedby="ai-task-input-description"
        />
        <div
          id="ai-task-input-description"
          className="flex items-center justify-between text-sm"
        >
          <span className="text-muted-foreground">
            Press{' '}
            <kbd className="rounded border bg-muted px-1 py-0.5 text-xs">
              ⌘
            </kbd>
            +
            <kbd className="rounded border bg-muted px-1 py-0.5 text-xs">
              Enter
            </kbd>{' '}
            to generate
          </span>
          <span
            className={cn(
              'tabular-nums',
              isOverLimit ? 'text-destructive' : 'text-muted-foreground'
            )}
          >
            {characterCount.toLocaleString()}/{maxLength.toLocaleString()}
          </span>
        </div>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="flex justify-end">
        <Button onClick={handleGenerate} disabled={isDisabled}>
          {isLoading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Generating...
            </>
          ) : (
            <>
              <Sparkles className="mr-2 h-4 w-4" />
              Generate Task
            </>
          )}
        </Button>
      </div>
    </div>
  );
};

AITaskInput.displayName = 'AITaskInput';

export { AITaskInput };
