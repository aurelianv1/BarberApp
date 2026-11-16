import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { texts } from '@/texts/ro';

import { Body, Button, Card, Heading } from './components';

const DISMISSED_KEY = 'barberapp.install-hint.dismissed';

/** Chrome's install prompt event (not in the standard DOM typings). */
interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
}

function isStandalone(): boolean {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as { standalone?: boolean }).standalone === true
  );
}

function isIosSafari(): boolean {
  const ua = navigator.userAgent;
  const ios =
    /iPad|iPhone|iPod/.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1);
  // Other iOS browsers cannot add to the Home Screen the same way.
  return ios && !/CriOS|FxiOS|EdgiOS/.test(ua);
}

function wasDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Invites the visitor to install the app: instructions on iPhone (Safari has no install
 * prompt), a button on Android/Chrome. Hidden once installed or dismissed.
 */
export function InstallHint() {
  const [mode, setMode] = useState<'hidden' | 'ios' | 'prompt'>('hidden');
  const [promptEvent, setPromptEvent] = useState<InstallPromptEvent | null>(null);

  useEffect(() => {
    if (isStandalone() || wasDismissed()) return;

    const onPrompt = (event: Event) => {
      event.preventDefault(); // keep the event so the button can trigger it later
      setPromptEvent(event as InstallPromptEvent);
      setMode('prompt');
    };
    const onInstalled = () => setMode('hidden');
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);

    let timer: ReturnType<typeof setTimeout> | undefined;
    if (isIosSafari()) timer = setTimeout(() => setMode('ios'), 0);

    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
      if (timer) clearTimeout(timer);
    };
  }, []);

  if (mode === 'hidden') return null;

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISSED_KEY, '1');
    } catch {
      // Storage blocked: the hint simply shows again next time.
    }
    setMode('hidden');
  };

  return (
    <Card>
      <View testID="install-hint" style={{ gap: 8 }}>
        <Heading>{texts.install.title}</Heading>
        <Body muted>{mode === 'ios' ? texts.install.ios : texts.install.android}</Body>
        {mode === 'prompt' && promptEvent ? (
          <Button
            label={texts.install.installCta}
            variant="secondary"
            testID="install-app"
            onPress={() => promptEvent.prompt().then(() => setMode('hidden'))}
          />
        ) : null}
        <Button label={texts.install.dismiss} variant="link" onPress={dismiss} />
      </View>
    </Card>
  );
}
