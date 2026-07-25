import { useState, useEffect } from 'react';
import { ArrowUpCircle } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { useSettings } from '@/contexts/SettingsContext';
import { getAppCopy } from '@/lib/app-messages';

interface VersionCheck {
  status: 'disabled' | 'up-to-date' | 'update-available' | 'no-release' | 'unavailable';
  current: string;
  latest: string | null;
  updateAvailable: boolean;
  projectDir?: string | null;
}

const CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * Shows an update badge next to the version in the status bar
 * when a newer version of ConvoSketchpad is available. Clicking it opens
 * a modal with update instructions.
 */
export function UpdateBadge() {
  const { language } = useSettings();
  const copy = getAppCopy(language);
  const [versionInfo, setVersionInfo] = useState<VersionCheck | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const ac = new AbortController();
    const check = async () => {
      try {
        const res = await fetch('/api/version/check', { signal: ac.signal });
        if (!res.ok) return;
        const data: VersionCheck = await res.json();
        setVersionInfo(data);
      } catch {
        // Silently ignore — aborted or network error
      }
    };
    check();
    const iv = setInterval(check, CHECK_INTERVAL_MS);
    return () => { ac.abort(); clearInterval(iv); };
  }, []);

  if (
    versionInfo?.status !== 'update-available'
    || !versionInfo.updateAvailable
    || !versionInfo.latest
    || !versionInfo.projectDir
  ) return null;

  const quotedProjectDir = shellQuote(versionInfo.projectDir);
  const updateCommand = `cd ${quotedProjectDir} && npm run update`;
  const dryRunCommand = `cd ${quotedProjectDir} && npm run update -- --dry-run`;
  const pinVersionCommand = `cd ${quotedProjectDir} && npm run update -- --version v${versionInfo.latest}`;
  const docsCommand = `cd ${quotedProjectDir} && cat docs/UPDATING.md`;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 text-[0.6rem] text-primary hover:text-primary/80 transition-colors cursor-pointer ml-1.5"
        title={copy.update.availableTitle(versionInfo.latest)}
        aria-label={copy.update.availableAria(versionInfo.latest)}
      >
        <ArrowUpCircle className="w-3 h-3" />
        <span className="uppercase tracking-wide font-bold">{copy.update.badge}</span>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{copy.update.title}</DialogTitle>
            <DialogDescription>
              {copy.update.description(versionInfo.latest, versionInfo.current)}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div>
              <p className="text-xs text-muted-foreground mb-1">{copy.update.projectDirectory}</p>
              <pre className="bg-secondary rounded-md px-3 py-2 text-xs font-mono text-muted-foreground select-all whitespace-pre-wrap break-all">
                {versionInfo.projectDir}
              </pre>
            </div>
            <div>
              <p className="text-sm text-muted-foreground mb-2">
                {copy.update.commandHint}
              </p>
              <pre className="bg-secondary rounded-md px-3 py-2 text-sm font-mono select-all whitespace-pre-wrap break-all">
                {updateCommand}
              </pre>
            </div>
            <div className="text-xs text-muted-foreground space-y-1">
              <p>{copy.update.confirmHint}</p>
              <p>{copy.update.updateHint}</p>
              <p>{copy.update.rollbackHint}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">{copy.update.otherOptions}</p>
              <pre className="bg-secondary rounded-md px-3 py-2 text-xs font-mono text-muted-foreground whitespace-pre-wrap">
{`# ${copy.update.previewFirst}
${dryRunCommand}

# ${copy.update.pinVersion}
${pinVersionCommand}

# ${copy.update.fullDocs}
${docsCommand}`}
              </pre>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
