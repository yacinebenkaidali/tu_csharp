# C# Test Lister — VS Code / Cursor Extension

A VS Code and Cursor extension that discovers and displays all tests in your C# .NET workspace in a dedicated sidebar panel.

Supports **xUnit**, **NUnit**, and **MSTest**.

---

## Features

- **Sidebar tree view** — Projects → Namespaces → Classes → Test Methods
- **Three discovery modes** — source-file parsing, `dotnet test --list-tests`, or auto-detect
- **Click to navigate** — jump straight to the test method in the editor
- **Run tests** from the tree with inline buttons (requires `dotnet` CLI on PATH)
- **Auto-refresh** on save — the tree updates whenever a `.cs` file changes
- **Copy full test name** to clipboard for use in filter arguments
- **Framework badge** — xUnit / NUnit / MSTest shown next to each project

---

## Requirements

- VS Code ≥ 1.85 or any Cursor build
- A workspace that contains at least one `.csproj` file
- `dotnet` CLI on PATH (optional — only needed for "Run" buttons and CLI discovery mode)

---

## Getting Started

1. Install the extension (`.vsix`) or clone this repo and press **F5** to launch the Extension Development Host.
2. Open a folder that contains a C# solution or project.
3. Click the **beaker** icon in the Activity Bar to open the **C# Test Explorer**.
4. Tests are discovered automatically; click **Refresh** (↺) to re-scan manually.

---

## Tree Structure

```
C# Test Explorer
└── MyApp.Tests               [xUnit]
    └── MyApp.Tests
        └── MathTests         2 tests
            ├── 🧪 Add_ReturnsSumOfTwoNumbers
            └── 🧪 Divide_ByZero_ThrowsException
```

---

## Commands

| Command | Description |
|---------|-------------|
| `C# Test Lister: Refresh Tests` | Re-discover all tests |
| `C# Test Lister: Go to Test Definition` | Open file at the test method |
| `C# Test Lister: Run Test` | Run a single test via `dotnet test --filter` |
| `C# Test Lister: Run All Tests in Class` | Run all tests in a class |
| `C# Test Lister: Run All Tests in Project` | Run an entire test project |
| `C# Test Lister: Copy Full Test Name` | Copy FQN to clipboard |

---

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `tuCsharp.discoveryMode` | `"auto"` | `"auto"` / `"parse"` / `"dotnet-cli"` |
| `tuCsharp.autoRefresh` | `true` | Refresh tree on `.cs` file save |
| `tuCsharp.showNamespace` | `true` | Group classes by namespace |
| `tuCsharp.excludePatterns` | `["**/obj/**", "**/bin/**"]` | Glob patterns to skip |

### Discovery Modes

- **`auto`** (default) — uses `dotnet test --list-tests` when `dotnet` is on PATH and the project looks like a test project; otherwise falls back to source-file parsing.
- **`parse`** — always parses `.cs` source files directly. No `dotnet` required. Works on unsaved files.
- **`dotnet-cli`** — always uses `dotnet test --list-tests`. Requires a successful build. Most accurate for parameterised tests.

---

## Supported Test Attributes

| Framework | Attributes detected |
|-----------|---------------------|
| **xUnit** | `[Fact]`, `[Theory]`, `[InlineData]`, `[MemberData]`, `[ClassData]` |
| **NUnit** | `[Test]`, `[TestCase]`, `[TestCaseSource]`, `[TestFixture]` |
| **MSTest** | `[TestMethod]`, `[DataTestMethod]`, `[DataRow]` |

---

## Development

```bash
npm install
npm run compile   # or: npm run watch
```

Press **F5** in VS Code to launch the Extension Development Host.

To build a `.vsix` package:

```bash
npm install -g @vscode/vsce
vsce package
```

---

## Project Layout

```
src/
├── extension.ts        # Activation, command registration, file watcher
├── testDiscovery.ts    # .cs parser + dotnet CLI integration
├── testTreeProvider.ts # VS Code TreeDataProvider
├── testRunner.ts       # Runs dotnet test in the integrated terminal
└── types.ts            # Shared type definitions
media/
└── test-icon.svg       # Activity Bar icon
sample/                 # Sample C# project for manual testing
```
