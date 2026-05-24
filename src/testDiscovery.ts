import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as cp from 'child_process';
import { glob } from 'glob';
import type { TestClass, TestFramework, TestMethod, TestProject } from './types.js';

// ─── Regex patterns ──────────────────────────────────────────────────────────

/** Detects any of the well-known test-method attributes. */
const TEST_ATTR_RE =
  /\[\s*(Fact|Theory|Test|TestCase|TestCaseSource|TestMethod|DataTestMethod|DataRow|InlineData|MemberData|ClassData|TestFixture|SetUp|TearDown|OneTimeSetUp|OneTimeTearDown|Ignore|Skip|RetryOnFailure)(?:\s*\([^)]*\))?\s*\]/g;

/** Captures InlineData / TestCase / DataRow argument strings. */
const TEST_DATA_RE =
  /\[\s*(?:InlineData|TestCase|DataRow)\s*\(([^)]+)\)\s*\]/g;

/** Matches a C# namespace declaration (file-scoped or block). */
const NAMESPACE_RE = /^\s*namespace\s+([\w.]+)/;

/** Matches a class declaration (simplified). */
const CLASS_RE = /^\s*(?:public|internal|private|protected)?\s*(?:abstract\s+)?(?:partial\s+)?class\s+(\w+)/;

/** Matches a method declaration with common test-method signatures. */
const METHOD_RE =
  /^\s*(?:public|internal|private|protected)\s+(?:async\s+)?(?:Task|void|[\w<>[\]]+)\s+(\w+)\s*\(/;

/** Matches a display name attribute. */
const DISPLAY_NAME_RE = /\[\s*(?:DisplayName|TestName)\s*\(\s*"([^"]+)"\s*\)\s*\]/;

// ─── Framework detection ──────────────────────────────────────────────────────

function detectFrameworkFromCsproj(csprojContent: string): TestFramework {
  if (/xunit/i.test(csprojContent)) {
    return 'xunit';
  }
  if (/nunit/i.test(csprojContent)) {
    return 'nunit';
  }
  if (/mstest|Microsoft\.VisualStudio\.TestTools/i.test(csprojContent)) {
    return 'mstest';
  }
  return 'unknown';
}

function detectFrameworkFromAttributes(attributes: string[]): TestFramework {
  const flat = attributes.join(' ').toLowerCase();
  if (/\bfact\b|\btheory\b|\binlinedata\b|\bmemberdata\b/.test(flat)) {
    return 'xunit';
  }
  if (/\btest\b|\btestcase\b|\btestfixture\b|\bsetup\b|\bteardown\b/.test(flat)) {
    return 'nunit';
  }
  if (/\btestmethod\b|\bdatatestmethod\b|\bdatarow\b/.test(flat)) {
    return 'mstest';
  }
  return 'unknown';
}

// ─── .cs file parser ──────────────────────────────────────────────────────────

/**
 * Parses a single .cs file and returns all TestClass entries found in it.
 */
export function parseCsFile(filePath: string): TestClass[] {
  let content: string;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch {
    return [];
  }

  const lines = content.split('\n');
  const classes: TestClass[] = [];

  let currentNamespace = '';
  let currentClass: TestClass | null = null;
  /** Attributes accumulated since the last non-attribute line */
  let pendingAttributes: string[] = [];
  let pendingTestData: string[] = [];
  let pendingDisplayName: string | undefined;

  // Track brace depth so we know when a class body closes
  let braceDepth = 0;
  let classBraceDepth = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1; // 1-based

    // Count braces
    for (const ch of line) {
      if (ch === '{') {
        braceDepth++;
      } else if (ch === '}') {
        braceDepth--;
        if (currentClass && braceDepth < classBraceDepth) {
          // Leaving the class body
          if (currentClass.methods.length > 0) {
            classes.push(currentClass);
          }
          currentClass = null;
          classBraceDepth = -1;
        }
      }
    }

    // Namespace (file-scoped: "namespace Foo.Bar;" or block: "namespace Foo.Bar {")
    const nsMatch = NAMESPACE_RE.exec(line);
    if (nsMatch) {
      currentNamespace = nsMatch[1];
      pendingAttributes = [];
      pendingTestData = [];
      pendingDisplayName = undefined;
      continue;
    }

    // Accumulate attributes
    const attrMatches = [...line.matchAll(TEST_ATTR_RE)];
    if (attrMatches.length > 0) {
      pendingAttributes.push(...attrMatches.map(m => m[1]));

      // Grab inline test data
      for (const dm of line.matchAll(TEST_DATA_RE)) {
        pendingTestData.push(`(${dm[1].trim()})`);
      }

      // Grab display name
      const dn = DISPLAY_NAME_RE.exec(line);
      if (dn) {
        pendingDisplayName = dn[1];
      }
      continue;
    }

    // Class declaration
    const classMatch = CLASS_RE.exec(line);
    if (classMatch) {
      const className = classMatch[1];
      const fqn = currentNamespace ? `${currentNamespace}.${className}` : className;

      // Only track if it has test-related attributes OR we'll let it accumulate
      // (we filter at the end: keep classes with at least one test method)
      currentClass = {
        name: className,
        namespace: currentNamespace,
        fullyQualifiedName: fqn,
        filePath,
        line: lineNum,
        framework: 'unknown',
        methods: [],
      };
      classBraceDepth = braceDepth; // depth at the opening {

      pendingAttributes = [];
      pendingTestData = [];
      pendingDisplayName = undefined;
      continue;
    }

    // Method declaration (only meaningful inside a class)
    if (currentClass) {
      const methodMatch = METHOD_RE.exec(line);
      if (methodMatch && pendingAttributes.length > 0) {
        const methodName = methodMatch[1];
        const framework = detectFrameworkFromAttributes(pendingAttributes);
        const fqn = `${currentClass.fullyQualifiedName}.${methodName}`;

        const method: TestMethod = {
          name: methodName,
          fullyQualifiedName: fqn,
          attributes: [...pendingAttributes],
          testData: pendingTestData.length > 0 ? [...pendingTestData] : undefined,
          displayName: pendingDisplayName,
          framework,
          filePath,
          line: lineNum,
        };

        currentClass.methods.push(method);
        currentClass.framework = framework !== 'unknown' ? framework : currentClass.framework;
      }
    }

    // Clear pending if we hit a non-attribute, non-empty line
    if (line.trim() && !line.trim().startsWith('[') && !line.trim().startsWith('//')) {
      pendingAttributes = [];
      pendingTestData = [];
      pendingDisplayName = undefined;
    }
  }

  // Handle file-scoped namespaces (no closing brace for class at EOF)
  if (currentClass && currentClass.methods.length > 0) {
    classes.push(currentClass);
  }

  return classes;
}

// ─── Project discovery ────────────────────────────────────────────────────────

/**
 * Finds all .csproj files in the workspace (respecting exclude patterns).
 */
async function findCsprojFiles(
  workspaceRoot: string,
  excludePatterns: string[]
): Promise<string[]> {
  return glob('**/*.csproj', {
    cwd: workspaceRoot,
    ignore: excludePatterns,
    absolute: true,
  });
}

/**
 * Finds all .cs files under a project directory (respecting exclude patterns).
 */
async function findCsFilesInProject(
  projectDir: string,
  excludePatterns: string[]
): Promise<string[]> {
  return glob('**/*.cs', {
    cwd: projectDir,
    ignore: excludePatterns,
    absolute: true,
  });
}

// ─── Location map (FQN → source position) ────────────────────────────────────

/**
 * Per-symbol source location and metadata, populated by parsing .cs files.
 */
interface SourceLocation {
  filePath: string;
  line: number;
  attributes: string[];
  testData?: string[];
  displayName?: string;
}

/**
 * Parses all .cs files in a project and returns a map from fully-qualified name
 * to source location. Both class FQNs and method FQNs are indexed.
 */
async function buildLocationMap(
  projectDir: string,
  excludePatterns: string[]
): Promise<Map<string, SourceLocation>> {
  const locationMap = new Map<string, SourceLocation>();
  const csFiles = await findCsFilesInProject(projectDir, excludePatterns);

  for (const csFile of csFiles) {
    for (const cls of parseCsFile(csFile)) {
      locationMap.set(cls.fullyQualifiedName, {
        filePath: cls.filePath,
        line: cls.line,
        attributes: [],
      });
      for (const method of cls.methods) {
        locationMap.set(method.fullyQualifiedName, {
          filePath: method.filePath,
          line: method.line,
          attributes: method.attributes,
          testData: method.testData,
          displayName: method.displayName,
        });
      }
    }
  }

  return locationMap;
}

// ─── dotnet CLI discovery ─────────────────────────────────────────────────────

function isDotnetAvailable(): boolean {
  try {
    cp.execSync('dotnet --version', { stdio: 'ignore', timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Uses `dotnet test --list-tests` to discover tests. Returns null on failure.
 */
function discoverViaDotnetCli(
  projectPath: string): string[] | null {
  try {
    const output = cp.execSync(`dotnet test "${projectPath}" --list-tests --no-build`, {
      timeout: 30_000,
      encoding: 'utf8',
    });
    // Output looks like:
    //   The following Tests are available:
    //     MyApp.Tests.MathTests.ShouldAddTwoNumbers
    //     ...
    const lines = output.split('\n');
    const startIdx = lines.findIndex(l => /The following Tests are available/i.test(l));
    if (startIdx === -1) {
      return null;
    }
    return lines
      .slice(startIdx + 1)
      .map(l => l.trim())
      .filter(l => l.length > 0);
  } catch {
    return null;
  }
}

// ─── Main discovery entry point ───────────────────────────────────────────────

export type DiscoveryMode = 'auto' | 'parse' | 'dotnet-cli';

/**
 * Discovers all test projects and their tests in the given workspace root.
 */
export async function discoverTests(
  workspaceRoot: string,
  mode: DiscoveryMode,
  excludePatterns: string[],
  output: vscode.OutputChannel
): Promise<TestProject[]> {
  const csprojFiles = await findCsprojFiles(workspaceRoot, excludePatterns);

  if (csprojFiles.length === 0) {
    output.appendLine('[C# Test Lister] No .csproj files found in workspace.');
    return [];
  }

  output.appendLine(
    `[C# Test Lister] Found ${csprojFiles.length} project(s): ${csprojFiles.map(p => path.basename(p)).join(', ')}`
  );

  const projects: TestProject[] = [];

  for (const csprojPath of csprojFiles) {
    const projectDir = path.dirname(csprojPath);
    const projectName = path.basename(csprojPath, '.csproj');

    let csprojContent = '';
    try {
      csprojContent = fs.readFileSync(csprojPath, 'utf8');
    } catch {
      /* ignore */
    }

    const framework = detectFrameworkFromCsproj(csprojContent);

    // Only include projects that look like test projects (have xunit/nunit/mstest references)
    // unless we find test classes via parsing anyway
    const isLikelyTestProject = framework !== 'unknown';

    if (!isLikelyTestProject && mode === 'dotnet-cli') {
      // Skip non-test projects for CLI mode
      continue;
    }

    const project: TestProject = {
      name: projectName,
      projectPath: csprojPath,
      projectDir,
      framework,
      classes: [],
    };

    const useCli =
      mode === 'dotnet-cli' || (mode === 'auto' && isDotnetAvailable() && isLikelyTestProject);

    if (useCli) {
      output.appendLine(`[C# Test Lister] Using dotnet CLI for: ${projectName}`);
      const fqns = discoverViaDotnetCli(csprojPath);
      if (fqns !== null) {
        // Parse source files in parallel to get file + line locations, then
        // merge them into the CLI results so navigation works correctly.
        output.appendLine(`[C# Test Lister] Building location map from source for: ${projectName}`);
        const locationMap = await buildLocationMap(projectDir, excludePatterns);
        project.classes = fqnsToClasses(fqns, csprojPath, framework, locationMap);
        projects.push(project);
        continue;
      }
      output.appendLine(`[C# Test Lister] dotnet CLI failed for ${projectName}, falling back to parse`);
    }

    // Parse mode (or fallback)
    output.appendLine(`[C# Test Lister] Parsing source files for: ${projectName}`);
    const csFiles = await findCsFilesInProject(projectDir, excludePatterns);
    output.appendLine(`[C# Test Lister]   → ${csFiles.length} .cs files`);

    for (const csFile of csFiles) {
      const classes = parseCsFile(csFile);
      // Only keep classes that actually have test methods
      const testClasses = classes.filter(c => c.methods.length > 0);
      project.classes.push(...testClasses);
    }

    if (project.classes.length > 0 || isLikelyTestProject) {
      // Update framework from found classes if project-level detection was unknown
      if (project.framework === 'unknown' && project.classes.length > 0) {
        const nonUnknown = project.classes.find(c => c.framework !== 'unknown');
        if (nonUnknown) {
          project.framework = nonUnknown.framework;
        }
      }
      projects.push(project);
    }
  }

  const total = projects.reduce((sum, p) => sum + p.classes.reduce((s2, c) => s2 + c.methods.length, 0), 0);
  output.appendLine(`[C# Test Lister] Discovery complete: ${total} test(s) in ${projects.length} project(s)`);

  return projects;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Converts a list of fully-qualified test names (from dotnet CLI) into TestClass objects,
 * enriched with source locations from the parsed location map.
 *
 * Parameterized test FQNs from the CLI look like:
 *   "MyApp.Tests.MathTests.Multiply_ReturnsCorrectProduct(a: 2, b: 3, expected: 6)"
 * The base FQN (without the parameter suffix) is used to look up the source location.
 */
function fqnsToClasses(
  fqns: string[],
  projectPath: string,
  framework: TestFramework,
  locationMap: Map<string, SourceLocation>
): TestClass[] {
  const classMap = new Map<string, TestClass>();

  for (const fqn of fqns) {
    // Strip parameter suffix so "Method(a: 1, b: 2)" → "Method" for source lookup.
    const baseFqn = fqn.replace(/\(.*\)$/, '');

    const parts = baseFqn.split('.');
    if (parts.length < 2) {
      continue;
    }
    const methodName = parts[parts.length - 1];
    const className = parts[parts.length - 2];
    const namespace = parts.slice(0, parts.length - 2).join('.');
    const classFqn = parts.slice(0, parts.length - 1).join('.');

    if (!classMap.has(classFqn)) {
      const classLoc = locationMap.get(classFqn);
      classMap.set(classFqn, {
        name: className,
        namespace,
        fullyQualifiedName: classFqn,
        filePath: classLoc?.filePath ?? projectPath,
        line: classLoc?.line ?? 0,
        framework,
        methods: [],
      });
    }

    const cls = classMap.get(classFqn)!;
    const methodLoc = locationMap.get(baseFqn);
    cls.methods.push({
      name: methodName,
      fullyQualifiedName: fqn,           // keep the original FQN (with params) for test filtering
      attributes: methodLoc?.attributes ?? [],
      testData: methodLoc?.testData,
      displayName: methodLoc?.displayName,
      framework,
      filePath: methodLoc?.filePath ?? projectPath,
      line: methodLoc?.line ?? 0,
    });
  }

  return [...classMap.values()];
}
