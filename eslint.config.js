import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist', 'coverage', 'node_modules'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    // Edge Functions (Deno): globals propios y sin `import.meta.env` del bundle.
    files: ['supabase/functions/**/*.ts'],
    languageOptions: {
      globals: { Deno: 'readonly' },
    },
  },
  {
    // E2E (Playwright): aquí no hay React.
    //
    // El corredor pasa un `use()` a cada fixture —así es como entrega el recurso
    // y espera a que la prueba termine— y la regla de hooks lo lee como si fuera
    // el `use` de React llamado fuera de un componente. Es un choque de nombres,
    // no un patrón peligroso: en esta carpeta no se renderiza nada.
    files: ['e2e/**/*.ts'],
    rules: {
      'react-hooks/rules-of-hooks': 'off',
    },
  },
)
