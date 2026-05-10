// Presentation層はapplication層のみを参照する。domain/infrastructureへの直接依存は禁止。
export function activate() {
  return { status: 'activated' };
}

export function deactivate() {}
