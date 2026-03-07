export default [
  {
    ignores: [
      'node_modules',
      'dist',
      'build',
      '**/*.min.js',
      'coverage',
      'public',
    ],
    files: ['**/*.{js,ts}'],
    rules: {
      // Your custom rules here
    },
  },
];
