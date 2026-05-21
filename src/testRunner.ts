import * as vscode from 'vscode';
import * as cp from 'child_process';
import type { TestClass, TestMethod, TestProject } from './types.js';

export class TestRunner {
  private readonly _output: vscode.OutputChannel;
  private readonly _terminal: vscode.Terminal;

  constructor(output: vscode.OutputChannel) {
    this._output = output;
    this._terminal = vscode.window.createTerminal({
      name: 'C# Test Runner',
      isTransient: false,
    });
  }

  /**
   * Run a single test method in the integrated terminal.
   */
  runTest(method: TestMethod, project: TestProject): void {
    const filter = this.buildFilter(method.fullyQualifiedName, project.framework);
    this.runCommand(`dotnet test "${project.projectPath}" ${filter}`, project);
  }

  /**
   * Run all tests in a test class.
   */
  runClass(cls: TestClass, project: TestProject): void {
    const filter = this.buildClassFilter(cls.fullyQualifiedName, project.framework);
    this.runCommand(`dotnet test "${project.projectPath}" ${filter}`, project);
  }

  /**
   * Run all tests in a project.
   */
  runProject(project: TestProject): void {
    this.runCommand(`dotnet test "${project.projectPath}"`, project);
  }

  dispose(): void {
    this._terminal.dispose();
  }

  // ── Private ──

  private runCommand(cmd: string, project: TestProject): void {
    this._output.appendLine(`[C# Test Runner] Running: ${cmd}`);
    this._terminal.show(true /* preserveFocus */);
    this._terminal.sendText(cmd);
  }

  private buildFilter(fqn: string, framework: string): string {
    switch (framework) {
      case 'xunit':
        // xUnit uses --filter "FullyQualifiedName=..."
        return `--filter "FullyQualifiedName=${fqn}"`;
      case 'nunit':
        // NUnit uses --filter "FullName=..."
        return `--filter "FullName=${fqn}"`;
      case 'mstest':
        // MSTest uses --filter "FullyQualifiedName=..."
        return `--filter "FullyQualifiedName=${fqn}"`;
      default:
        return `--filter "FullyQualifiedName=${fqn}"`;
    }
  }

  private buildClassFilter(classFqn: string, framework: string): string {
    switch (framework) {
      case 'xunit':
        return `--filter "FullyQualifiedName~${classFqn}"`;
      case 'nunit':
        return `--filter "FullName~${classFqn}"`;
      case 'mstest':
        return `--filter "FullyQualifiedName~${classFqn}"`;
      default:
        return `--filter "FullyQualifiedName~${classFqn}"`;
    }
  }
}
