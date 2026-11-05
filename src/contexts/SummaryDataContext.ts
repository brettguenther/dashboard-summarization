import { createContext } from 'react';
import type { SummaryDataContextType } from '../types';

export const SummaryDataContext = createContext<SummaryDataContextType | undefined>(undefined);
