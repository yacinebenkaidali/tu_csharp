/**
 * Supported test frameworks for C# projects.
 */
export type TestFramework = "xunit" | "nunit" | "mstest" | "unknown";

/**
 * Represents a single test method discovered in a .cs file.
 */
export interface TestMethod {
  /** The method name (e.g. "ShouldAddTwoNumbers") */
  name: string;

  /** Fully-qualified name, e.g. "MyApp.Tests.MathTests.ShouldAddTwoNumbers" */
  fullyQualifiedName: string;

  /** Test attributes found on this method (e.g. ["Fact", "Theory"]) */
  attributes: string[];

  /** Inline data (e.g. [InlineData(1,2)], [TestCase(1,2)]) */
  testData?: string[];

  /** Display name override from attribute, if any */
  displayName?: string;

  /** Which framework owns this test */
  framework: TestFramework;

  /** Absolute path to the source file */
  filePath: string;

  /** 1-based line number of the method declaration */
  line: number;
}

/**
 * Represents a test class (a class that contains test methods).
 */
export interface TestClass {
  /** Class name */
  name: string;

  /** Namespace of the class */
  namespace: string;

  /** Fully-qualified class name */
  fullyQualifiedName: string;

  /** Absolute path to the source file */
  filePath: string;

  /** 1-based line number of the class declaration */
  line: number;

  /** Detected test framework for this class */
  framework: TestFramework;

  /** All test methods in this class */
  methods: TestMethod[];
}

/**
 * Represents a C# project (.csproj) that contains test classes.
 */
export interface TestProject {
  /** Display name — the project file name without extension */
  name: string;

  /** Absolute path to the .csproj file */
  projectPath: string;

  /** Directory containing the .csproj file */
  projectDir: string;

  /** Primary test framework detected from PackageReference entries */
  framework: TestFramework;

  /** All test classes found in this project */
  classes: TestClass[];
}

/**
 * Result of a test run (via dotnet test).
 */
export interface TestRunResult {
  passed: number;
  failed: number;
  skipped: number;
  output: string;
}

/** Tree node context values used in package.json menus */
export type TreeItemContext =
  | "testProject"
  | "testNamespace"
  | "testClass"
  | "testMethod";
