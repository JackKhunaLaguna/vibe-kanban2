import { useTranslation } from 'react-i18next';
import { RefreshCw, Check, Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

interface GeneratedTask {
  title: string;
  prompt: string;
}

interface TaskPreviewProps {
  generatedTask: GeneratedTask;
  onTitleChange: (title: string) => void;
  onPromptChange: (prompt: string) => void;
  onRegenerate: () => void;
  onAccept: () => void;
  isRegenerating: boolean;
  disabled?: boolean;
}

export function TaskPreview({
  generatedTask,
  onTitleChange,
  onPromptChange,
  onRegenerate,
  onAccept,
  isRegenerating,
  disabled,
}: TaskPreviewProps) {
  const { t } = useTranslation(['tasks']);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-muted-foreground">
          {t('taskFormDialog.aiMode.previewTitle')}
        </h3>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onRegenerate}
            disabled={disabled || isRegenerating}
          >
            <RefreshCw
              className={`h-4 w-4 mr-2 ${isRegenerating ? 'animate-spin' : ''}`}
            />
            {t('taskFormDialog.aiMode.regenerate')}
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={onAccept}
            disabled={disabled || isRegenerating}
          >
            <Check className="h-4 w-4 mr-2" />
            {t('taskFormDialog.aiMode.accept')}
          </Button>
        </div>
      </div>

      <div className="space-y-3 p-4 border border-border rounded-md bg-muted/30">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Label htmlFor="preview-title" className="text-sm font-medium">
              {t('taskFormDialog.aiMode.titleLabel')}
            </Label>
            <Pencil className="h-3 w-3 text-muted-foreground" />
          </div>
          <Input
            id="preview-title"
            value={generatedTask.title}
            onChange={(e) => onTitleChange(e.target.value)}
            disabled={disabled || isRegenerating}
            className="font-medium"
          />
        </div>

        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Label htmlFor="preview-prompt" className="text-sm font-medium">
              {t('taskFormDialog.aiMode.promptLabel')}
            </Label>
            <Pencil className="h-3 w-3 text-muted-foreground" />
          </div>
          <Textarea
            id="preview-prompt"
            value={generatedTask.prompt}
            onChange={(e) => onPromptChange(e.target.value)}
            disabled={disabled || isRegenerating}
            className="min-h-[100px] resize-none"
          />
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        {t('taskFormDialog.aiMode.editHint')}
      </p>
    </div>
  );
}
