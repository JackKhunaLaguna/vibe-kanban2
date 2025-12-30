import { useTranslation } from 'react-i18next';
import { Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';

interface AITaskInputProps {
  value: string;
  onChange: (value: string) => void;
  onGenerate: () => void;
  isGenerating: boolean;
  disabled?: boolean;
}

export function AITaskInput({
  value,
  onChange,
  onGenerate,
  isGenerating,
  disabled,
}: AITaskInputProps) {
  const { t } = useTranslation(['tasks']);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      if (!isGenerating && value.trim()) {
        onGenerate();
      }
    }
  };

  return (
    <div className="space-y-3">
      <Label htmlFor="ai-input" className="text-sm font-medium">
        {t('taskFormDialog.aiMode.inputLabel')}
      </Label>
      <Textarea
        id="ai-input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={t('taskFormDialog.aiMode.inputPlaceholder')}
        className="min-h-[120px] resize-none"
        disabled={disabled || isGenerating}
      />
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {t('taskFormDialog.aiMode.inputHint')}
        </p>
        <Button
          type="button"
          onClick={onGenerate}
          disabled={disabled || isGenerating || !value.trim()}
          size="sm"
        >
          <Sparkles className="h-4 w-4 mr-2" />
          {isGenerating
            ? t('taskFormDialog.aiMode.generating')
            : t('taskFormDialog.aiMode.generate')}
        </Button>
      </div>
    </div>
  );
}
