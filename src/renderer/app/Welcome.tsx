import { FolderPlus } from 'lucide-react';
import { Logo } from '../components/Logo';
import { Button } from '../components/ui';

export function Welcome({ chooseWorkspace }: { chooseWorkspace(): void }) {
  return (
    <section className="welcome">
      <div className="welcome-mark">
        <Logo compact />
      </div>
      <h1>
        Turn screenshots into
        <br />
        <span>understanding.</span>
      </h1>
      <p>Annotate what matters. Add the context an AI agent needs. Keep every file local and inspectable.</p>
      <div className="welcome-actions">
        <Button variant="primary" onClick={chooseWorkspace}>
          <FolderPlus size={17} aria-hidden="true" />
          Choose workspace
        </Button>
        <span>Works offline. No account required.</span>
      </div>
      <div className="welcome-rule">
        <span>IM</span>
        <i />
        <span>NOTA</span>
      </div>
    </section>
  );
}
