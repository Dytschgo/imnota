interface PendingCaptureAccess {
  store: { readonly size: number; discardAll(): void };
  show(focus: boolean): Promise<void>;
  allowQuit(): void;
}

/** A canceled quit never silently loses pending captures, including a failed native dialog. */
export function guardPendingCaptureQuit(input: {
  onBeforeQuit(listener: (event: { preventDefault(): void }) => void): void;
  access(): PendingCaptureAccess | undefined;
  ask(count: number): Promise<boolean>;
  report(message: string): void;
  quit(): void;
}): void {
  let questionOpen = false;
  input.onBeforeQuit((event) => {
    const access = input.access();
    if (!access?.store.size) {
      access?.allowQuit();
      return;
    }
    event.preventDefault();
    if (questionOpen) return;
    questionOpen = true;
    void input
      .ask(access.store.size)
      .then(async (discard) => {
        if (!discard) {
          await access.show(true);
          return;
        }
        access.store.discardAll();
        access.allowQuit();
        input.quit();
      })
      .catch((error) => {
        input.report(
          error instanceof Error
            ? error.message
            : 'Pending captures are kept. Retry after the capture action finishes.',
        );
      })
      .finally(() => {
        questionOpen = false;
      });
  });
}
