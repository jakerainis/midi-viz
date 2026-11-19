import { useApp } from '../state/store';
import { useThemeEffect } from './hooks';
import { useShortcuts } from './shortcuts/useShortcuts';
import { TopBar } from './TopBar';
import { ArrangeView } from './arrange/ArrangeView';
import { KitView } from './kit/KitView';
import { MappingView } from './mapping/MappingView';
import { ExportDialog } from './export/ExportDialog';
import { ShortcutsOverlay } from './shortcuts/ShortcutsOverlay';
import styles from './App.module.css';

export function App() {
  useThemeEffect();
  useShortcuts();
  const view = useApp((s) => s.view);
  const overlay = useApp((s) => s.overlay);
  return (
    <div className={styles.app}>
      <TopBar />
      {view === 'arrange' && <ArrangeView />}
      {view === 'kit' && <KitView />}
      {view === 'mapping' && <MappingView />}
      {overlay === 'export' && <ExportDialog />}
      {overlay === 'shortcuts' && <ShortcutsOverlay />}
    </div>
  );
}
