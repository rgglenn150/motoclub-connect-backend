const babel = require('@babel/core');
const fs = require('fs');

async function transpile(file) {
  const result = await babel.transformAsync(file, {
    presets: ['@babel/preset-env'],
  });
  return result.code;
}

async function run() {
  const files = ['test/club.test.js']; // Add other files if needed
  for (const file of files) {
    const transpiledCode = await transpile(file);
    fs.writeFileSync(file + '.babel.js', transpiledCode);
  }
}

run();
