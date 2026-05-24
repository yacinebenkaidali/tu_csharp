import * as vscode from "vscode";
import type {
  TestClass,
  TestFramework,
  TestMethod,
  TestProject,
} from "./types.js";

// ─── Tree item types ──────────────────────────────────────────────────────────

/**
 * Discriminated union for all nodes in the tree.
 */
type NodeKind =
  | { kind: "project"; project: TestProject }
  | { kind: "namespace"; namespace: string; project: TestProject }
  | { kind: "class"; cls: TestClass }
  | { kind: "method"; method: TestMethod; cls: TestClass };

export class TestTreeItem extends vscode.TreeItem {
  constructor(
    public readonly nodeData: NodeKind,
    collapsibleState: vscode.TreeItemCollapsibleState,
  ) {
    super(TestTreeItem.labelFor(nodeData), collapsibleState);
    this.id = TestTreeItem.idFor(nodeData);
    this.tooltip = TestTreeItem.tooltipFor(nodeData);
    this.iconPath = TestTreeItem.iconFor(nodeData);
    this.contextValue = TestTreeItem.contextValueFor(nodeData);
    this.description = TestTreeItem.descriptionFor(nodeData);

    if (nodeData.kind === "method" && nodeData.method.line > 0) {
      this.command = {
        command: "tuCsharp.goToTest",
        title: "Go to Test",
        arguments: [nodeData.method],
      };
    }
  }

  static idFor(node: NodeKind): string {
    switch (node.kind) {
      case "project":   return `project:${node.project.projectPath}`;
      case "namespace": return `ns:${node.project.projectPath}::${node.namespace}`;
      case "class":     return `class:${node.cls.fullyQualifiedName}`;
      case "method":    return `method:${node.method.fullyQualifiedName}`;
    }
  }

  private static labelFor(node: NodeKind): string {
    switch (node.kind) {
      case "project":
        return node.project.name;
      case "namespace":
        return node.namespace || "(global)";
      case "class":
        return node.cls.name;
      case "method":
        return node.method.displayName ?? node.method.name;
    }
  }

  private static tooltipFor(node: NodeKind): string {
    switch (node.kind) {
      case "project":
        return `${node.project.projectPath}\nFramework: ${node.project.framework}`;
      case "namespace":
        return node.namespace;
      case "class":
        return `${node.cls.fullyQualifiedName}\n${node.cls.filePath}:${node.cls.line}`;
      case "method": {
        const attrs = node.method.attributes.length
          ? `Attributes: [${node.method.attributes.join(", ")}]\n`
          : "";
        const data = node.method.testData?.length
          ? `Test data: ${node.method.testData.join(", ")}\n`
          : "";
        return `${node.method.fullyQualifiedName}\n${attrs}${data}${node.method.filePath}:${node.method.line}`;
      }
    }
  }

  private static iconFor(node: NodeKind): vscode.ThemeIcon {
    switch (node.kind) {
      case "project":
        return new vscode.ThemeIcon(
          "project",
          new vscode.ThemeColor("charts.blue"),
        );
      case "namespace":
        return new vscode.ThemeIcon(
          "symbol-namespace",
          new vscode.ThemeColor("charts.purple"),
        );
      case "class":
        return new vscode.ThemeIcon(
          "symbol-class",
          new vscode.ThemeColor("charts.orange"),
        );
      case "method":
        return new vscode.ThemeIcon(
          "beaker",
          new vscode.ThemeColor("testing.iconUnset"),
        );
    }
  }

  private static contextValueFor(node: NodeKind): string {
    switch (node.kind) {
      case "project":
        return "testProject";
      case "namespace":
        return "testNamespace";
      case "class":
        return "testClass";
      case "method":
        return "testMethod";
    }
  }

  private static descriptionFor(node: NodeKind): string {
    switch (node.kind) {
      case "project":
        return frameworkLabel(node.project.framework);
      case "namespace":
        return "";
      case "class": {
        const count = node.cls.methods.length;
        return `${count} test${count !== 1 ? "s" : ""}`;
      }
      case "method":
        return node.method.testData?.length
          ? `${node.method.testData.length} case${node.method.testData.length !== 1 ? "s" : ""}`
          : "";
    }
  }
}

// ─── Tree Data Provider ───────────────────────────────────────────────────────

export class CSharpTestTreeProvider implements vscode.TreeDataProvider<TestTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<
    TestTreeItem | undefined | null | void
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private _projects: TestProject[] = [];
  private _showNamespace: boolean;

  constructor(showNamespace = true) {
    this._showNamespace = showNamespace;
  }

  // ── Public API ──

  setProjects(projects: TestProject[]): void {
    this._projects = projects;
    this._onDidChangeTreeData.fire();
  }

  setShowNamespace(show: boolean): void {
    this._showNamespace = show;
    this._onDidChangeTreeData.fire();
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTestCount(): { projects: number; classes: number; methods: number } {
    return {
      projects: this._projects.length,
      classes: this._projects.reduce((s, p) => s + p.classes.length, 0),
      methods: this._projects.reduce(
        (s, p) => s + p.classes.reduce((s2, c) => s2 + c.methods.length, 0),
        0,
      ),
    };
  }

  // ── TreeDataProvider ──

  getTreeItem(element: TestTreeItem): TestTreeItem {
    return element;
  }

  getParent(element: TestTreeItem): vscode.ProviderResult<TestTreeItem> {
    const node = element.nodeData;
    switch (node.kind) {
      case "project":
        return undefined; // root — no parent

      case "namespace":
        return new TestTreeItem(
          { kind: "project", project: node.project },
          vscode.TreeItemCollapsibleState.Expanded,
        );

      case "class": {
        const project = this._projects.find((p) => p.classes.includes(node.cls));
        if (!project) { return undefined; }
        if (this._showNamespace) {
          return new TestTreeItem(
            { kind: "namespace", namespace: node.cls.namespace, project },
            vscode.TreeItemCollapsibleState.Expanded,
          );
        }
        return new TestTreeItem(
          { kind: "project", project },
          vscode.TreeItemCollapsibleState.Expanded,
        );
      }

      case "method":
        return new TestTreeItem(
          { kind: "class", cls: node.cls },
          vscode.TreeItemCollapsibleState.Expanded,
        );
    }
  }

  getChildren(element?: TestTreeItem): vscode.ProviderResult<TestTreeItem[]> {
    if (!element) {
      return this.getRootNodes();
    }

    const node = element.nodeData;

    switch (node.kind) {
      case "project":
        return this.getProjectChildren(node.project);

      case "namespace":
        return this.getNamespaceChildren(node.project, node.namespace);

      case "class":
        return this.getClassChildren(node.cls);

      case "method":
        return [];
    }
  }

  // ── Private helpers ──

  private getRootNodes(): TestTreeItem[] {
    if (this._projects.length === 0) {
      return [];
    }

    return this._projects.map(
      (p) =>
        new TestTreeItem(
          { kind: "project", project: p },
          vscode.TreeItemCollapsibleState.Expanded,
        ),
    );
  }

  private getProjectChildren(project: TestProject): TestTreeItem[] {
    if (this._showNamespace) {
      // Group by namespace
      const namespaces = [
        ...new Set(project.classes.map((c) => c.namespace)),
      ].sort();
      return namespaces.map(
        (ns) =>
          new TestTreeItem(
            { kind: "namespace", namespace: ns, project },
            vscode.TreeItemCollapsibleState.Expanded,
          ),
      );
    }

    // Flat — just show classes
    return project.classes
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(
        (cls) =>
          new TestTreeItem(
            { kind: "class", cls },
            vscode.TreeItemCollapsibleState.Expanded,
          ),
      );
  }

  private getNamespaceChildren(
    project: TestProject,
    namespace: string,
  ): TestTreeItem[] {
    return project.classes
      .filter((c) => c.namespace === namespace)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(
        (cls) =>
          new TestTreeItem(
            { kind: "class", cls },
            vscode.TreeItemCollapsibleState.Expanded,
          ),
      );
  }

  private getClassChildren(cls: TestClass): TestTreeItem[] {
    return cls.methods
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(
        (method) =>
          new TestTreeItem(
            { kind: "method", method, cls },
            vscode.TreeItemCollapsibleState.None,
          ),
      );
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function frameworkLabel(framework: TestFramework): string {
  switch (framework) {
    case "xunit":
      return "xUnit";
    case "nunit":
      return "NUnit";
    case "mstest":
      return "MSTest";
    case "unknown":
      return "";
  }
}
