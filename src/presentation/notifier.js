const DEBOUNCE_MS = 30_000;

const LEVEL_TO_METHOD = {
  info: 'showInformationMessage',
  warn: 'showWarningMessage',
  error: 'showErrorMessage'
};

export class NotificationRouter {
  constructor(vscode, now = () => Date.now()) {
    this.vscode = vscode;
    this.now = now;
    this.lastShownAt = new Map();
  }

  notify({ level, message }) {
    const method = LEVEL_TO_METHOD[level];
    if (!method || !message || !this.vscode?.window?.[method]) {
      return Promise.resolve(undefined);
    }

    const dedupeKey = `${level}:${message}`;
    const current = this.now();
    const last = this.lastShownAt.get(dedupeKey);
    if (typeof last === 'number' && current - last < DEBOUNCE_MS) {
      return Promise.resolve(undefined);
    }

    this.lastShownAt.set(dedupeKey, current);
    return this.vscode.window[method](message);
  }
}
