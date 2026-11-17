// ESLint flat config: typed rules for the whole monorepo, plus determinism rules for scene code.
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/** Frames are rendered out of order by parallel workers: scene code must be a pure function of time. */
const determinism = {
  'no-restricted-properties': [
    'error',
    { object: 'Math', property: 'random', message: 'Use the seeded ctx.rng / createRng / randomTable instead.' },
    { object: 'performance', property: 'now', message: 'Scenes must depend on the frame time only.' },
    { object: 'Date', property: 'now', message: 'Scenes must depend on the frame time only.' },
  ],
  'no-restricted-globals': [
    'error',
    { name: 'requestAnimationFrame', message: 'The engine drives every frame through renderAt(t).' },
    { name: 'setTimeout', message: 'Scenes must depend on the frame time only.' },
    { name: 'setInterval', message: 'Scenes must depend on the frame time only.' },
  ],
};

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', '**/.studio/**', '**/out/**', '.venv/**', 'packages/audio/**'] },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: [
            '*.js',
            '*.mjs',
            '*.ts',
            'bin/*.mjs',
            'packages/cli/build.mjs',
            'packages/ui/build.mjs',
          ],
        },
      },
    },
    rules: {
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-confusing-void-expression': 'off',
    },
  },
  {
    files: ['packages/cli/**', 'packages/*/build.mjs', '*.js', '*.mjs', 'bin/**', '*.ts', 'projects/*/tools/**'],
    languageOptions: { globals: globals.node },
  },
  { files: ['packages/ui/src/**'], languageOptions: { globals: globals.browser } },
  { files: ['packages/runtime/src/**', 'projects/**', 'templates/**'], languageOptions: { globals: globals.browser } },
  { files: ['projects/*/scenes/**', 'templates/*/scenes/**'], rules: determinism },
  // user projects (written with the assistant): determinism and real errors only, no style rules;
  // the reference example and the template stay fully checked
  {
    files: ['projects/*/scenes/**'],
    ignores: ['projects/panoptique/**'],
    rules: {
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/consistent-type-imports': 'off',
      '@typescript-eslint/no-unnecessary-condition': 'off',
    },
  },
  { files: ['**/*.js', '**/*.mjs'], ...tseslint.configs.disableTypeChecked },
);
