import type React from 'react';
import { Briefcase, Target, TrendingUp, Users } from 'lucide-react';

export interface PresetPrompt {
  id: string;
  title: string;
  description: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  prompt: string;
}

export const PRESET_PROMPTS: PresetPrompt[] = [
  {
    id: 'executive',
    title: 'Executive Style',
    description: 'Bottom-line KPI impact & strategic decisions',
    icon: Briefcase,
    prompt:
      'Analyze this dashboard with an executive mindset. Focus on headline business metrics, strategic implications, and high-leverage decisions. Keep language concise and emphasize bottom-line impact.',
  },
  {
    id: 'analyst',
    title: 'Analyst Deep Dive',
    description: 'Drivers, anomalies, and segment variance',
    icon: TrendingUp,
    prompt:
      'Provide a detailed analytical breakdown of this dashboard. Highlight segment variances, notable anomalies, correlations across tiles, and data-backed hypotheses to investigate.',
  },
  {
    id: 'stakeholder',
    title: 'Stakeholder Update',
    description: 'Balanced progress summary for cross-functional teams',
    icon: Users,
    prompt:
      'Summarize this dashboard for cross-functional stakeholders. Balance quantitative insights with operational context, celebrate wins against targets, and flag areas requiring attention.',
  },
  {
    id: 'action',
    title: 'Action Plan',
    description: 'Immediate operational interventions & owners',
    icon: Target,
    prompt:
      'Analyze this dashboard with a strict focus on operational execution. Prioritize concrete interventions, immediate optimization opportunities, and clear next steps grounded in the data.',
  },
];
