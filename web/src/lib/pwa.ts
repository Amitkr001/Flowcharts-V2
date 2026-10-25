import { createStore } from './store';
import { toast } from './api';

export interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
  prompt(): Promise<void>;
}

export interface PwaState {
  canInstall: boolean;
  isStandalone: boolean;
  installed: boolean;
  promptEvent: BeforeInstallPromptEvent | null;
  showModal: boolean;
}

const checkStandalone = () => {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as any).standalone === true ||
    document.referrer.includes('android-app://')
  );
};

export const pwa = createStore<PwaState>({
  canInstall: false,
  isStandalone: checkStandalone(),
  installed: false,
  promptEvent: null,
  showModal: false,
});

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e: Event) => {
    e.preventDefault();
    const evt = e as BeforeInstallPromptEvent;
    pwa.set({
      canInstall: true,
      promptEvent: evt,
    });
  });

  window.addEventListener('appinstalled', () => {
    pwa.set({
      canInstall: false,
      installed: true,
      promptEvent: null,
      showModal: false,
    });
    toast('FlowScope Desktop App installed! Icon created on Desktop.');
  });
}

/** Trigger the native installation prompt or display the guided desktop modal */
export async function triggerInstall() {
  const { promptEvent, isStandalone } = pwa.get();
  if (isStandalone) {
    toast('FlowScope is already running as an installed desktop app.');
    return;
  }
  if (promptEvent) {
    try {
      await promptEvent.prompt();
      const choice = await promptEvent.userChoice;
      if (choice.outcome === 'accepted') {
        pwa.set({ canInstall: false, promptEvent: null, installed: true });
        toast('Installing FlowScope desktop application…');
      }
    } catch (err) {
      console.warn('Install prompt error:', err);
      pwa.set({ showModal: true });
    }
  } else {
    pwa.set({ showModal: true });
  }
}

export const closeInstallModal = () => pwa.set({ showModal: false });
