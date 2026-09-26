import { collectHostedShareArtifacts, hostedPngDimensionsAreSafe } from './hosted-share-artifacts.js';
import { workflowBundleNumber, workflowSessionId } from './ipc-contracts.js';
import { nativeImage } from 'electron';
import { z } from 'zod';
import type { IpcRouter } from './ipc-router.js';
import type { IpcHost } from './main.js';

export function registerHostedShareIpc(router: IpcRouter, host: IpcHost): void {
  const { handleWorkflow } = router;
  handleWorkflow('workflow:hosted-share:pair', async (_event, ...args) => {
    z.tuple([]).parse(args);
    await host.hostedShareClient!.openPairing();
  });
  handleWorkflow(
    'workflow:hosted-share:create',
    async (_event, ...args) => {
      const [input] = z
        .tuple([
          z
            .object({
              requestId: z.string().uuid(),
              pairingToken: z.string().max(512),
              senderName: z.string().max(256).optional(),
              sessionId: workflowSessionId,
              bundleNumbers: z.array(workflowBundleNumber).min(1).max(20),
              includeArchive: z.boolean(),
              expiresInDays: z.number().int().min(1).max(30),
            })
            .strict(),
        ])
        .parse(args);
      const artifacts = await collectHostedShareArtifacts(
        host.promptBundleWorkflow!,
        input.sessionId,
        input.bundleNumbers,
        (dataBase64) => {
          const image = nativeImage.createFromBuffer(Buffer.from(dataBase64, 'base64'));
          if (image.isEmpty()) return undefined;
          const size = image.getSize();
          if (!hostedPngDimensionsAreSafe(size.width, size.height))
            return { width: size.width, height: size.height, dataBase64: '' };
          return {
            width: size.width,
            height: size.height,
            dataBase64: image.toPNG().toString('base64'),
          };
        },
      );
      return host.hostedShareClient!.create(input, artifacts);
    },
    true,
  );
  handleWorkflow('workflow:hosted-share:cancel', async (_event, ...args) => {
    const [input] = z.tuple([z.object({ requestId: z.string().uuid() }).strict()]).parse(args);
    await host.hostedShareClient!.cancel(input.requestId);
  });
  handleWorkflow('workflow:hosted-share:list', async (_event, ...args) => {
    z.tuple([]).parse(args);
    return host.hostedShareClient!.list();
  });
  handleWorkflow('workflow:hosted-share:recovery-warning:dismiss', async (_event, ...args) => {
    const [input] = z
      .tuple([z.object({ id: z.string().regex(/^recovery:[a-f0-9]{64}$/) }).strict()])
      .parse(args);
    await host.hostedShareClient!.dismissRecoveryWarning(input.id);
  });
  handleWorkflow(
    'workflow:hosted-share:revoke',
    async (_event, ...args) => {
      const [input] = z.tuple([z.object({ id: z.string().min(1).max(200) }).strict()]).parse(args);
      return host.hostedShareClient!.revoke(input.id);
    },
    true,
  );
}
