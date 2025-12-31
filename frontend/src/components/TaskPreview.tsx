import * as React from 'react';
import { RefreshCw, Sparkles, Pencil } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';

interface TaskPreviewProps {
  generatedTitle: string;
  generatedPrompt: string;
  onTitleChange: (title: string) => void;
  onPromptChange: (prompt: string) => void;
  onCreate: () => void;
  onRegenerate: () => void;
  isCreating: boolean;
}

export function TaskPreview({
  generatedTitle,
  generatedPrompt,
  onTitleChange,
  onPromptChange,
  onCreate,
  onRegenerate,
  isCreating,
}: TaskPreviewProps) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Sparkles className="h-4 w-4" />
        <span>AI-generated task preview</span>
        <Pencil className="ml-1 h-3 w-3" />
        <span className="text-xs">Click to edit</span>
      </div>

      <Card>
        <CardContent className="flex flex-col gap-4 pt-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="task-title">Task Title</Label>
            <Input
              id="task-title"
              value={generatedTitle}
              onChange={(e) => onTitleChange(e.target.value)}
              placeholder="Enter task title..."
              disabled={isCreating}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="task-prompt">Claude Code Prompt</Label>
            <p className="text-xs text-muted-foreground">
              This prompt will be sent to Claude Code when the task is started.
            </p>
            <Textarea
              id="task-prompt"
              value={generatedPrompt}
              onChange={(e) => onPromptChange(e.target.value)}
              placeholder="Enter prompt for Claude Code..."
              disabled={isCreating}
              className="min-h-[200px] resize-y font-mono text-sm"
            />
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button
          variant="outline"
          onClick={onRegenerate}
          disabled={isCreating}
        >
          <RefreshCw className={cn('mr-2 h-4 w-4', isCreating && 'animate-spin')} />
          Regenerate
        </Button>
        <Button
          onClick={onCreate}
          disabled={isCreating}
        >
          {isCreating ? 'Creating...' : 'Create Task'}
        </Button>
      </div>
    </div>
  );
}

TaskPreview.displayName = 'TaskPreview';
