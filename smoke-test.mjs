// Quick smoke test of the parser (no VS Code runtime needed)
import { parseCsFile } from './out/testDiscovery.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const files = [
  path.join(__dirname, 'sample/MyApp.Tests/MathTests.cs'),
  path.join(__dirname, 'sample/MyApp.Tests/StringTests.cs'),
];

let totalTests = 0;

for (const file of files) {
  const classes = parseCsFile(file);
  if (classes.length === 0) {
    console.log(`  ❌  No test classes found in ${path.basename(file)}`);
    continue;
  }
  for (const cls of classes) {
    console.log(`\n  📦  ${cls.fullyQualifiedName}  [${cls.framework}]  (${file}:${cls.line})`);
    for (const method of cls.methods) {
      const data = method.testData?.length ? `  → ${method.testData.join(', ')}` : '';
      console.log(`    🧪  ${method.name}  [${method.attributes.join(', ')}]${data}  (line ${method.line})`);
      totalTests++;
    }
  }
}

console.log(`\n✅  Total: ${totalTests} test methods discovered\n`);
if (totalTests === 0) {
  process.exit(1);
}
