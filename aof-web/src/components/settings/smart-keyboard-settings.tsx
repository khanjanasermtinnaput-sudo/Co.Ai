'use client';

import { useSmartKeyboardStore } from '@/store/smart-keyboard-store';
import type { SmartKeyboardMode } from '@/store/smart-keyboard-store';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';

const MODE_OPTIONS: { value: SmartKeyboardMode; label: string; description: string }[] = [
  {
    value: 'off',
    label: 'Off',
    description: 'Disabled — type freely without any correction.',
  },
  {
    value: 'suggest',
    label: 'Suggest only',
    description: 'Shows a suggestion banner when a layout error is detected. You decide whether to apply it.',
  },
  {
    value: 'auto',
    label: 'Auto-convert',
    description: 'Automatically corrects high-confidence layout errors in real time.',
  },
];

/**
 * Drop-in settings panel for Smart Keyboard.
 * Add this component inside the Appearance tab of settings-view.tsx.
 */
export function SmartKeyboardSettings() {
  const { enabled, mode, setEnabled, setMode } = useSmartKeyboardStore();

  return (
    <div className="space-y-4">
      {/* ── Master toggle ─────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <Label htmlFor="sk-toggle" className="text-sm font-medium">
            Smart Keyboard
          </Label>
          <p className="text-xs text-muted-foreground mt-0.5">
            Detects and corrects Thai ↔ English layout errors inside Co.AI inputs.
          </p>
        </div>
        <Switch
          id="sk-toggle"
          checked={enabled}
          onCheckedChange={setEnabled}
        />
      </div>

      {/* ── Mode selector ─────────────────────────────────────────────── */}
      {enabled && (
        <div className="space-y-2 pl-1">
          <Label className="text-xs text-muted-foreground uppercase tracking-wide">
            Correction mode
          </Label>
          <div className="space-y-1">
            {MODE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setMode(opt.value)}
                className={[
                  'w-full text-left rounded-lg border px-3 py-2.5 transition-colors',
                  mode === opt.value
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border hover:border-primary/40 hover:bg-muted/50',
                ].join(' ')}
              >
                <div className="text-sm font-medium">{opt.label}</div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {opt.description}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
