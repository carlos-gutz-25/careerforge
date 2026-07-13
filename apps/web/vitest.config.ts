import base from '@careerforge/config/vitest';
import { defineProject, mergeConfig } from 'vitest/config';

export default mergeConfig(base, defineProject({ test: { name: 'app-web' } }));
