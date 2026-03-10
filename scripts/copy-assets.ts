import { cpSync, mkdirSync } from 'node:fs';

mkdirSync('public/quizzes', { recursive: true });
mkdirSync('public/visualizations', { recursive: true });

const htmlFilter = (source: string, _destination: string): boolean =>
  source.endsWith('.html') || !source.includes('.');

cpSync('quizzes', 'public/quizzes', { recursive: true, filter: htmlFilter });
cpSync('visualizations', 'public/visualizations', { recursive: true, filter: htmlFilter });
