import * as vscode from "vscode";

import { discoverTests, type DiscoveryMode } from "./testDiscovery.js";
import { CSharpTestTreeProvider, TestTreeItem } from "./testTreeProvider.js";
import { TestRunner } from "./testRunner.js";
import type { TestClass, TestMethod, TestProject } from "./types.js";

// ─── State ────────────────────────────────────────────────────────────────────

let treeProvider: CSharpTestTreeProvider;
let treeView: vscode.TreeView<TestTreeItem>;
let runner: TestRunner;
let output: vscode.OutputChannel;
let statusBar: vscode.StatusBarItem;

/** The last fully-discovered set of projects. */
let cachedProjects: TestProject[] = [];

// ─── Activate ────────────────────────────────────────────────────────────────

export function activate(context: vscode.ExtensionContext): void {
  output = vscode.window.createOutputChannel("C# Test Lister");
  context.subscriptions.push(output);

  output.appendLine("[C# Test Lister] Extension activated.");

  // Status bar item
  statusBar = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100,
  );
  statusBar.command = "tuCsharp.refresh";
  statusBar.text = "$(beaker) C# Tests";
  statusBar.tooltip = "Click to refresh C# tests";
  statusBar.show();
  context.subscriptions.push(statusBar);

  // Tree provider
  treeProvider = new CSharpTestTreeProvider(getConfig("showNamespace"));
  treeView = vscode.window.createTreeView("csharpTestExplorer", {
    treeDataProvider: treeProvider,
    showCollapseAll: true,
  });
  context.subscriptions.push(treeView);

  // Test runner
  runner = new TestRunner(output);
  context.subscriptions.push({ dispose: () => runner.dispose() });

  // ── Register commands ──
  context.subscriptions.push(
    vscode.commands.registerCommand("tuCsharp.refresh", () => refreshTests()),

    vscode.commands.registerCommand("tuCsharp.expandAll", async () => {
      const roots = treeProvider.getChildren();
      const items = roots instanceof Promise ? await roots : roots;
      for (const item of items ?? []) {
        await treeView.reveal(item, { expand: 3, select: false, focus: false });
      }
    }),

vscode.commands.registerCommand(
      "tuCsharp.goToTest",
      async (arg?: TestTreeItem) => {
        const method: TestMethod =
          arg?.nodeData?.kind === "method"
            ? arg.nodeData.method
            : (arg as unknown as TestMethod);
        if (!method) {
          return;
        }
        if (method.line === 0) {
          vscode.window.showInformationMessage(
            `File location not available for "${method.name}" (discovered via dotnet CLI without source parsing).`,
          );
          return;
        }
        const uri = vscode.Uri.file(method.filePath);
        const doc = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(doc, {
          selection: new vscode.Range(method.line - 1, 0, method.line - 1, 0),
        });
      },
    ),

    vscode.commands.registerCommand(
      "tuCsharp.runTest",
      async (item?: TestTreeItem) => {
        let method: TestMethod | undefined;
        let project: TestProject | undefined;

        if (item?.nodeData.kind === "method") {
          method = item.nodeData.method;
          project = findProjectForClass(item.nodeData.cls);
        } else {
          method = await pickTestMethod();
          project = method ? findProjectForMethod(method) : undefined;
        }

        if (!method || !project) {
          return;
        }
        runner.runTest(method, project);
      },
    ),

    vscode.commands.registerCommand(
      "tuCsharp.runAllTestsInClass",
      async (item?: TestTreeItem) => {
        let cls: TestClass | undefined;
        let project: TestProject | undefined;

        if (item?.nodeData.kind === "class") {
          cls = item.nodeData.cls;
          project = findProjectForClass(cls);
        }

        if (!cls || !project) {
          return;
        }
        runner.runClass(cls, project);
      },
    ),

    vscode.commands.registerCommand(
      "tuCsharp.runAllTestsInProject",
      async (item?: TestTreeItem) => {
        let project: TestProject | undefined;

        if (item?.nodeData.kind === "project") {
          project = item.nodeData.project;
        }

        if (!project) {
          return;
        }
        runner.runProject(project);
      },
    ),

    vscode.commands.registerCommand(
      "tuCsharp.copyTestName",
      async (item?: TestTreeItem) => {
        const method =
          item?.nodeData.kind === "method"
            ? item.nodeData.method
            : await pickTestMethod();
        if (!method) {
          return;
        }
        await vscode.env.clipboard.writeText(method.fullyQualifiedName);
        vscode.window.showInformationMessage(`Copied: ${method.fullyQualifiedName}`);
      },
    ),
  );

  // ── File watcher for auto-refresh ──
  if (getConfig<boolean>("autoRefresh")) {
    const watcher = vscode.workspace.createFileSystemWatcher("**/*.cs");
    context.subscriptions.push(watcher);

    let debounceTimer: ReturnType<typeof setTimeout> | undefined;

    const scheduleRefresh = () => {
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }
      debounceTimer = setTimeout(() => refreshTests(), 1500);
    };

    context.subscriptions.push(
      watcher.onDidChange(scheduleRefresh),
      watcher.onDidCreate(scheduleRefresh),
      watcher.onDidDelete(scheduleRefresh),
    );
  }

  // ── Config change listener ──
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("tuCsharp")) {
        treeProvider.setShowNamespace(getConfig("showNamespace"));
        if (
          e.affectsConfiguration("tuCsharp.discoveryMode") ||
          e.affectsConfiguration("tuCsharp.excludePatterns")
        ) {
          refreshTests();
        }
      }
    }),
  );

  // Initial discovery
  refreshTests();
}

// ─── Deactivate ───────────────────────────────────────────────────────────────

export function deactivate(): void {
  output?.appendLine("[C# Test Lister] Extension deactivated.");
}

// ─── Core: test refresh ───────────────────────────────────────────────────────

async function refreshTests(): Promise<void> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders?.length) {
    treeProvider.setProjects([]);
    updateStatusBar(0, 0, 0);
    return;
  }

  statusBar.text = "$(loading~spin) Discovering C# tests…";

  try {
    const mode = getConfig<DiscoveryMode>("discoveryMode");
    const excludePatterns = getConfig<string[]>("excludePatterns");
    const workspaceRoot = workspaceFolders[0].uri.fsPath;

    const projects = await discoverTests(
      workspaceRoot,
      mode,
      excludePatterns,
      output,
    );

    cachedProjects = projects;
    treeProvider.setProjects(projects);

    const counts = treeProvider.getTestCount();
    updateStatusBar(counts.projects, counts.classes, counts.methods);

    if (counts.methods === 0) {
      output.appendLine("[C# Test Lister] No test methods found.");
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    output.appendLine(`[C# Test Lister] Discovery error: ${msg}`);
    vscode.window.showErrorMessage(`C# Test Lister: ${msg}`);
    statusBar.text = "$(error) C# Tests";
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getConfig<T>(key: string): T {
  return vscode.workspace.getConfiguration("tuCsharp").get<T>(key) as T;
}

function updateStatusBar(
  projects: number,
  classes: number,
  methods: number,
): void {
  if (methods === 0) {
    statusBar.text = "$(beaker) No C# tests found";
  } else {
    statusBar.text = `$(beaker) ${methods} C# test${methods !== 1 ? "s" : ""}`;
  }
}

function findProjectForClass(cls: TestClass): TestProject | undefined {
  return cachedProjects.find((p) => p.classes.includes(cls));
}

function findProjectForMethod(method: TestMethod): TestProject | undefined {
  return cachedProjects.find((p) =>
    p.classes.some((c) => c.methods.includes(method)),
  );
}

async function pickTestMethod(): Promise<TestMethod | undefined> {
  const allMethods: Array<{ label: string; method: TestMethod }> = [];
  for (const project of cachedProjects) {
    for (const cls of project.classes) {
      for (const method of cls.methods) {
        allMethods.push({
          label: `$(beaker) ${method.fullyQualifiedName}`,
          method,
        });
      }
    }
  }

  if (allMethods.length === 0) {
    vscode.window.showInformationMessage(
      "No tests discovered yet. Try refreshing.",
    );
    return undefined;
  }

  const picked = await vscode.window.showQuickPick(allMethods, {
    placeHolder: "Select a test method",
    matchOnDescription: true,
  });

  return picked?.method;
}
