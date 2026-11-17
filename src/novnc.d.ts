// noVNC ships no types, and @types/novnc__novnc has its old lib/ paths: only what Screen.tsx uses.
declare module '@novnc/novnc' {
  export default class RFB extends EventTarget {
    constructor(target: HTMLElement, url: string, options?: { shared?: boolean });
    scaleViewport: boolean;
    sendCredentials(credentials: { password: string }): void;
    disconnect(): void;
  }
}
