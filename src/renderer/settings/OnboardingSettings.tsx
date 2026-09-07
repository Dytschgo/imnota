import { CheckCircle2, Play } from 'lucide-react';
import type { OnboardingPreferences } from './preferences';
import './settings.css';

export interface OnboardingSettingsProps {
  value: OnboardingPreferences;
  onReplay: () => void;
  disabled?: boolean;
}

export function OnboardingSettings({ value, onReplay, disabled = false }: OnboardingSettingsProps) {
  return (
    <section className="imnota-preference-section" aria-labelledby="onboarding-settings-title">
      <header className="imnota-preference-heading imnota-onboarding-setting-heading">
        <div>
          <h2 id="onboarding-settings-title">Interactive guide</h2>
          <p>Practice the screenshot-to-prompt workflow again without changing a workspace.</p>
        </div>
        <button type="button" className="imnota-secondary-button" disabled={disabled} onClick={onReplay}>
          <Play size={14} aria-hidden="true" />
          Replay guide
        </button>
      </header>
      <div className="imnota-completion-state">
        <CheckCircle2 size={16} aria-hidden="true" />
        <span>
          {value.completed
            ? `Completed with guide version ${value.completedVersion}`
            : 'The guide has not been completed on this profile.'}
        </span>
      </div>
    </section>
  );
}
