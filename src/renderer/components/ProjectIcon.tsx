import {
  BriefcaseBusiness,
  Code2,
  Folder,
  Layers3,
  Lightbulb,
  Rocket,
  Sparkles,
  Target,
  type LucideIcon,
} from 'lucide-react';
import { PROJECT_ICON_KEYS, type ProjectIconKey } from '../../shared/project-icons';

const projectIconComponents: Record<ProjectIconKey, LucideIcon> = {
  layers: Layers3,
  briefcase: BriefcaseBusiness,
  'code-2': Code2,
  folder: Folder,
  lightbulb: Lightbulb,
  rocket: Rocket,
  sparkles: Sparkles,
  target: Target,
};

export const PROJECT_ICON_OPTIONS = PROJECT_ICON_KEYS.map((key) => ({
  key,
  Icon: projectIconComponents[key],
}));

export function ProjectIcon({ icon = 'layers', size = 18 }: { icon?: ProjectIconKey; size?: number }) {
  const Icon = projectIconComponents[icon];
  return (
    <Icon size={size} aria-hidden="true" data-project-icon={icon} data-testid={`project-icon-${icon}`} />
  );
}
